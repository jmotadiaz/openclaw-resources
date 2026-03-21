import { BatchResult } from "./FlightScraperStrategy";

// ─── Parámetros de una búsqueda individual ────────────────────────────────────

export interface CamperSearchParams {
  session_id: string;
  city: string;       // ciudad en español, e.g. "Barcelona"
  date_from: string;  // "YYYY-MM-DD"
  date_to: string;    // "YYYY-MM-DD"
  types: number[];    // [] = todos
  seatbelts: number | null;
  beds: number | null;
  equipment: string[]; // e.g. ['ac', 'shower_int', 'fridge']
  page_size: number;  // default 20
  dbPath: string;
}

// ─── Resultado de una búsqueda individual ─────────────────────────────────────

export interface CamperScraperResult {
  status: "success" | "error";
  city?: string;
  date_from?: string;
  date_to?: string;
  search_url?: string;
  total_count?: number;
  saved?: number;
  reason?: string;
}

// ─── Parámetros batch ─────────────────────────────────────────────────────────

export interface BatchCamperSearchParams {
  session_id: string;
  dbPath: string;
  combinations: Array<{ city: string; date_from: string; date_to: string }>;
  types: number[];
  seatbelts: number | null;
  beds: number | null;
  equipment: string[];
  page_size: number;
}

// ─── Interfaz ─────────────────────────────────────────────────────────────────

export interface CamperScraperStrategy {
  scrapeCampers(params: CamperSearchParams): Promise<CamperScraperResult>;
  scrapeCampersBatch(
    params: BatchCamperSearchParams,
  ): Promise<BatchResult<CamperScraperResult>>;
}
