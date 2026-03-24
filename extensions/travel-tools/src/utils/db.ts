import Database from "better-sqlite3";

export interface FlightScoutRecord {
  session_id: string;
  site: string;
  origin: string;
  destination: string;
  month: string;
  date: string;
  price: number;
}

export interface TrainScoutRecord {
  session_id: string;
  site: string; // 'trenes_com'
  origin_city: string;
  origin_id: string;
  destination_city: string;
  destination_id: string;
  month: string; // 'YYYY-MM'
  date: string; // 'YYYY-MM-DD'
  price: number;
}

export interface ItineraryRecord {
  session_id: string;
  site: string;
  origin: string;
  destination: string;
  out_date: string;
  ret_date?: string | null;
  pax: number;
  search_url?: string | null;
}

export interface FlightOptionRecord {
  airline: string;
  total_price: number;
  out_dep_time: string; // "HH:MM"
  out_arr_time: string; // "HH:MM"
  out_duration?: string | null;
  out_stops: number;
  ret_dep_time?: string | null;
  ret_arr_time?: string | null;
  ret_duration?: string | null;
  ret_stops?: number | null;
}

export interface FlightQueryParams {
  session_id: string;
  origin?: string;
  destination?: string;
  legs?: Array<{ origin: string; destination: string }>;
  site?: string;
  out_date?: string;
  ret_date?: string;
  min_price?: number;
  max_price?: number;
  max_stops?: number;
  dep_from?: string;
  dep_until?: string;
  arr_until?: string;
  airlines?: string[];
  exclude_airlines?: string[];
  sort_by?: "price" | "dep_time" | "stops";
  sort_dir?: "asc" | "desc";
  limit?: number;
}

export interface CombinationResult {
  out_date: string;
  ret_date?: string;
  out_price: number;
  ret_price?: number;
  total_price: number;
  trip_days?: number;
  session_id: string;
  ret_origin?: string;
  ret_destination?: string;
}

export interface TrainCombinationResult {
  out_date: string;
  ret_date?: string;
  out_price: number;
  ret_price?: number;
  total_price: number;
  trip_days?: number;
  session_id: string;
  origin_city: string;
  destination_city: string;
  ret_origin_city?: string;
  ret_destination_city?: string;
}

export interface QueryResultRow {
  itinerary_id: number;
  session_id: string;
  site: string;
  origin: string;
  destination: string;
  out_date: string;
  ret_date: string | null;
  pax: number;
  search_url: string | null;
  scraped_at: string;
  option_id: number;
  airline: string;
  total_price: number;
  out_dep_time: string;
  out_arr_time: string;
  out_duration: string | null;
  out_stops: number;
  ret_dep_time: string | null;
  ret_arr_time: string | null;
  ret_duration: string | null;
  ret_stops: number | null;
}

// ─── Train interfaces ─────────────────────────────────────────────────────────

export interface TrainItineraryRecord {
  session_id: string;
  site: string; // 'kayak_train'
  origin: string; // station code (lowercase)
  destination: string;
  out_date: string; // YYYY-MM-DD
  ret_date?: string | null;
  adults: number;
  children?: number[]; // ages, stored as JSON
  search_url?: string | null;
}

export interface TrainOptionRecord {
  operator: string;
  total_price: number;
  out_dep_time: string;
  out_arr_time: string;
  out_duration?: string | null;
  out_changes: number;
  ret_dep_time?: string | null;
  ret_arr_time?: string | null;
  ret_duration?: string | null;
  ret_changes?: number | null;
}

export interface TrainQueryParams {
  session_id: string;
  origin?: string;
  destination?: string;
  legs?: Array<{ origin: string; destination: string }>;
  site?: string;
  out_date?: string;
  ret_date?: string;
  min_price?: number;
  max_price?: number;
  max_changes?: number;
  sort_by?: "price" | "dep_time" | "changes";
  sort_dir?: "asc" | "desc";
  limit?: number;
}

export interface TrainQueryResultRow {
  itinerary_id: number;
  session_id: string;
  site: string;
  origin: string;
  destination: string;
  out_date: string;
  ret_date: string | null;
  adults: number;
  children: string | null; // JSON
  search_url: string | null;
  scraped_at: string;
  option_id: number;
  operator: string;
  total_price: number;
  out_dep_time: string;
  out_arr_time: string;
  out_duration: string | null;
  out_changes: number;
  ret_dep_time: string | null;
  ret_arr_time: string | null;
  ret_duration: string | null;
  ret_changes: number | null;
}

// ─── Camper interfaces ────────────────────────────────────────────────────────

