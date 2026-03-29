// extensions/travel-tools/src/strategies/trenes-com/TrenesComScraperStrategy.ts
// ═══════════════════════════════════════════════════════════════════════════════
// API-based train scraper for trenes.com.
// Pure HTTP — no browser needed. Uses vResults.php with a manually-provided
// sessiondb + cookies from config.
//
// For round-trip: fetches ida (tt=0), picks top 4 cheapest outbound trains,
// then for each one fetches vuelta with its ida_tarifa, picks top 4 returns.
// Result: up to 16 round-trip combinations per date pair.
// ═══════════════════════════════════════════════════════════════════════════════

import { BaseBatchStrategy, BatchHelper } from "../BaseBatchStrategy";
import { BatchResult } from "../FlightScraperStrategy";
import { TrainScraperResult } from "../TrainScraperStrategy";
import { TravelDB } from "../../utils/db";
import { logger } from "../../utils/logger";
import {
  fetchTrainResults,
  buildIdaTarifa,
  ParsedTrayecto,
  Passenger,
  ApiSession,
} from "./trenes-com-api";

// ─── Custom params (not tied to TrainSearchParams) ──────────────────────────

export interface TrenesComSearchParams {
  origin_id: string;
  origin_name: string;
  destination_id: string;
  destination_name: string;
  out_date: string; // YYYY-MM-DD
  ret_date: string | null;
  session_id: string;
  dbPath: string;
}

export interface TrenesComBatchParams {
  items: TrenesComSearchParams[];
  session_id: string;
  dbPath: string;
}

// ─── Strategy ───────────────────────────────────────────────────────────────

const TOP_IDA = 4; // top cheapest outbound trains
const TOP_VUELTA = 4; // top cheapest return trains per outbound selection

export class TrenesComScraperStrategy extends BaseBatchStrategy {
  private apiSession: ApiSession;
  private passengers: Passenger[];

  constructor(apiSession: ApiSession, passengers: Passenger[]) {
    super();
    this.apiSession = apiSession;
    this.passengers = passengers;
  }

  get siteName() {
    return "trenes_com_scraper";
  }

  async scrapeBatch(
    params: TrenesComBatchParams,
  ): Promise<BatchResult<TrainScraperResult>> {
    // Each combo does 1 + TOP_IDA API calls — keep concurrency low
    const CONCURRENCY = 2;
    return this.runWithConcurrencyLimit(
      params.items,
      (item) => this.scrape(item),
      (item) => `${item.origin_id}->${item.destination_id}:${item.out_date}`,
      CONCURRENCY,
    );
  }

  async scrape(params: TrenesComSearchParams): Promise<TrainScraperResult> {
    const db = new TravelDB(params.dbPath);
    const isRoundTrip = !!params.ret_date;

    try {
      logger.info(
        `[TrenesComScraper] Scraping ${params.origin_name}->${params.destination_name} ` +
          `${params.out_date}${isRoundTrip ? ` ↩ ${params.ret_date}` : " (one-way)"}`,
      );

      const searchUrl = buildSearchUrl(
        params.origin_id,
        params.destination_id,
        params.out_date,
        params.ret_date,
        this.passengers,
        this.apiSession.sessiondb,
      );

      const itinerary_id = db.upsertTrainItinerary({
        session_id: params.session_id,
        site: this.siteName,
        origin: params.origin_name,
        destination: params.destination_name,
        out_date: params.out_date,
        ret_date: params.ret_date ?? null,
        adults: this.passengers.filter((p) => p.age >= 14).length,
        children: this.passengers.filter((p) => p.age < 14).map((p) => p.age),
        search_url: searchUrl,
      });

      // ── Outbound (round-trip context so API knows return date) ───────────
      const outTrains = await fetchTrainResults({
        origin_id: params.origin_id,
        destination_id: params.destination_id,
        out_date: params.out_date,
        ret_date: params.ret_date,
        passengers: this.passengers,
        api_session: this.apiSession,
        tipo: "ida",
      });

      if (!isRoundTrip) {
        const saved = this.persistOneWay(db, itinerary_id, outTrains);
        const summary = `TrenesCom: ${saved} options (one-way) for ${params.origin_name}->${params.destination_name} on ${params.out_date}`;
        logger.info(`[TrenesComScraper] ${summary}`);
        return {
          status: saved > 0 ? "success" : "error",
          summary,
          trains_found: saved,
        };
      }

      // ── Top N cheapest outbound trains ──────────────────────────────────
      const validOut = outTrains
        .filter((t) => t.min_price > 0 && buildIdaTarifa(t) !== null)
        .sort((a, b) => a.min_price - b.min_price)
        .slice(0, TOP_IDA);

      if (validOut.length === 0) {
        logger.warn(
          `[TrenesComScraper] No valid outbound fares with ida_tarifa. Falling back to one-way.`,
        );
        const saved = this.persistOneWay(db, itinerary_id, outTrains);
        return {
          status: saved > 0 ? "success" : "error",
          summary: `Fallback one-way: ${saved}`,
          trains_found: saved,
        };
      }

      // ── For each top outbound, fetch vuelta and persist combos ──────────
      let totalSaved = 0;

      for (let i = 0; i < validOut.length; i++) {
        const outTrain = validOut[i];
        const idaTarifa = buildIdaTarifa(outTrain)!;

        await sleep(300);

        logger.info(
          `[TrenesComScraper] Fetching vuelta ${i + 1}/${validOut.length} ` +
            `(ida: ${outTrain.train_name} ${outTrain.train_number} @ ${outTrain.min_price}€)`,
        );

        try {
          const retTrains = await fetchTrainResults({
            origin_id: params.origin_id,
            destination_id: params.destination_id,
            out_date: params.out_date,
            ret_date: params.ret_date,
            passengers: this.passengers,
            api_session: this.apiSession,
            tipo: "vuelta",
            ida_tarifa: idaTarifa,
          });

          // Top N cheapest returns for this outbound selection
          const topRet = retTrains
            .filter((t) => t.min_price > 0)
            .sort((a, b) => a.min_price - b.min_price)
            .slice(0, TOP_VUELTA);

          for (const retTrain of topRet) {
            const outOp =
              `${outTrain.train_name} ${outTrain.train_number}`.trim();
            const retOp =
              `${retTrain.train_name} ${retTrain.train_number}`.trim();

            db.insertTrainOption(itinerary_id, {
              operator: `${outOp} / ${retOp}`,
              total_price: outTrain.min_price + retTrain.min_price,
              out_dep_time: outTrain.dep_time,
              out_arr_time: outTrain.arr_time,
              out_duration: outTrain.duration,
              out_changes: outTrain.stops,
              ret_dep_time: retTrain.dep_time,
              ret_arr_time: retTrain.arr_time,
              ret_duration: retTrain.duration,
              ret_changes: retTrain.stops,
            });
            totalSaved++;
          }
        } catch (e: any) {
          logger.warn(
            `[TrenesComScraper] Vuelta fetch failed for ida ${i + 1}: ${e.message}`,
          );
        }
      }

      const summary = `TrenesCom: ${totalSaved} round-trip combos (${validOut.length} ida × up to ${TOP_VUELTA} vuelta) for ${params.origin_name}->${params.destination_name} on ${params.out_date}`;
      logger.info(`[TrenesComScraper] ${summary}`);

      return {
        status: totalSaved > 0 ? "success" : "error",
        summary,
        trains_found: totalSaved,
        reason: totalSaved === 0 ? "No return trains found" : undefined,
      };
    } catch (e: any) {
      logger.error(`[TrenesComScraper] scrape error: ${e.message}`);
      db.logError(this.siteName, params.session_id, "scrape", e.message);
      return { status: "error", reason: e.message };
    } finally {
      db.close();
    }
  }

