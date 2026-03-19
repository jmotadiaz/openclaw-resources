import { TrainScoutStrategy, TrainScoutParams, TrainScoutResult } from '../TrainScoutStrategy';
import { resolveStation, fetchMonthlyPrices } from './trenes-com-api';
import { FlightDB } from '../../utils/db';
import { logger } from '../../utils/logger';

export class TrenesComScoutStrategy implements TrainScoutStrategy {

  async scoutDates(params: TrainScoutParams): Promise<TrainScoutResult> {
    const db = new FlightDB(params.dbPath);
    try {
      logger.info(`[TrenesCom] scoutDates: ${params.origin_city} → ${params.destination_city} (${params.month})`);

      // 1. Resolve station IDs
      const originStation      = await resolveStation(params.origin_city);
      const destinationStation = await resolveStation(params.destination_city);

      logger.info(`[TrenesCom] Resolved: ${originStation.name} (${originStation.id}) → ${destinationStation.name} (${destinationStation.id})`);

      // 2. Parse month
      const [yearStr, monthStr] = params.month.split('-');
      const ano = parseInt(yearStr, 10);
      const mes = parseInt(monthStr, 10);

      // 3. Fetch prices
      const prices = await fetchMonthlyPrices(
        originStation.id,
        destinationStation.id,
        mes,
        ano
      );

      if (prices.length === 0) {
        return {
          status:  'error',
          reason:  `no_prices_found: no train prices available for ${params.origin_city}→${params.destination_city} in ${params.month}`,
          origin_id:      originStation.id,
          destination_id: destinationStation.id
        };
      }

      // 4. Persist to train_scouts
      for (const { date, price } of prices) {
        db.insertTrainScout({
          session_id:       params.session_id,
          site:             'trenes_com',
          origin_city:      params.origin_city,
          origin_id:        originStation.id,
          destination_city: params.destination_city,
          destination_id:   destinationStation.id,
          month:            params.month,
          date,
          price
        });
      }

      // 5. Return top 5 cheapest for summary
      const cheapest = [...prices]
        .sort((a, b) => a.price - b.price)
        .slice(0, 5);

      logger.info(`[TrenesCom] Saved ${prices.length} dates for ${params.origin_city}→${params.destination_city}`);

      return {
        status:          'success',
        summary:         `trenes.com: ${prices.length} dates saved for ${params.origin_city}→${params.destination_city} in ${params.month}`,
        dates_found:     prices.length,
        cheapest_dates:  cheapest,
        origin_id:       originStation.id,
        destination_id:  destinationStation.id
      };

    } catch (e: any) {
      logger.error(`[TrenesCom] scoutDates error: ${e.message}`);
      db.logError('trenes_com', params.session_id, 'scoutDates', e.message);
      return { status: 'error', reason: e.message };
    } finally {
      db.close();
    }
  }
}
