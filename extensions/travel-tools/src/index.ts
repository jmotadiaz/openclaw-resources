import { SkyscannerStrategy } from './strategies/skyscanner/SkyscannerStrategy';
import { KayakFlightStrategy } from './strategies/kayak/KayakFlightStrategy';
import { KayakTrainStrategy }  from './strategies/kayak/KayakTrainStrategy';
import { TrenesComScoutStrategy } from './strategies/trenes-com/TrenesComScoutStrategy';
import { resolveStation }         from './strategies/trenes-com/trenes-com-api';
import { resolve } from 'path';
import { FlightDB } from './utils/db';

const DB_PATH = resolve(__dirname, '../travel.sqlite');
const TASK_TIMEOUT_MS = 60_000 * 5; // 5 minutes

export function register(api: any, config: any = {}) {
  const dbPath = config.dbPath || DB_PATH;

  // ─── Strategy registries ──────────────────────────────────────────────────
  const skyscanner     = new SkyscannerStrategy();
  const kayakFlight    = new KayakFlightStrategy();
  const kayakTrain     = new KayakTrainStrategy();
  const trenesComScout = new TrenesComScoutStrategy();

  const flightStrategies = [
    { name: 'skyscanner', strategy: skyscanner  },
    { name: 'kayak',       strategy: kayakFlight }
  ];

  const trainStrategies = [
    { name: 'kayak', strategy: kayakTrain }
  ];

  // ─────────────────────────────────────────────────────────────────────────
  // TOOL: date_scout
  // ─────────────────────────────────────────────────────────────────────────
  api.registerTool({
    name: 'date_scout',
    description: `Scouts cheapest flight dates for one or more route/month combinations
across all available strategies. All combinations run concurrently.
Results are stored in the DB and queryable via find_best_date_combinations.`,
    parameters: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Orchestrator session ID' },
        routes: {
          type: 'array',
          description: 'Route + month combinations to scout.',
          items: {
            type: 'object',
            properties: {
              origin:      { type: 'string', description: 'Lowercase IATA code' },
              destination: { type: 'string', description: 'Lowercase IATA code' },
              month:        { type: 'string', description: 'YYYY-MM format' }
            },
            required: ['origin', 'destination', 'month']
          }
        }
      },
      required: ['session_id', 'routes']
    },
    async execute(_id: string, params: any) {
      const tasks = params.routes.map((r: any) => ({
        label:   `skyscanner:${r.origin}->${r.destination}:${r.month}`,
        route:   `${r.origin}->${r.destination}`,
        month:   r.month,
        promise: withTimeout(
          skyscanner.scoutDates({
            origin:      r.origin,
            destination: r.destination,
            month:       r.month,
            session_id:  params.session_id,
            dbPath
          }),
          TASK_TIMEOUT_MS,
          `date_scout skyscanner ${r.origin}->${r.destination} ${r.month}`
        )
      }));

      const settled = await Promise.allSettled(tasks.map((t: any) => t.promise));

      const results = settled.map((outcome, i) => {
        const task = tasks[i];
        if (outcome.status === 'fulfilled') {
          return { site: 'skyscanner', route: task.route, month: task.month, ...outcome.value };
        }
        return {
          site: 'skyscanner', route: task.route, month: task.month,
          status: 'error', reason: outcome.reason?.message ?? String(outcome.reason)
        };
      });

      const allSuccess = results.every(r => r.status === 'success');
      const anyError   = results.some(r  => r.status === 'error');

      return {
        status: allSuccess ? 'success' : anyError ? 'partial' : 'success',
        results
      };
    }
  }, { optional: true });

  // ─────────────────────────────────────────────────────────────────────────
  // TOOL: train_scout
  // ─────────────────────────────────────────────────────────────────────────
  api.registerTool({
    name: 'train_scout',
    description: `Scouts cheapest train dates for one or more route/month combinations
using trenes.com API (no browser required — pure HTTP).
Accepts city names in Spanish (e.g. "Madrid", "Sevilla").
Station IDs are resolved automatically via getEstaciones API.
All combinations run concurrently. Partial results returned on failures.
Results stored in train_scouts table, queryable via find_best_train_date_combinations.`,
    parameters: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Orchestrator session ID' },
        routes: {
          type: 'array',
          description: 'Route + month combinations to scout.',
          items: {
            type: 'object',
            properties: {
              origin_city:      { type: 'string', description: 'City name in Spanish, e.g. "Madrid"' },
              destination_city: { type: 'string', description: 'City name in Spanish, e.g. "Sevilla"' },
              month:            { type: 'string', description: 'YYYY-MM format' }
            },
            required: ['origin_city', 'destination_city', 'month']
          }
        }
      },
      required: ['session_id', 'routes']
    },
    async execute(_id: string, params: any) {
      const tasks = params.routes.map((r: any) => ({
        label:   `trenes_com:${r.origin_city}->${r.destination_city}:${r.month}`,
        route:   `${r.origin_city}->${r.destination_city}`,
        month:   r.month,
        promise: withTimeout(
          trenesComScout.scoutDates({
            origin_city:      r.origin_city,
            destination_city: r.destination_city,
            month:            r.month,
            session_id:       params.session_id,
            dbPath
          }),
          TASK_TIMEOUT_MS,
          `train_scout trenes_com ${r.origin_city}->${r.destination_city} ${r.month}`
        )
      }));

      const settled = await Promise.allSettled(tasks.map((t: any) => t.promise));

      const results = settled.map((outcome, i) => {
        const task = tasks[i];
        if (outcome.status === 'fulfilled') {
          return { site: 'trenes_com', route: task.route, month: task.month, ...outcome.value };
        }
        return {
          site: 'trenes_com', route: task.route, month: task.month,
          status: 'error', reason: outcome.reason?.message ?? String(outcome.reason)
        };
      });

      const allSuccess = results.every(r => r.status === 'success');
      const anyError   = results.some(r  => r.status === 'error');

      return {
        status: allSuccess ? 'success' : anyError ? 'partial' : 'success',
        results
      };
    }
  }, { optional: true });

  // ─────────────────────────────────────────────────────────────────────────
  // TOOL: flight_scraper
  // ─────────────────────────────────────────────────────────────────────────
  // Flights only (Skyscanner + Kayak flights). Trains are handled by train_scraper.
  api.registerTool({
    name: 'flight_scraper',
    description: `Searches flights for one or more date combinations across
Skyscanner and Kayak concurrently.
All tasks run concurrently via Promise.allSettled. Partial results on failure.
For trains, use the separate train_scraper tool.`,
    parameters: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Session ID' },
        pax:        { type: 'number', description: 'Number of passengers' },
        combinations: {
          type: 'array',
          description: 'Date combinations to search.',
          items: {
            type: 'object',
            properties: {
              origin:      { type: 'string', description: 'Lowercase IATA code' },
              destination: { type: 'string', description: 'Lowercase IATA code' },
              exact_date:  { type: 'string', description: 'Outbound date YYYY-MM-DD' },
              return_date: { type: 'string', description: 'Return date YYYY-MM-DD (optional, round trips)' }
            },
            required: ['origin', 'destination', 'exact_date']
          }
        }
      },
      required: ['session_id', 'pax', 'combinations']
    },
    async execute(_id: string, params: any) {
      const tasks = params.combinations.flatMap((c: any) =>
        flightStrategies.map(s => ({
          label:       `${s.name}:${c.origin}->${c.destination}:${c.exact_date}`,
          site:        s.name,
          route:       `${c.origin}->${c.destination}`,
          exact_date:  c.exact_date,
          return_date: c.return_date ?? null,
          promise: withTimeout(
            s.strategy.scrapeFlights({
              origin:      c.origin,
              destination: c.destination,
              exact_date:  c.exact_date,
              return_date: c.return_date,
              pax:         params.pax,
              session_id:  params.session_id,
              dbPath
            }),
            TASK_TIMEOUT_MS,
            `flight_scraper ${s.name} ${c.origin}->${c.destination} ${c.exact_date}`
          )
        }))
      );

      const settled = await Promise.allSettled(tasks.map((t: any) => t.promise));

      const results = settled.map((outcome, i) => {
        const task = tasks[i];
        if (outcome.status === 'fulfilled') {
          return {
            site: task.site, route: task.route,
            exact_date: task.exact_date, return_date: task.return_date,
            ...outcome.value
          };
        }
        return {
          site: task.site, route: task.route,
          exact_date: task.exact_date, return_date: task.return_date,
          status: 'error', reason: outcome.reason?.message ?? String(outcome.reason)
        };
      });

      const allSuccess = results.every(r => r.status === 'success');
      const anyError   = results.some(r  => r.status === 'error');

      return {
        status: allSuccess ? 'success' : anyError ? 'partial' : 'success',
        results
      };
    }
  }, { optional: true });

  // ─────────────────────────────────────────────────────────────────────────
  // TOOL: train_scraper
  // ─────────────────────────────────────────────────────────────────────────
  api.registerTool({
    name: 'train_scraper',
    description: `Searches trains for one or more date combinations.
Currently uses Kayak Trains. All combinations run concurrently.
Set children= per combination if travelling with children (array of ages).
Results are stored in a separate DB table from flights.`,
    parameters: {
      type: 'object',
      properties: {
        session_id: { type: 'string' },
        adults:     { type: 'number' },
        children: {
          type: 'array',
          items: { type: 'number' },
          description: 'Child ages (empty array if no children).'
        },
        combinations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              origin:      { type: 'string' },
              destination: { type: 'string' },
              exact_date:  { type: 'string', description: 'YYYY-MM-DD' },
              return_date: { type: 'string', description: 'YYYY-MM-DD, optional' }
            },
            required: ['origin', 'destination', 'exact_date']
          }
        }
      },
      required: ['session_id', 'adults', 'combinations']
    },
    async execute(_id: string, params: any) {
      const tasks = params.combinations.flatMap((c: any) =>
        trainStrategies.map(s => ({
          label:       `${s.name}:${c.origin}->${c.destination}:${c.exact_date}`,
          site:        s.name,
          route:       `${c.origin}->${c.destination}`,
          exact_date:  c.exact_date,
          return_date: c.return_date ?? null,
          promise: withTimeout(
            s.strategy.scrapeTrains({
              origin:      c.origin,
              destination: c.destination,
              exact_date:  c.exact_date,
              return_date: c.return_date,
              adults:      params.adults,
              children:    params.children ?? [],
              session_id:  params.session_id,
              dbPath
            }),
            TASK_TIMEOUT_MS,
            `train_scraper ${s.name} ${c.origin}->${c.destination} ${c.exact_date}`
          )
        }))
      );

      const settled = await Promise.allSettled(tasks.map((t: any) => t.promise));
      const results = settled.map((outcome, i) => {
        const task = tasks[i];
        if (outcome.status === 'fulfilled') {
          return { site: task.site, route: task.route, exact_date: task.exact_date, ...outcome.value };
        }
        return {
          site: task.site, route: task.route, exact_date: task.exact_date,
          status: 'error', reason: outcome.reason?.message ?? String(outcome.reason)
        };
      });

      return {
        status: results.every(r => r.status === 'success') ? 'success' : 'partial',
        results
      };
    }
  }, { optional: true });

  // ─────────────────────────────────────────────────────────────────────────
  // TOOL: find_best_date_combinations
  // ─────────────────────────────────────────────────────────────────────────
  api.registerTool({
    name: 'find_best_date_combinations',
    description: 'Analiza los datos de scouting (Skyscanner) y devuelve las mejores ventanas de fechas.',
    parameters: {
      type: 'object',
      properties: {
        origin:             { type: 'string' },
        destination:        { type: 'string' },
        session_id:         { type: 'string' },
        top:                { type: 'number' },
        months:             { type: 'string', description: 'Comma-separated YYYY-MM months' },
        min_days:           { type: 'number' },
        max_days:           { type: 'number' },
        return_origin:      { type: 'string', description: 'Open-jaw only' },
        return_destination: { type: 'string', description: 'Open-jaw only' }
      },
      required: ['origin', 'destination', 'session_id']
    },
    async execute(_id: string, params: any) {
      const db = new FlightDB(dbPath);
      try {
        const months = params.months
          ? params.months.split(',').map((m: string) => m.trim())
          : [];
        const results = db.extractDateCombinations({
          origin:             params.origin,
          destination:        params.destination,
          months,
          min_days:           params.min_days   || 7,
          max_days:           params.max_days   || 14,
          top:                params.top        || 5,
          session_id:         params.session_id,
          return_origin:      params.return_origin,
          return_destination: params.return_destination
        });
        return { status: 'success', data: results };
      } catch (error: any) {
        return { status: 'error', reason: 'extraction_failed', message: error.message };
      } finally {
        db.close();
      }
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TOOL: find_best_train_date_combinations
  // ─────────────────────────────────────────────────────────────────────────
  api.registerTool({
    name: 'find_best_train_date_combinations',
    description: `Analyzes train scouting data (trenes.com) and returns the best date windows.
Requires train_scout to have run first for the given session and routes.
City names must match exactly what was passed to train_scout.`,
    parameters: {
      type: 'object',
      properties: {
        session_id:             { type: 'string' },
        origin_city:            { type: 'string', description: 'Same city name used in train_scout' },
        destination_city:       { type: 'string', description: 'Same city name used in train_scout' },
        months:                 { type: 'string', description: 'Comma-separated YYYY-MM months' },
        min_days:               { type: 'number' },
        max_days:               { type: 'number' },
        top:                    { type: 'number', description: 'Max combinations to return (default 5)' },
        return_origin_city:      { type: 'string', description: 'Open-jaw only' },
        return_destination_city: { type: 'string', description: 'Open-jaw only' }
      },
      required: ['session_id', 'origin_city', 'destination_city']
    },
    async execute(_id: string, params: any) {
      const db = new FlightDB(dbPath);
      try {
        const months = params.months
          ? params.months.split(',').map((m: string) => m.trim())
          : [];

        // Resolve station IDs from city names (needed for DB lookup)
        const originStation      = await resolveStation(params.origin_city);
        const destinationStation = await resolveStation(params.destination_city);

        let retOriginStation      = { id: destinationStation.id, name: destinationStation.name };
        let retDestinationStation = { id: originStation.id,      name: originStation.name };

        if (params.return_origin_city) {
          retOriginStation = await resolveStation(params.return_origin_city);
        }
        if (params.return_destination_city) {
          retDestinationStation = await resolveStation(params.return_destination_city);
        }

        const results = db.extractTrainDateCombinations({
          origin_id:              originStation.id,
          destination_id:         destinationStation.id,
          origin_city:            params.origin_city,
          destination_city:       params.destination_city,
          months,
          min_days:               params.min_days   ?? 2,
          max_days:               params.max_days   ?? 14,
          top:                    params.top        ?? 5,
          session_id:             params.session_id,
          return_origin_id:       params.return_origin_city      ? retOriginStation.id      : undefined,
          return_destination_id:  params.return_destination_city ? retDestinationStation.id : undefined,
          return_origin_city:     params.return_origin_city,
          return_destination_city: params.return_destination_city
        });

        return { status: 'success', data: results };
      } catch (error: any) {
        return { status: 'error', reason: 'extraction_failed', message: error.message };
      } finally {
        db.close();
      }
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TOOL: consolidate_final_flight_report
  // ─────────────────────────────────────────────────────────────────────────
  api.registerTool({
    name: 'consolidate_final_flight_report',
    description: `Retrieves verified flight options from the DB. Never triggers scraping.

CALL ONCE per session — returns all scraped combos grouped by site.
Do NOT call multiple times for the same session/dates.`,
    parameters: {
      type: 'object',
      properties: {
        session_id:  { type: 'string' },
        origin:      { type: 'string', description: 'Lowercase IATA code' },
        destination: { type: 'string', description: 'Lowercase IATA code' },
        limit:       { type: 'number', description: 'Max options PER itinerary' },
        sort_by:     { type: 'string', enum: ['price', 'dep_time', 'stops'] },
        sort_dir:    { type: 'string', enum: ['asc', 'desc'] }
      },
      required: ['session_id']
    },
    async execute(_id: string, params: any) {
      const db = new FlightDB(dbPath);
      try {
        const results = db.queryFlightOptions({
          session_id:  params.session_id,
          origin:      params.origin,
          destination: params.destination,
          limit:       params.limit   || 3,
          sort_by:     params.sort_by || 'price',
          sort_dir:    params.sort_dir || 'asc'
        });
        return { status: 'success', data: results };
      } catch (error: any) {
        return { status: 'error', reason: 'consolidation_failed', message: error.message };
      } finally {
        db.close();
      }
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TOOL: consolidate_final_train_report
  // ─────────────────────────────────────────────────────────────────────────
  api.registerTool({
    name: 'consolidate_final_train_report',
    description: `Retrieves verified train options from the DB.`,
    parameters: {
      type: 'object',
      properties: {
        session_id:  { type: 'string' },
        origin:      { type: 'string' },
        destination: { type: 'string' },
        limit:       { type: 'number' },
        sort_by:     { type: 'string', enum: ['price', 'dep_time', 'changes'] },
        sort_dir:    { type: 'string', enum: ['asc', 'desc'] }
      },
      required: ['session_id']
    },
    async execute(_id: string, params: any) {
      const db = new FlightDB(dbPath);
      try {
        const results = db.queryTrainOptions({
          session_id:  params.session_id,
          origin:      params.origin,
          destination: params.destination,
          limit:       params.limit   || 3,
          sort_by:     params.sort_by || 'price',
          sort_dir:    params.sort_dir || 'asc'
        });
        return { status: 'success', data: results };
      } catch (error: any) {
        return { status: 'error', reason: 'consolidation_failed', message: error.message };
      } finally {
        db.close();
      }
    }
  });
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timeoutId: any;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`TASK_TIMEOUT: ${label} (exceeded ${ms}ms)`));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}
