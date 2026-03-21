import {
  FlightScraperStrategy,
  ScoutParams,
  SearchParams,
  ScraperResult,
  BatchScoutParams,
  BatchSearchParams,
  BatchResult
} from './FlightScraperStrategy';
import {
  TrainScoutStrategy,
  TrainScoutParams,
  TrainScoutResult,
  BatchTrainScoutParams
} from './TrainScoutStrategy';
import {
  TrainScraperStrategy,
  TrainSearchParams,
  TrainScraperResult,
  BatchTrainSearchParams
} from './TrainScraperStrategy';
import {
  CamperScraperStrategy,
  CamperSearchParams,
  CamperScraperResult,
  BatchCamperSearchParams,
} from './CamperScraperStrategy';

// Core logic for formatting results and concurrency control
export class BatchHelper {
  static formatBatchResult<T>(
    settled: PromiseSettledResult<T>[],
    labels:  string[]
  ): BatchResult<T> {
    const results = settled.map((outcome, i) => {
      if (outcome.status === 'fulfilled') {
        const val = outcome.value as any;
        return { label: labels[i], status: 'success' as const, ...val };
      }
      return {
        label:  labels[i],
        status: 'error' as const,
        reason: outcome.reason?.message ?? String(outcome.reason)
      } as any;
    });
    return {
      results,
      summary: {
        success: results.filter(r => r.status === 'success').length,
        error:   results.filter(r => r.status === 'error').length
      }
    };
  }

  static async runWithConcurrencyLimit<T, R>(
    items:       T[],
    fn:          (item: T) => Promise<R>,
    labelFn:     (item: T) => string,
    concurrency: number
  ): Promise<BatchResult<R>> {
    const results: Array<{ label: string; status: 'success' | 'error'; [k: string]: any }> = [];
    const queue = [...items];
    const inFlight = new Set<Promise<void>>();

    const runNext = async () => {
      if (queue.length === 0) return;
      const item = queue.shift()!;
      const label = labelFn(item);
      let p: Promise<void> | undefined;
      p = (async () => {
        try {
          const result = await fn(item);
          results.push({ label, status: 'success', ...result as any });
        } catch (e: any) {
          results.push({ label, status: 'error', reason: e.message });
        } finally {
          if (p) inFlight.delete(p);
          await runNext();
        }
      })();
      inFlight.add(p);
    };

    const initial = Math.min(concurrency, items.length);
    await Promise.all(Array.from({ length: initial }, () => runNext()));
    await Promise.all([...inFlight]);

    return {
      results: results as any,
      summary: {
        success: results.filter(r => r.status === 'success').length,
        error:   results.filter(r => r.status === 'error').length
      }
    };
  }
}

export abstract class BaseBatchStrategy {
  protected async runWithConcurrencyLimit<T, R>(
    items:       T[],
    fn:          (item: T) => Promise<R>,
    labelFn:     (item: T) => string,
    concurrency: number
  ): Promise<BatchResult<R>> {
    return BatchHelper.runWithConcurrencyLimit(items, fn, labelFn, concurrency);
  }

  protected formatBatchResult<T>(
    settled: PromiseSettledResult<T>[],
    labels:  string[]
  ): BatchResult<T> {
    return BatchHelper.formatBatchResult(settled, labels);
  }
}

export abstract class BaseBatchFlightStrategy extends BaseBatchStrategy implements FlightScraperStrategy {
  abstract scoutDates(params: ScoutParams): Promise<ScraperResult>;
  abstract scrapeFlights(params: SearchParams): Promise<ScraperResult>;

  async scoutDatesBatch(params: BatchScoutParams): Promise<BatchResult<ScraperResult>> {
    const settled = await Promise.allSettled(
      params.items.map(item => this.scoutDates(item))
    );
    return this.formatBatchResult(settled, params.items.map(item =>
      `${item.origin}->${item.destination}:${item.month}`
    ));
  }

  async scrapeFlightsBatch(params: BatchSearchParams): Promise<BatchResult<ScraperResult>> {
    const settled = await Promise.allSettled(
      params.items.map(item => this.scrapeFlights(item))
    );
    return this.formatBatchResult(settled, params.items.map(item =>
      `${item.origin}->${item.destination}:${item.exact_date}`
    ));
  }
}

export abstract class BaseBatchTrainScoutStrategy extends BaseBatchStrategy implements TrainScoutStrategy {
    abstract scoutDates(params: TrainScoutParams): Promise<TrainScoutResult>;

    async scoutDatesBatch(params: BatchTrainScoutParams): Promise<BatchResult<TrainScoutResult>> {
        const settled = await Promise.allSettled(
          params.items.map(item => this.scoutDates(item))
        );
        return this.formatBatchResult(settled, params.items.map(item =>
          `${item.origin_city}->${item.destination_city}:${item.month}`
        ));
    }
}

export abstract class BaseBatchTrainScraperStrategy extends BaseBatchStrategy implements TrainScraperStrategy {
  abstract scrapeTrains(params: TrainSearchParams): Promise<TrainScraperResult>;

  async scrapeTrainsBatch(params: BatchTrainSearchParams): Promise<BatchResult<TrainScraperResult>> {
    const settled = await Promise.allSettled(
      params.items.map(item => this.scrapeTrains(item))
    );
    return this.formatBatchResult(settled, params.items.map(item =>
      `${item.origin}->${item.destination}:${item.exact_date}`
    ));
  }
}

export abstract class BaseBatchCamperStrategy
  extends BaseBatchStrategy
  implements CamperScraperStrategy
{
  abstract scrapeCampers(
    params: CamperSearchParams,
  ): Promise<CamperScraperResult>;

  async scrapeCampersBatch(
    params: BatchCamperSearchParams,
  ): Promise<BatchResult<CamperScraperResult>> {
    const CONCURRENCY = 3; // HTTP puro — sin browser
    return this.runWithConcurrencyLimit(
      params.combinations,
      (combo) =>
        this.scrapeCampers({
          session_id: params.session_id,
          dbPath:     params.dbPath,
          city:       combo.city,
          date_from:  combo.date_from,
          date_to:    combo.date_to,
          types:      params.types,
          seatbelts:  params.seatbelts,
          beds:       params.beds,
          equipment:  params.equipment,
          page_size:  params.page_size,
        }),
      (combo) => `${combo.city}:${combo.date_from}→${combo.date_to}`,
      CONCURRENCY,
    );
  }
}
