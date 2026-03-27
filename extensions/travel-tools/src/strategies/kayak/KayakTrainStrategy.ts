// extensions/travel-tools/src/strategies/kayak/KayakTrainStrategy.ts
//
// Implements TrainScraperStrategy for Kayak trains (kayak.es with
// transportation_train_bus filter). Uses the same .nrc6 card markup as
// flights; the only difference is the URL filter and the DB tables used.
//
// Wait strategy: two-phase progress-bar detection.
// Persists to train_itineraries / train_options via TravelDB.

import {
  TrainScraperStrategy,
  TrainSearchParams,
  TrainScraperResult,
  BatchTrainSearchParams,
} from "../TrainScraperStrategy";
import { BatchResult } from "../FlightScraperStrategy";
import { BaseBatchTrainScraperStrategy } from "../BaseBatchStrategy";
import { TravelDB } from "../../utils/db";
import { logger } from "../../utils/logger";
import { McpBrowserSession, BrowserDeadError } from "../../utils/mcp-browser";
import * as scripts from "./kayak-scripts";
import { buildKayakTrainUrl } from "./kayak-train-url";

export class KayakTrainStrategy extends BaseBatchTrainScraperStrategy {
  async scrapeTrainsBatch(
    params: BatchTrainSearchParams,
  ): Promise<BatchResult<TrainScraperResult>> {
    // Concurrency=1: Kayak is heavy (~400MB per Chrome tab) and two
    // simultaneous instances frequently crash (OOM / CDP port death).
    const CONCURRENCY = 1;
    return this.runWithConcurrencyLimit(
      params.items,
      (item) => this.scrapeTrains(item),
      (item) => `${item.origin}->${item.destination}:${item.exact_date}`,
      CONCURRENCY,
    );
  }

  get siteName() {
    return "kayak_train";
  }

  async scrapeTrains(params: TrainSearchParams): Promise<TrainScraperResult> {
    const db = new TravelDB(params.dbPath);
    const sessionKey = `kayak-train-${params.origin}-${params.destination}-${params.exact_date}`;
    const browser = new McpBrowserSession(sessionKey);

    try {
      const url = buildKayakTrainUrl({
        origin: params.origin,
        destination: params.destination,
        out_date: params.exact_date,
        ret_date: params.return_date ?? null,
        adults: params.adults,
        children: params.children ?? [],
      });

      logger.info(`[KayakTrain] Navigating to: ${url}`);

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

      // PHASE 1: wait for progress bar to disappear AND stabilize.
      // Kayak loads results in multiple rounds — the progress bar may go
      // hidden briefly between rounds then reappear. We require the bar to
      // stay hidden for STABILITY_CHECKS consecutive polls.
      const STABILITY_CHECKS = 3;
      const MAX_POLLS = 45;
      let consecutiveDone = 0;
      let progressDone = false;

      for (let i = 0; i < MAX_POLLS; i++) {
        const check = await browser.callTool("execute_script", {
          instance_id: browser.instance_id,
          script: scripts.KAYAK_CHECK_PROGRESS_DONE_JS,
        });

        // BrowserDeadError is thrown by callTool when it detects 3+
        // consecutive connection failures — we catch it outside this loop.
        // If callTool returns a result with __connError, the browser is
        // dying but hasn't hit the threshold yet — skip and let it throw
        // on the next attempt.
        if (check.__connError) continue;

        const data = this.parseResult(check);
        logger.info(
          `[KayakTrain] Progress poll ${i + 1}: done=${data.done} barFound=${data.found} consecutive=${consecutiveDone}`,
        );

        if (data.done) {
          consecutiveDone++;
          if (consecutiveDone >= STABILITY_CHECKS) {
            progressDone = true;
            break;
          }
        } else {
          consecutiveDone = 0;
        }
        await sleep(2_000);
      }

      if (!progressDone) {
        throw new Error(
          `Search progress bar never completed after 90s — possible CAPTCHA or network issue`,
        );
      }

      // PHASE 2: wait for card count to stabilize.
      // After the progress bar hides, Kayak may still be rendering cards
      // from slower providers (Renfe loads after SNCF/iryo). We wait until
      // the real card count stops growing for STABLE_ROUNDS consecutive polls.
      const STABLE_ROUNDS = 4; // 4 × 3s = 12s of no new cards
      const MAX_SETTLE_POLLS = 15; // 15 × 3s = 45s max settle time
      let lastCount = 0;
      let stableRounds = 0;
      let success = false;

      for (let i = 0; i < MAX_SETTLE_POLLS; i++) {
        const check = await browser.callTool("execute_script", {
          instance_id: browser.instance_id,
          script: scripts.KAYAK_CHECK_LOADED_JS,
        });

        if (check.__connError) continue;

        const data = this.parseResult(check);
        const currentCount = data.real ?? 0;

        logger.info(
          `[KayakTrain] Settle poll ${i + 1}: real=${currentCount} last=${lastCount} stable=${stableRounds}/${STABLE_ROUNDS}`,
        );

        if (currentCount > 0 && currentCount === lastCount) {
          stableRounds++;
          if (stableRounds >= STABLE_ROUNDS) {
            success = true;
            break;
          }
        } else {
          // New cards appeared — reset stability counter
          stableRounds = 0;
        }
        lastCount = currentCount;
        await sleep(3_000);
      }

      if (!success) {
        const dump = await browser.callTool("execute_script", {
          instance_id: browser.instance_id,
          script: scripts.KAYAK_DUMP_HTML_JS,
        });
        const dumpData = this.parseResult(dump);
        logger.warn(
          `[KayakTrain] 0 results after progress done. Title: "${dumpData.title}". URL: ${url}`,
        );
        return {
          status: "error",
          reason: `0 results after search completed. Possible CAPTCHA. Title: ${dumpData.title}`,
          url,
        };
      }

      // Extract results (same card markup as flights)
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
          `[KayakTrain] 0 results. Title: "${dumpData.title}". URL: ${url}`,
        );
        return {
          status: "error",
          reason: `0 results. Possible CAPTCHA. Title: ${dumpData.title}`,
          url,
        };
      }

