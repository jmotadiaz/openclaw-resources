export interface TrainScoutParams {
  session_id:       string;
  origin_city:      string;   // e.g. "Madrid"
  destination_city: string;   // e.g. "Sevilla"
  month:            string;   // "YYYY-MM"
  dbPath:           string;
}

export interface TrainScoutResult {
  status: 'success' | 'error';
  cheapest_dates: Array<{
    date:  string;
    price: number;
  }>;
  message?: string;
}

import { BatchResult } from './FlightScraperStrategy';

export interface BatchTrainScoutParams {
  items: TrainScoutParams[];
  session_id: string;
  dbPath: string;
}

export interface TrainScoutStrategy {
  scoutDates(params: TrainScoutParams): Promise<TrainScoutResult>;
  scoutDatesBatch(params: BatchTrainScoutParams): Promise<BatchResult<TrainScoutResult>>;
}
