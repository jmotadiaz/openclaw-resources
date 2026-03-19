// extensions/flight-tools/src/strategies/TrainScraperStrategy.ts
// Defines the interface and param/result types for train scraper strategies.

export interface TrainSearchParams {
  origin:       string;   // Lowercase IATA / station code
  destination:  string;
  exact_date:   string;   // YYYY-MM-DD
  return_date?: string;   // YYYY-MM-DD, omit for one-way
  adults:       number;
  children?:    number[]; // child ages
  session_id:   string;
  dbPath:       string;
}

export interface TrainScraperResult {
  status:        string;
  summary?:      string;
  url?:          string;
  trains_found?: number;
  reason?:       string;
}

export interface TrainScraperStrategy {
  scrapeTrains(params: TrainSearchParams): Promise<TrainScraperResult>;
}
