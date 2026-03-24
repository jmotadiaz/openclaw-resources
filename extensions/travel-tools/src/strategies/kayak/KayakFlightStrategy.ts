// extensions/flight-tools/src/strategies/KayakStrategy.ts
//
// Implements ScraperStrategy for kayak.es.
// Handles both flights and trains — Kayak uses identical card markup (.nrc6)
// for both; the transport mode is controlled exclusively via URL parameters.
//
// Flight URL:
//   /flights/{ORG}-{DST}/{out}/{ret}/{N}adults/children-0?fs=...stops%3D~0&sort=bestflight_a
// Train URL (add transportation filter):
//   /flights/{ORG}-{DST}/{out}/{ret}/{N}adults/...?fs=stops%3D~0%3Btransportation%3D-transportation_train_bus
//
// scoutDates: NOT supported — Kayak does not expose a Skyscanner-style month
//   calendar. The method returns a graceful no-op so the orchestrator skips
//   Kayak during the date-scouting phase without crashing.
//
// scrapeFlights: Navigates to the results page, waits for real cards to load
//   (shimmer-free), extracts up to 15 results, and persists them via FlightDB.

import {
  FlightScraperStrategy,
  ScoutParams,
  SearchParams,
  ScraperResult,
  BatchScoutParams,
  BatchResult,
  BatchSearchParams,
} from "../FlightScraperStrategy";
import { BaseBatchFlightStrategy } from "../BaseBatchStrategy";
import { TravelDB } from "../../utils/db";
import { logger } from "../../utils/logger";
import { McpBrowserSession } from "../../utils/mcp-browser";
import * as scripts from "./kayak-scripts";
import { buildKayakFlightUrl } from "./kayak-flight-url";

const SITE_NAME = "kayak";
const TRAVEL_MODE = "flight";

// ─── Strategy ─────────────────────────────────────────────────────────────────

export class KayakFlightStrategy extends BaseBatchFlightStrategy {
  constructor() {
    super();
  }

  // Override batch methods to control concurrency
  async scoutDatesBatch(
    params: BatchScoutParams,
  ): Promise<BatchResult<ScraperResult>> {
    // Kayak scout is a no-op, but we still use batch for consistency if called
    return super.scoutDatesBatch(params);
  }

  async scrapeFlightsBatch(
    params: BatchSearchParams,
  ): Promise<BatchResult<ScraperResult>> {
    const CONCURRENCY = 2; // Kayak is sensitive, keep it low
    return this.runWithConcurrencyLimit(
      params.items,
      (item) => this.scrapeFlights(item),
      (item) => `${item.origin}->${item.destination}:${item.exact_date}`,
      CONCURRENCY,
    );
  }

  // ── scoutDates ──────────────────────────────────────────────────────────────
  // Kayak does not offer a month-price calendar equivalent to Skyscanner's.
  // We return a no-op success so the orchestrator can safely include Kayak in
  // its strategy list without the scout phase failing.
  async scoutDates(_params: ScoutParams): Promise<ScraperResult> {
    logger.info(
      `[Kayak/${TRAVEL_MODE}] scoutDates: no-op (Kayak has no month calendar)`,
    );
    return {
      status: "success",
      summary: `Kayak (${TRAVEL_MODE}): scoutDates skipped — no month calendar available`,
    };
  }