      // Persist to train_itineraries / train_options
      const itinerary_id = db.upsertTrainItinerary({
        session_id: params.session_id,
        site: this.siteName,
        origin: params.origin,
        destination: params.destination,
        out_date: params.exact_date,
        ret_date: params.return_date ?? null,
        adults: params.adults,
        children: params.children ?? [],
        search_url: url,
      });

      let saved = 0;
      for (const r of rawResults) {
        const legs: any[] = r.legs ?? [];
        if (legs.length === 0) continue;

        let total_price: number;
        if (typeof r.totalPrice === "number" && r.totalPrice > 0) {
          total_price = r.totalPrice;
        } else {
          const perPerson = parseFloat(
            (r.pricePerPax ?? "").replace(/[^\d.,]/g, "").replace(",", "."),
          );
          if (isNaN(perPerson) || perPerson === 0) continue;
          total_price = perPerson * params.adults;
        }

        const outLeg = legs[0];
        const retLeg = legs[1] ?? null;

        db.insertTrainOption(itinerary_id, {
          operator: r.operator ?? outLeg.airline ?? "Unknown",
          total_price,
          out_dep_time: outLeg.depTime ?? "",
          out_arr_time: outLeg.arrTime ?? "",
          out_duration: outLeg.duration ?? null,
          out_changes: outLeg.stops ?? 0,
          ret_dep_time: retLeg?.depTime ?? null,
          ret_arr_time: retLeg?.arrTime ?? null,
          ret_duration: retLeg?.duration ?? null,
          ret_changes: retLeg ? (retLeg.stops ?? 0) : null,
        });
        saved++;
      }

      logger.info(
        `[KayakTrain] Saved ${saved} options for ` +
          `${params.origin}->${params.destination} on ${params.exact_date}`,
      );

      return {
        status: "success",
        summary: `Kayak Train: ${saved} options saved for ${params.origin}->${params.destination} on ${params.exact_date}`,
        trains_found: saved,
        url,
      };
    } catch (e: any) {
      // Distinguish browser-dead from other errors for clearer logs
      if (e instanceof BrowserDeadError) {
        logger.error(`[KayakTrain] Browser died mid-scrape: ${e.message}`);
      } else {
        logger.error(`[KayakTrain] scrapeTrains error: ${e.message}`);
      }
      db.logError(this.siteName, params.session_id, "scrapeTrains", e.message);
      return { status: "error", reason: e.message };
    } finally {
      await browser.close();
      db.close();
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private parseResult(raw: any): any {
    // Skip connection-error results
    if (raw?.__connError) return {};

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