export interface CamperItineraryRecord {
  session_id: string;
  city: string;
  where_label: string;
  latitude: number | null;
  longitude: number | null;
  radius: number;
  date_from: string;
  date_to: string;
  types: number[] | null;
  seatbelts: number | null;
  beds: number | null;
  equipment: string[];
  total_count: number;
  search_url: string;
}

export interface CamperOptionRecord {
  camper_id: number;
  ad_url: string;
  title: string;
  vehicle_type: string;
  seats: number;
  beds: number;
  price_per_day: number;
  total_price: number;
  instant_booking: boolean;
  rating: number | null;
  rating_count: number;
  latitude: number | null; // ← nuevo
  longitude: number | null; // ← nuevo
}

export interface CamperQueryParams {
  session_id: string;
  city?: string;
  date_from?: string;
  date_to?: string;
  sort_by?: "price" | "rating" | "price_per_day";
  sort_dir?: "asc" | "desc";
  limit?: number;
  group_by_type?: boolean; // ← nuevo
}

// Nueva interfaz — output mínimo para análisis LLM
export interface CamperAnalysisRow {
  // de camper_itineraries
  session_id: string;
  city: string;
  date_from: string;
  date_to: string;
  search_url: string;
  // de camper_options
  option_id: number;
  camper_id: number;
  ad_url: string;
  title: string;
  vehicle_type: string;
  seats: number;
  beds: number;
  price_per_day: number;
  total_price: number;
  instant_booking: number; // 0 | 1
  rating: number | null;
  rating_count: number;
  latitude: number | null;
  longitude: number | null;
}

