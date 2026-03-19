// extensions/travel-tools/src/strategies/TrainScoutStrategy.ts

export interface TrainScoutParams {
  origin_city:      string;  // Free-text city name in Spanish, e.g. "Madrid"
  destination_city: string;  // Free-text city name in Spanish, e.g. "Sevilla"
  month:            string;  // "YYYY-MM" format
  session_id:       string;
  dbPath:           string;
}

export interface TrainScoutResult {
  status:          string;            // 'success' | 'error'
  summary?:        string;
  dates_found?:    number;
  cheapest_dates?: Array<{ date: string; price: number }>;
  origin_id?:      string;            // resolved station ID, useful for debugging
  destination_id?: string;
  reason?:         string;
}

export interface TrainScoutStrategy {
  scoutDates(params: TrainScoutParams): Promise<TrainScoutResult>;
}
