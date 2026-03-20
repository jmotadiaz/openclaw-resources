import { TrainScoutStrategy, TrainScoutParams, TrainScoutResult, BatchTrainScoutParams } from '../TrainScoutStrategy';
import { BatchResult } from '../FlightScraperStrategy';
import { BaseBatchTrainScoutStrategy } from '../BaseBatchStrategy';
import { resolveStation, fetchMonthlyPrices } from './trenes-com-api';
import { FlightDB } from '../../utils/db';
import { logger } from '../../utils/logger';

export class TrenesComScoutStrategy extends BaseBatchTrainScoutStrategy {

  // Efficient batch: resolve all stations in parallel first, then all months
  async scoutDatesBatch(params: BatchTrainScoutParams): Promise<BatchResult<TrainScoutResult>> {
    try {
      logger.info(`[TrenesCom] Starting batch scout for ${params.items.length} routes`);
      
      // 1. Resolve all unique cities first to avoid redundant requests
      const cities = [...new Set(params.items.flatMap(i => [i.origin_city, i.destination_city]))];
      const stationCache = new Map<string, any>();
      
      await Promise.all(cities.map(async city => {
        try {
          const res = await resolveStation(city);
          stationCache.set(city, res);
        } catch (e: any) {
          logger.error(`[TrenesCom] Could not resolve station for ${city}: ${e.message}`);
        }
      }));

      // 2. Map items to their resolved stations and execute scoutDates
      // Since TrenesCom is pure HTTP, we don't need concurrency limits for small batches
      const settled = await Promise.allSettled(
        params.items.map(async item => {
          const origin = stationCache.get(item.origin_city);
          const destination = stationCache.get(item.destination_city);
          if (!origin || !destination) {
            throw new Error(`Could not resolve stations for ${item.origin_city}->${item.destination_city}`);
          }
          return this.scoutDates(item, origin, destination);
        })
      );

      return this.formatBatchResult(settled, params.items.map(i => 
        `${i.origin_city}->${i.destination_city}:${i.month}`
      ));

    } catch (e: any) {
      logger.error(`[TrenesCom] Batch error: ${e.message}`);
      return {
        results: [],
        summary: { success: 0, error: params.items.length }
      };
    }
  }

  async scoutDates(params: TrainScoutParams, preResolvedOrigin?: any, preResolvedDestination?: any): Promise<TrainScoutResult> {
    const db = new FlightDB(params.dbPath);
    try {
      logger.info(`[TrenesCom] Resolving stations: ${params.origin_city} -> ${params.destination_city}`);
      
      const [origin, destination] = await Promise.all([
        preResolvedOrigin      ? Promise.resolve(preResolvedOrigin)      : resolveStation(params.origin_city),
        preResolvedDestination ? Promise.resolve(preResolvedDestination) : resolveStation(params.destination_city)
      ]);

      logger.info(`[TrenesCom] Resolved: ${origin.name} (${origin.id}) -> ${destination.name} (${destination.id})`);

      const [yearStr, monthStr] = params.month.split('-');
      const year  = parseInt(yearStr);
      const month = parseInt(monthStr);

      logger.info(`[TrenesCom] Fetching prices for ${params.month}`);
      const prices = await fetchMonthlyPrices(origin.id, destination.id, month, year);

      if (prices.length === 0) {
        return {
          status: 'success',
          cheapest_dates: [],
          message: `No prices found for ${params.month}`
        };
      }

      // Persist to DB
      for (const p of prices) {
        db.insertTrainScout({
          session_id:       params.session_id,
          site:             'trenes_com',
          origin_city:      params.origin_city,
          origin_id:        origin.id,
          destination_city: params.destination_city,
          destination_id:   destination.id,
          month:            params.month,
          date:             p.date,
          price:            p.price
        });
      }

      const sorted = [...prices].sort((a, b) => a.price - b.price);
      const top5 = sorted.slice(0, 5);

      return {
        status: 'success',
        cheapest_dates: top5.map(d => ({ date: d.date, price: d.price }))
      };
    } catch (error: any) {
      logger.error(`[TrenesCom] scoutDates error: ${error.message}`);
      throw error;
    } finally {
      db.close();
    }
  }
}
