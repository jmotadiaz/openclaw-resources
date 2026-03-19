import { TrainScoutStrategy, TrainScoutParams, TrainScoutResult } from '../TrainScoutStrategy';
import { resolveStation, fetchMonthlyPrices } from './trenes-com-api';
import { FlightDB } from '../../utils/db';
import { logger } from '../../utils/logger';

export class TrenesComScoutStrategy implements TrainScoutStrategy {
  async scoutDates(params: TrainScoutParams): Promise<TrainScoutResult> {
    const db = new FlightDB(params.dbPath);
    try {
      logger.info(`[TrenesCom] Resolving stations: ${params.origin_city} -> ${params.destination_city}`);
      
      const [origin, destination] = await Promise.all([
        resolveStation(params.origin_city),
        resolveStation(params.destination_city)
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