export class TravelDB {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.initDB();
  }

  private initDB(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS flight_scouts (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id  TEXT NOT NULL,
        site        TEXT NOT NULL,
        origin      TEXT NOT NULL,
        destination TEXT NOT NULL,
        month       TEXT NOT NULL,
        date        TEXT NOT NULL,
        price       REAL NOT NULL,
        timestamp   DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(site, origin, destination, date, session_id)
      );

      CREATE TABLE IF NOT EXISTS train_scouts (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id       TEXT NOT NULL,
        site             TEXT NOT NULL,
        origin_city      TEXT NOT NULL,
        origin_id        TEXT NOT NULL,
        destination_city TEXT NOT NULL,
        destination_id   TEXT NOT NULL,
        month            TEXT NOT NULL,
        date             TEXT NOT NULL,
        price            REAL NOT NULL,
        timestamp        DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(site, origin_id, destination_id, date, session_id)
      );

      CREATE INDEX IF NOT EXISTS idx_ts_session
        ON train_scouts(session_id, origin_id, destination_id);

      CREATE TABLE IF NOT EXISTS itineraries (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id  TEXT NOT NULL,
        site        TEXT NOT NULL,
        origin      TEXT NOT NULL,
        destination TEXT NOT NULL,
        out_date    TEXT NOT NULL,
        ret_date    TEXT,
        pax         INTEGER NOT NULL DEFAULT 1,
        search_url  TEXT,
        scraped_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(session_id, site, origin, destination, out_date, ret_date)
      );

      CREATE TABLE IF NOT EXISTS flight_options (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        itinerary_id INTEGER NOT NULL REFERENCES itineraries(id) ON DELETE CASCADE,
        airline      TEXT NOT NULL,
        total_price  REAL NOT NULL,
        out_dep_time TEXT NOT NULL,
        out_arr_time TEXT NOT NULL,
        out_duration TEXT,
        out_stops    INTEGER NOT NULL DEFAULT 0,
        ret_dep_time TEXT,
        ret_arr_time TEXT,
        ret_duration TEXT,
        ret_stops    INTEGER,
        UNIQUE(itinerary_id, airline, out_dep_time, ret_dep_time)
      );

      CREATE INDEX IF NOT EXISTS idx_fo_price    ON flight_options(itinerary_id, total_price);
      CREATE INDEX IF NOT EXISTS idx_fo_dep_time ON flight_options(itinerary_id, out_dep_time);
      CREATE INDEX IF NOT EXISTS idx_fo_stops    ON flight_options(itinerary_id, out_stops);
      CREATE INDEX IF NOT EXISTS idx_itin_session
        ON itineraries(session_id, origin, destination);

      CREATE TABLE IF NOT EXISTS train_itineraries (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id  TEXT NOT NULL,
        site        TEXT NOT NULL,
        origin      TEXT NOT NULL,
        destination TEXT NOT NULL,
        out_date    TEXT NOT NULL,
        ret_date    TEXT,
        adults      INTEGER NOT NULL DEFAULT 1,
        children    TEXT,
        search_url  TEXT,
        scraped_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(session_id, site, origin, destination, out_date, ret_date)
      );

      CREATE TABLE IF NOT EXISTS train_options (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        itinerary_id INTEGER NOT NULL REFERENCES train_itineraries(id) ON DELETE CASCADE,
        operator     TEXT NOT NULL,
        total_price  REAL NOT NULL,
        out_dep_time TEXT NOT NULL,
        out_arr_time TEXT NOT NULL,
        out_duration TEXT,
        out_changes  INTEGER NOT NULL DEFAULT 0,
        ret_dep_time TEXT,
        ret_arr_time TEXT,
        ret_duration TEXT,
        ret_changes  INTEGER,
        UNIQUE(itinerary_id, operator, out_dep_time, ret_dep_time)
      );

      CREATE INDEX IF NOT EXISTS idx_to_price    ON train_options(itinerary_id, total_price);
      CREATE INDEX IF NOT EXISTS idx_to_dep_time ON train_options(itinerary_id, out_dep_time);
      CREATE INDEX IF NOT EXISTS idx_ti_session  ON train_itineraries(session_id, origin, destination);

      CREATE TABLE IF NOT EXISTS errors (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        site       TEXT,
        session_id TEXT,
        tool       TEXT,
        error      TEXT,
        context    TEXT,
        timestamp  DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS camper_itineraries (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id  TEXT    NOT NULL,
        city        TEXT    NOT NULL,
        where_label TEXT    NOT NULL,
        latitude    REAL    NOT NULL,
        longitude   REAL    NOT NULL,
        radius      INTEGER NOT NULL,
        date_from   TEXT    NOT NULL,
        date_to     TEXT    NOT NULL,
        types       TEXT,
        seatbelts   INTEGER,
        beds        INTEGER,
        equipment   TEXT,
        total_count INTEGER,
        search_url  TEXT,
        scraped_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(session_id, city, date_from, date_to, types, seatbelts, beds, equipment)
      );

      CREATE INDEX IF NOT EXISTS idx_ci_session
        ON camper_itineraries(session_id, city, date_from, date_to);

      CREATE TABLE IF NOT EXISTS camper_options (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        itinerary_id     INTEGER NOT NULL REFERENCES camper_itineraries(id) ON DELETE CASCADE,
        camper_id        INTEGER NOT NULL,
        ad_url           TEXT    NOT NULL,
        title            TEXT,
        vehicle_type     TEXT,
        seats            INTEGER,
        beds             INTEGER,
        price_per_day    REAL,
        total_price      REAL,
        instant_booking  INTEGER NOT NULL DEFAULT 0,
        rating           REAL,
        rating_count     INTEGER,
        latitude         REAL,
        longitude        REAL,
        UNIQUE(itinerary_id, camper_id)
      );

      CREATE INDEX IF NOT EXISTS idx_co_price ON camper_options(itinerary_id, total_price);
      CREATE INDEX IF NOT EXISTS idx_co_type_price
        ON camper_options(itinerary_id, vehicle_type, total_price);
    `);
  }

  insertScout(record: FlightScoutRecord) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO flight_scouts
      (site, origin, destination, month, date, price, session_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    return stmt.run(
      record.site,
      record.origin,
      record.destination,
      record.month,
      record.date,
      record.price,
      record.session_id,
    );
  }

  queryScouts(origin: string, destination: string, months: string[]) {
    const placeholders = months.map(() => "?").join(",");
    const stmt = this.db.prepare(`
      SELECT * FROM flight_scouts
      WHERE origin = ? AND destination = ? AND month IN (${placeholders})
      ORDER BY date ASC
    `);
    return stmt.all(origin, destination, ...months) as FlightScoutRecord[];
  }

  insertTrainScout(record: TrainScoutRecord): void {
    this.db
      .prepare(
        `
      INSERT OR REPLACE INTO train_scouts
        (session_id, site, origin_city, origin_id,
         destination_city, destination_id, month, date, price)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        record.session_id,
        record.site,
        record.origin_city,
        record.origin_id,
        record.destination_city,
        record.destination_id,
        record.month,
        record.date,
        record.price,
      );
  }

  queryTrainScouts(
    originId: string,
    destinationId: string,
    months: string[],
  ): TrainScoutRecord[] {
    const placeholders = months.map(() => "?").join(",");
    return this.db
      .prepare(
        `
      SELECT * FROM train_scouts
      WHERE origin_id = ? AND destination_id = ?
        AND month IN (${placeholders})
      ORDER BY date ASC
    `,
      )
      .all(originId, destinationId, ...months) as TrainScoutRecord[];
  }

  upsertItinerary(rec: ItineraryRecord): number {
    this.db
      .prepare(
        `
      INSERT INTO itineraries
        (session_id, site, origin, destination, out_date, ret_date, pax, search_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, site, origin, destination, out_date, ret_date)
      DO UPDATE SET
        search_url = excluded.search_url,
        scraped_at = CURRENT_TIMESTAMP
    `,
      )
      .run(
        rec.session_id,
        rec.site,
        rec.origin.toLowerCase(),
        rec.destination.toLowerCase(),
        rec.out_date,
        rec.ret_date ?? null,
        rec.pax,
        rec.search_url ?? null,
      );

    const row = this.db
      .prepare(
        `
      SELECT id FROM itineraries
      WHERE session_id = ?
        AND site = ?
        AND origin = ?
        AND destination = ?
        AND out_date = ?
        AND ret_date IS ?
    `,
      )
      .get(
        rec.session_id,
        rec.site,
        rec.origin.toLowerCase(),
        rec.destination.toLowerCase(),
        rec.out_date,
        rec.ret_date ?? null,
      ) as { id: number } | undefined;

    if (!row)
      throw new Error(`upsertItinerary: could not retrieve id after upsert`);
    return row.id;
  }

  insertFlightOption(itinerary_id: number, opt: FlightOptionRecord): void {
    this.db
      .prepare(
        `
      INSERT OR REPLACE INTO flight_options
        (itinerary_id, airline, total_price,
         out_dep_time, out_arr_time, out_duration, out_stops,
         ret_dep_time, ret_arr_time, ret_duration, ret_stops)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        itinerary_id,
        opt.airline,
        opt.total_price,
        opt.out_dep_time,
        opt.out_arr_time,
        opt.out_duration ?? null,
        opt.out_stops,
        opt.ret_dep_time ?? null,
        opt.ret_arr_time ?? null,
        opt.ret_duration ?? null,
        opt.ret_stops ?? null,
      );
  }

  queryFlightOptions(params: FlightQueryParams): QueryResultRow[] {
    const optionsPerItinerary = params.limit ?? 3;
    let itinIds: number[] = [];

    const legs =
      params.legs && params.legs.length > 0
        ? params.legs
        : params.origin && params.destination
          ? [{ origin: params.origin, destination: params.destination }]
          : (() => {
              throw new Error(
                "queryFlightOptions: provide either origin+destination or legs[]",
              );
            })();

    const legConditions = legs
      .map(() => `(origin = ? AND destination = ?)`)
      .join(" OR ");
    const itinQ = `
      SELECT id FROM itineraries
      WHERE session_id = ?
      AND (${legConditions})
      ${params.site ? "AND site = ?" : ""}
      ${params.out_date ? "AND out_date = ?" : ""}
      ${params.ret_date ? "AND ret_date IS ?" : ""}
    `;
    const itinP: any[] = [
      params.session_id,
      ...legs.flatMap((l) => [
        l.origin.toLowerCase(),
        l.destination.toLowerCase(),
      ]),
      ...(params.site ? [params.site] : []),
      ...(params.out_date ? [params.out_date] : []),
      ...(params.ret_date ? [params.ret_date] : []),
    ];

    itinIds = (this.db.prepare(itinQ).all(...itinP) as { id: number }[]).map(
      (r) => r.id,
    );

    if (itinIds.length === 0) return [];

    const placeholders = itinIds.map(() => "?").join(",");
    const orderCol =
      params.sort_by === "dep_time"
        ? "fo.out_dep_time"
        : params.sort_by === "stops"
          ? "fo.out_stops"
          : "fo.total_price";
    const orderDir = params.sort_dir === "desc" ? "DESC" : "ASC";

    let foFilters = "";
    const foP: any[] = [...itinIds];

    if (params.min_price != null) {
      foFilters += ` AND fo.total_price >= ?`;
      foP.push(params.min_price);
    }
    if (params.max_price != null) {
      foFilters += ` AND fo.total_price <= ?`;
      foP.push(params.max_price);
    }
    if (params.max_stops != null) {
      foFilters += ` AND fo.out_stops <= ?`;
      foP.push(params.max_stops);
    }
    if (params.dep_from) {
      foFilters += ` AND fo.out_dep_time >= ?`;
      foP.push(params.dep_from);
    }
    if (params.dep_until) {
      foFilters += ` AND fo.out_dep_time <= ?`;
      foP.push(params.dep_until);
    }
    if (params.arr_until) {
      foFilters += ` AND fo.out_arr_time <= ?`;
      foP.push(params.arr_until);
    }
    if (params.airlines?.length) {
      foFilters += ` AND fo.airline IN (${params.airlines.map(() => "?").join(",")})`;
      foP.push(...params.airlines);
    }
    if (params.exclude_airlines?.length) {
      foFilters += ` AND fo.airline NOT IN (${params.exclude_airlines.map(() => "?").join(",")})`;
      foP.push(...params.exclude_airlines);
    }

    foP.push(optionsPerItinerary);

    const q = `
      SELECT
        i.id AS itinerary_id, i.session_id, i.site,
        i.origin, i.destination, i.out_date, i.ret_date,
        i.pax, i.search_url, i.scraped_at,
        fo.id AS option_id, fo.airline, fo.total_price,
        fo.out_dep_time, fo.out_arr_time, fo.out_duration, fo.out_stops,
        fo.ret_dep_time, fo.ret_arr_time, fo.ret_duration, fo.ret_stops,
        ROW_NUMBER() OVER (
          PARTITION BY fo.itinerary_id
          ORDER BY ${orderCol} ${orderDir}
        ) AS rn
      FROM flight_options fo
      JOIN itineraries i ON i.id = fo.itinerary_id
      WHERE fo.itinerary_id IN (${placeholders})
      ${foFilters}
    `;

    const wrapped = `SELECT * FROM (${q}) WHERE rn <= ?`;
    return this.db.prepare(wrapped).all(...foP) as QueryResultRow[];
  }

  extractDateCombinations(params: {
    origin: string;
    destination: string;
    months: string[];
    min_days: number;
    max_days: number;
    top: number;
    session_id: string;
    return_origin?: string;
    return_destination?: string;
  }): CombinationResult[] {
    const rawOutDates = this.queryScouts(
      params.origin,
      params.destination,
      params.months,
    );
    const retOrigin = params.return_origin ?? params.destination;
    const retDestination = params.return_destination ?? params.origin;
    const rawRetDates = this.queryScouts(
      retOrigin,
      retDestination,
      params.months,
    );

    const dedupe = (rows: FlightScoutRecord[]) => {
      const map = new Map<string, FlightScoutRecord>();
      for (const d of rows) {
        if (!map.has(d.date) || d.price < map.get(d.date)!.price)
          map.set(d.date, d);
      }
      return Array.from(map.values());
    };

    const outDates = dedupe(rawOutDates);
    const retDates = dedupe(rawRetDates);

    if (outDates.length === 0 && retDates.length === 0)
      throw new Error(
        `No scout data for either route. Did the Scout phase complete?`,
      );
    if (outDates.length === 0)
      throw new Error(
        `No outbound scout data for ${params.origin}->${params.destination}.`,
      );
    if (retDates.length === 0)
      throw new Error(
        `No return scout data for ${retOrigin}->${retDestination}.`,
      );

    const combinations: CombinationResult[] = [];

    for (const out of outDates) {
      for (const ret of retDates) {
        const diffDays = Math.ceil(
          (new Date(ret.date).getTime() - new Date(out.date).getTime()) /
            86_400_000,
        );
        if (diffDays >= params.min_days && diffDays <= params.max_days) {
          combinations.push({
            out_date: out.date,
            ret_date: ret.date,
            out_price: out.price,
            ret_price: ret.price,
            total_price: out.price + ret.price,
            trip_days: diffDays,
            session_id: params.session_id,
            ...(params.return_origin
              ? { ret_origin: params.return_origin }
              : {}),
            ...(params.return_destination
              ? { ret_destination: params.return_destination }
              : {}),
          });
        }
      }
    }

    return combinations
      .sort((a, b) => a.total_price - b.total_price)
      .slice(0, params.top);
  }

  extractTrainDateCombinations(params: {
    origin_id: string;
    destination_id: string;
    origin_city: string;
    destination_city: string;
    months: string[];
    min_days: number;
    max_days: number;
    top: number;
    session_id: string;
    return_origin_id?: string;
    return_destination_id?: string;
    return_origin_city?: string;
    return_destination_city?: string;
  }): TrainCombinationResult[] {
    const retOriginId = params.return_origin_id ?? params.destination_id;
    const retDestId = params.return_destination_id ?? params.origin_id;
    const retOriginCity = params.return_origin_city ?? params.destination_city;
    const retDestCity = params.return_destination_city ?? params.origin_city;

    const rawOut = this.queryTrainScouts(
      params.origin_id,
      params.destination_id,
      params.months,
    );
    const rawRet = this.queryTrainScouts(retOriginId, retDestId, params.months);

    const dedupe = (rows: TrainScoutRecord[]) => {
      const map = new Map<string, TrainScoutRecord>();
      for (const d of rows) {
        if (!map.has(d.date) || d.price < map.get(d.date)!.price)
          map.set(d.date, d);
      }
      return Array.from(map.values());
    };

    const outDates = dedupe(rawOut);
    const retDates = dedupe(rawRet);

    if (outDates.length === 0)
      throw new Error(
        `No train scout data for ${params.origin_city}→${params.destination_city}`,
      );
    if (retDates.length === 0)
      throw new Error(
        `No train scout data for ${retOriginCity}→${retDestCity}`,
      );

    const combinations: TrainCombinationResult[] = [];

    for (const out of outDates) {
      for (const ret of retDates) {
        const diffDays = Math.ceil(
          (new Date(ret.date).getTime() - new Date(out.date).getTime()) /
            86_400_000,
        );
        if (diffDays >= params.min_days && diffDays <= params.max_days) {
          combinations.push({
            out_date: out.date,
            ret_date: ret.date,
            out_price: out.price,
            ret_price: ret.price,
            total_price: out.price + ret.price,
            trip_days: diffDays,
            session_id: params.session_id,
            origin_city: params.origin_city,
            destination_city: params.destination_city,
            ...(params.return_origin_city
              ? { ret_origin_city: params.return_origin_city }
              : {}),
            ...(params.return_destination_city
              ? { ret_destination_city: params.return_destination_city }
              : {}),
          });
        }
      }
    }

    return combinations
      .sort((a, b) => a.total_price - b.total_price)
      .slice(0, params.top);
  }

  // ─── Train CRUD ─────────────────────────────────────────────────────────────

  upsertTrainItinerary(rec: TrainItineraryRecord): number {
    this.db
      .prepare(
        `
      INSERT INTO train_itineraries
        (session_id, site, origin, destination, out_date, ret_date, adults, children, search_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, site, origin, destination, out_date, ret_date)
      DO UPDATE SET
        search_url = excluded.search_url,
        scraped_at = CURRENT_TIMESTAMP
    `,
      )
      .run(
        rec.session_id,
        rec.site,
        rec.origin.toLowerCase(),
        rec.destination.toLowerCase(),
        rec.out_date,
        rec.ret_date ?? null,
        rec.adults,
        rec.children ? JSON.stringify(rec.children) : null,
        rec.search_url ?? null,
      );

    const row = this.db
      .prepare(
        `
      SELECT id FROM train_itineraries
      WHERE session_id = ?
        AND site = ?
        AND origin = ?
        AND destination = ?
        AND out_date = ?
        AND ret_date IS ?
    `,
      )
      .get(
        rec.session_id,
        rec.site,
        rec.origin.toLowerCase(),
        rec.destination.toLowerCase(),
        rec.out_date,
        rec.ret_date ?? null,
      ) as { id: number } | undefined;

    if (!row)
      throw new Error(
        `upsertTrainItinerary: could not retrieve id after upsert`,
      );
    return row.id;
  }

  insertTrainOption(itinerary_id: number, opt: TrainOptionRecord): void {
    this.db
      .prepare(
        `
      INSERT OR REPLACE INTO train_options
        (itinerary_id, operator, total_price,
         out_dep_time, out_arr_time, out_duration, out_changes,
         ret_dep_time, ret_arr_time, ret_duration, ret_changes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        itinerary_id,
        opt.operator,
        opt.total_price,
        opt.out_dep_time,
        opt.out_arr_time,
        opt.out_duration ?? null,
        opt.out_changes,
        opt.ret_dep_time ?? null,
        opt.ret_arr_time ?? null,
        opt.ret_duration ?? null,
        opt.ret_changes ?? null,
      );
  }

  queryTrainOptions(params: TrainQueryParams): TrainQueryResultRow[] {
    const optionsPerItinerary = params.limit ?? 3;
    const legs =
      params.legs && params.legs.length > 0
        ? params.legs
        : params.origin && params.destination
          ? [{ origin: params.origin, destination: params.destination }]
          : (() => {
              throw new Error(
                "queryTrainOptions: provide either origin+destination or legs[]",
              );
            })();

    const legConditions = legs
      .map(() => `(origin = ? AND destination = ?)`)
      .join(" OR ");
    const itinQ = `
      SELECT id FROM train_itineraries
      WHERE session_id = ?
      AND (${legConditions})
      ${params.site ? "AND site = ?" : ""}
      ${params.out_date ? "AND out_date = ?" : ""}
      ${params.ret_date ? "AND ret_date IS ?" : ""}
    `;
    const itinP: any[] = [
      params.session_id,
      ...legs.flatMap((l) => [
        l.origin.toLowerCase(),
        l.destination.toLowerCase(),
      ]),
      ...(params.site ? [params.site] : []),
      ...(params.out_date ? [params.out_date] : []),
      ...(params.ret_date ? [params.ret_date] : []),
    ];

    const itinIds = (
      this.db.prepare(itinQ).all(...itinP) as { id: number }[]
    ).map((r) => r.id);

    if (itinIds.length === 0) return [];

    const placeholders = itinIds.map(() => "?").join(",");
    const orderCol =
      params.sort_by === "dep_time"
        ? "to_.out_dep_time"
        : params.sort_by === "changes"
          ? "to_.out_changes"
          : "to_.total_price";
    const orderDir = params.sort_dir === "desc" ? "DESC" : "ASC";

    let toFilters = "";
    const toP: any[] = [...itinIds];

    if (params.min_price != null) {
      toFilters += ` AND to_.total_price >= ?`;
      toP.push(params.min_price);
    }
    if (params.max_price != null) {
      toFilters += ` AND to_.total_price <= ?`;
      toP.push(params.max_price);
    }
    if (params.max_changes != null) {
      toFilters += ` AND to_.out_changes <= ?`;
      toP.push(params.max_changes);
    }

    toP.push(optionsPerItinerary);

    const q = `
      SELECT
        ti.id AS itinerary_id, ti.session_id, ti.site,
        ti.origin, ti.destination, ti.out_date, ti.ret_date,
        ti.adults, ti.children, ti.search_url, ti.scraped_at,
        to_.id AS option_id, to_.operator, to_.total_price,
        to_.out_dep_time, to_.out_arr_time, to_.out_duration, to_.out_changes,
        to_.ret_dep_time, to_.ret_arr_time, to_.ret_duration, to_.ret_changes,
        ROW_NUMBER() OVER (
          PARTITION BY to_.itinerary_id
          ORDER BY ${orderCol} ${orderDir}
        ) AS rn
      FROM train_options to_
      JOIN train_itineraries ti ON ti.id = to_.itinerary_id
      WHERE to_.itinerary_id IN (${placeholders})
      ${toFilters}
    `;

    const wrapped = `SELECT * FROM (${q}) WHERE rn <= ?`;
    return this.db.prepare(wrapped).all(...toP) as TrainQueryResultRow[];
  }

  // ─── Camper CRUD ────────────────────────────────────────────────────────────

  upsertCamperItinerary(rec: CamperItineraryRecord): number {
    this.db
      .prepare(
        `
      INSERT INTO camper_itineraries
        (session_id, city, where_label, latitude, longitude, radius,
         date_from, date_to, types, seatbelts, beds, equipment,
         total_count, search_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, city, date_from, date_to, types, seatbelts, beds, equipment)
      DO UPDATE SET
        total_count = excluded.total_count,
        search_url  = excluded.search_url,
        scraped_at  = CURRENT_TIMESTAMP
    `,
      )
      .run(
        rec.session_id,
        rec.city,
        rec.where_label,
        rec.latitude,
        rec.longitude,
        rec.radius,
        rec.date_from,
        rec.date_to,
        rec.types ? JSON.stringify(rec.types) : null,
        rec.seatbelts,
        rec.beds,
        JSON.stringify(rec.equipment),
        rec.total_count,
        rec.search_url,
      );

    const row = this.db
      .prepare(
        `
      SELECT id FROM camper_itineraries
      WHERE session_id = ? AND city = ? AND date_from = ? AND date_to = ?
        AND (types IS ? OR types = ?)
        AND (seatbelts IS ? OR seatbelts = ?)
        AND (beds IS ? OR beds = ?)
        AND equipment = ?
    `,
      )
      .get(
        rec.session_id,
        rec.city,
        rec.date_from,
        rec.date_to,
        rec.types ? JSON.stringify(rec.types) : null,
        rec.types ? JSON.stringify(rec.types) : null,
        rec.seatbelts,
        rec.seatbelts,
        rec.beds,
        rec.beds,
        JSON.stringify(rec.equipment),
      ) as { id: number } | undefined;

    if (!row)
      throw new Error(
        `upsertCamperItinerary: could not retrieve id after upsert`,
      );
    return row.id;
  }

  insertCamperOption(itinerary_id: number, opt: CamperOptionRecord): void {
    this.db
      .prepare(
        `
      INSERT OR REPLACE INTO camper_options
        (itinerary_id, camper_id, ad_url, title, vehicle_type,
         seats, beds, price_per_day, total_price, instant_booking,
         rating, rating_count, latitude, longitude)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        itinerary_id,
        opt.camper_id,
        opt.ad_url,
        opt.title,
        opt.vehicle_type,
        opt.seats,
        opt.beds,
        opt.price_per_day,
        opt.total_price,
        opt.instant_booking ? 1 : 0,
        opt.rating,
        opt.rating_count,
        opt.latitude ?? null,
        opt.longitude ?? null,
      );
  }

  queryCamperOptions(params: CamperQueryParams): CamperAnalysisRow[] {
    const limit = params.limit ?? 10;
    const orderCol =
      params.sort_by === "rating"
        ? "rating"
        : params.sort_by === "price_per_day"
          ? "price_per_day"
          : "total_price";
    const orderDir = params.sort_dir === "desc" ? "DESC" : "ASC";

    const partition = params.group_by_type
      ? "PARTITION BY session_id, city, date_from, date_to, vehicle_type"
      : "PARTITION BY session_id, city, date_from, date_to";

    let filters = `ci.session_id = ?`;
    const p: any[] = [params.session_id];

    if (params.city) {
      filters += ` AND ci.city = ?`;
      p.push(params.city);
    }
    if (params.date_from) {
      filters += ` AND ci.date_from = ?`;
      p.push(params.date_from);
    }
    if (params.date_to) {
      filters += ` AND ci.date_to = ?`;
      p.push(params.date_to);
    }

    const q = `
      WITH filtered AS (
        SELECT
          ci.session_id, ci.city, ci.date_from, ci.date_to, ci.search_url,
          co.id AS option_id, co.camper_id, co.ad_url, co.title, co.vehicle_type,
          co.seats, co.beds, co.price_per_day, co.total_price, co.instant_booking,
          co.rating, co.rating_count, co.latitude, co.longitude
        FROM camper_options co
        JOIN camper_itineraries ci ON ci.id = co.itinerary_id
        WHERE ${filters}
      ),
      ranked AS (
        SELECT *,
          ROW_NUMBER() OVER (
            ${partition}
            ORDER BY ${orderCol} ${orderDir}
          ) AS rn
        FROM filtered
      )
      SELECT * FROM ranked WHERE rn <= ?
    `;

    p.push(limit);
    return this.db.prepare(q).all(...p) as CamperAnalysisRow[];
  }

  queryCamperOptionsMulti(params: {
    session_id: string;
    combinations: Array<{ city: string; date_from: string; date_to: string }>;
    limit: number;
    sort_by?: "price" | "rating" | "price_per_day";
    sort_dir?: "asc" | "desc";
    group_by_type?: boolean;
  }): CamperAnalysisRow[] {
    const orderCol =
      params.sort_by === "rating"
        ? "rating"
        : params.sort_by === "price_per_day"
          ? "price_per_day"
          : "total_price";
    const orderDir = params.sort_dir === "desc" ? "DESC" : "ASC";

    const partition = params.group_by_type
      ? "PARTITION BY city, date_from, date_to, vehicle_type"
      : "PARTITION BY city, date_from, date_to";

    const p: any[] = [params.session_id];
    const clauses = params.combinations.map((c) => {
      p.push(c.city, c.date_from, c.date_to);
      return `(ci.city = ? AND ci.date_from = ? AND ci.date_to = ?)`;
    });

    const q = `
      WITH filtered AS (
        SELECT
          ci.session_id, ci.city, ci.date_from, ci.date_to, ci.search_url,
          co.id AS option_id, co.camper_id, co.ad_url, co.title, co.vehicle_type,
          co.seats, co.beds, co.price_per_day, co.total_price, co.instant_booking,
          co.rating, co.rating_count, co.latitude, co.longitude
        FROM camper_options co
        JOIN camper_itineraries ci ON ci.id = co.itinerary_id
        WHERE ci.session_id = ?
          AND (${clauses.join(" OR ")})
      ),
      ranked AS (
        SELECT *,
          ROW_NUMBER() OVER (
            ${partition}
            ORDER BY ${orderCol} ${orderDir}
          ) AS rn
        FROM filtered
      )
      SELECT * FROM ranked WHERE rn <= ?
    `;

    p.push(params.limit);
    return this.db.prepare(q).all(...p) as CamperAnalysisRow[];
  }

  // ─── Error logging ──────────────────────────────────────────────────────────

  logError(
    site: string,
    session_id: string,
    tool: string,
    error: string,
    context?: any,
  ) {
    const stmt = this.db.prepare(`
      INSERT INTO errors (site, session_id, tool, error, context)
      VALUES (?, ?, ?, ?, ?)
    `);
    return stmt.run(
      site,
      session_id,
      tool,
      error,
      context ? JSON.stringify(context) : null,
    );
  }

  close() {
    this.db.close();
  }
}