  // ── Persistence ─────────────────────────────────────────────────────────

  private persistOneWay(
    db: TravelDB,
    itinerary_id: number,
    trains: ParsedTrayecto[],
  ): number {
    let saved = 0;
    for (const t of trains) {
      if (t.min_price <= 0) continue;
      db.insertTrainOption(itinerary_id, {
        operator: `${t.train_name} ${t.train_number}`.trim(),
        total_price: t.min_price,
        out_dep_time: t.dep_time,
        out_arr_time: t.arr_time,
        out_duration: t.duration,
        out_changes: t.stops,
        ret_dep_time: null,
        ret_arr_time: null,
        ret_duration: null,
        ret_changes: null,
      });
      saved++;
    }
    return saved;
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Builds the clickable web search URL (resultados/index.php).
 *
 * Format matches exactly what the browser produces:
 *   ?iv=1&ot=11318&dt=10865&tt=0
 *   &fi=09%2F04%2F2026&fv=11%2F04%2F2026
 *   &dr=0&tab=A
 *   &p1=29&p1i=0&p1t=&p1g=0&p1tn=
 *   &p2=29&p2i=0&p2t=&p2g=0&p2tn=
 *   &p3=4&p3i=0&p3t=&p3g=0&p3tn=
 *   &pn=3&ph=0
 *   &sessiondb=...
 */
function buildSearchUrl(
  originId: string,
  destId: string,
  outDate: string,
  retDate: string | null,
  passengers: Passenger[],
  sessiondb: string,
): string {
  const fi = encodeURIComponent(toDDMMYYYY(outDate));
  const fv = retDate ? encodeURIComponent(toDDMMYYYY(retDate)) : "";
  const tt = retDate ? "0" : "1";

  // Passengers sorted children-first (ascending age), matching cb order
  const sorted = [...passengers].sort((a, b) => a.age - b.age);

  const paxParams = sorted
    .map((p, i) => {
      const n = i + 1;
      return (
        `&p${n}=${p.age}` +
        `&p${n}i=${p.infant ?? 0}` +
        `&p${n}t=` +
        `&p${n}g=${p.group ?? 0}` +
        `&p${n}tn=`
      );
    })
    .join("");

  return (
    `https://www.trenes.com/resultados/index.php` +
    `?iv=1&ot=${originId}&dt=${destId}&tt=${tt}` +
    `&fi=${fi}&fv=${fv}` +
    `&dr=0&tab=A` +
    paxParams +
    `&pn=${sorted.length}&ph=0` +
    `&sessiondb=${sessiondb}`
  );
}

function toDDMMYYYY(isoDate: string): string {
  const [y, m, d] = isoDate.split("-");
  return `${d}/${m}/${y}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