  // ── scrapeFlights ───────────────────────────────────────────────────────────
  async scrapeFlights(params: SearchParams): Promise<ScraperResult> {
    const db = new TravelDB(params.dbPath);
    const sessionKey = `kayak-${TRAVEL_MODE}-${params.origin}-${params.destination}-${params.exact_date}`;
    const browser = new McpBrowserSession(sessionKey);

    try {
      const url = buildKayakFlightUrl({
        origin: params.origin,
        destination: params.destination,
        out_date: params.exact_date,
        ret_date: params.return_date ?? null,
        adults: params.pax,
      });

      logger.info(`[Kayak/${TRAVEL_MODE}] Navigating to: ${url}`);

      await this.startBrowser(browser);
      await browser.callTool("navigate", {
        instance_id: browser.instance_id,
        url,
        wait_until: "networkidle",
        timeout: 60_000,
      });

      // Accept cookies if the banner appears
      await browser.callTool("execute_script", {
        instance_id: browser.instance_id,
        script: scripts.KAYAK_ACCEPT_COOKIES_JS,
      });

      // Wait for real (non-skeleton) cards to appear
      let success = false;
      for (let i = 0; i < 25; i++) {
        const check = await browser.callTool("execute_script", {
          instance_id: browser.instance_id,
          script: scripts.KAYAK_CHECK_LOADED_JS,
        });
        const data = this.parseResult(check);
        logger.info(
          `[Kayak/${TRAVEL_MODE}] Poll ${i + 1}: total=${data.total} real=${data.real}`,
        );
        if ((data.real ?? 0) > 0) {
          success = true;
          break;
        }
        await sleep(2_000);
      }

      if (!success) {
        const dump = await browser.callTool("execute_script", {
          instance_id: browser.instance_id,
          script: scripts.KAYAK_DUMP_HTML_JS,
        });
        const dumpData = this.parseResult(dump);
        throw new Error(
          `Results never loaded (shimmer timeout). Page: "${dumpData.title}" — ${url}`,
        );
      }

      // Extract results
      const extract = await browser.callTool("execute_script", {
        instance_id: browser.instance_id,
        script: scripts.KAYAK_EXTRACT_RESULTS_JS,
      });
      const data = this.parseResult(extract);

      if (data.error) {
        throw new Error(`DOM JS Error: ${data.error}`);
      }

      const rawResults: any[] = data.results ?? [];

      if (rawResults.length === 0) {
        const dump = await browser.callTool("execute_script", {
          instance_id: browser.instance_id,
          script: scripts.KAYAK_DUMP_HTML_JS,
        });
        const dumpData = this.parseResult(dump);
        logger.warn(
          `[Kayak/${TRAVEL_MODE}] 0 results. Title: "${dumpData.title}". URL: ${url}`,
        );
        return {
          status: "error",
          reason: `0 results. Possible CAPTCHA. Title: ${dumpData.title}`,
          url,
        };
      }

      // Persist to DB
      const itinerary_id = db.upsertItinerary({
        session_id: params.session_id,
        site: SITE_NAME,
        origin: params.origin,
        destination: params.destination,
        out_date: params.exact_date,
        ret_date: params.return_date ?? null,
        pax: params.pax,
        search_url: url,
      });

      let saved = 0;
      for (const r of rawResults) {
        const legs: any[] = r.legs ?? [];
        if (legs.length === 0) continue;

        // Prefer the total already parsed from DOM (.f8F1-multiple-ptc-price-label).
        // Fall back to per-person * pax when only a single-pax search was done.
        let total_price: number;
        if (typeof r.totalPrice === "number" && r.totalPrice > 0) {
          total_price = r.totalPrice;
        } else {
          const perPerson = parseFloat(
            (r.pricePerPax ?? "").replace(/[^\d.,]/g, "").replace(",", "."),
          );
          if (isNaN(perPerson) || perPerson === 0) continue;
          total_price = perPerson * params.pax;
        }

        const outLeg = legs[0];
        const retLeg = legs[1] ?? null;

        db.insertFlightOption(itinerary_id, {
          airline: r.operator ?? outLeg.airline ?? "Unknown",
          total_price,
          out_dep_time: outLeg.depTime ?? "",
          out_arr_time: outLeg.arrTime ?? "",
          out_duration: outLeg.duration ?? null,
          out_stops: outLeg.stops ?? 0,
          ret_dep_time: retLeg?.depTime ?? null,
          ret_arr_time: retLeg?.arrTime ?? null,
          ret_duration: retLeg?.duration ?? null,
          ret_stops: retLeg ? (retLeg.stops ?? 0) : null,
        });
        saved++;
      }

      logger.info(
        `[Kayak/${TRAVEL_MODE}] Saved ${saved} options for ` +
          `${params.origin}->${params.destination} on ${params.exact_date}`,
      );

      return {
        status: "success",
        summary: `Kayak (${TRAVEL_MODE}): ${saved} options saved for ${params.origin}->${params.destination} on ${params.exact_date}`,
        flights_found: saved,
        url,
      };
    } catch (e: any) {
      logger.error(`[Kayak/${TRAVEL_MODE}] scrapeFlights error: ${e.message}`);
      db.logError(SITE_NAME, params.session_id, "scrapeFlights", e.message);
      return { status: "error", reason: e.message };
    } finally {
      await browser.close();
      db.close();
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private parseResult(raw: any): any {
    if (typeof raw?.result === "string") {
      try {
        return JSON.parse(raw.result);
      } catch {
        return raw.result ?? {};
      }
    }
    return raw?.result ?? raw?.value ?? raw ?? {};
  }

  private async startBrowser(browser: McpBrowserSession): Promise<void> {
    const jitter = Math.floor(Math.random() * 2_000);
    await sleep(jitter);
    await browser.start();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
