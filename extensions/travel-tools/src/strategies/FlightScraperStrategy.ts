export interface ScoutParams {
  origin: string;
  destination: string;
  month: string;
  session_id: string;
  dbPath: string;
}

export interface SearchParams {
  origin: string;
  destination: string;
  exact_date: string;
  return_date?: string;
  pax: number;
  session_id: string;
  dbPath: string;
}

export interface ScraperResult {
  status: string;
  summary?: string;
  url?: string;
  cheapest_dates?: any[];
  flights_found?: number;
  top_flights?: any[];
  reason?: string;
}

export interface FlightScraperStrategy {
  scoutDates(params: ScoutParams): Promise<ScraperResult>;
  scrapeFlights(params: SearchParams): Promise<ScraperResult>;
}
