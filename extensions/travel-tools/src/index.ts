import { SkyscannerStrategy } from "./strategies/skyscanner/SkyscannerStrategy";
import { KayakFlightStrategy } from "./strategies/kayak/KayakFlightStrategy";
import { KayakTrainStrategy } from "./strategies/kayak/KayakTrainStrategy";
import { TrenesComScoutStrategy } from "./strategies/trenes-com/TrenesComScoutStrategy";
import { resolveStation } from "./strategies/trenes-com/trenes-com-api";
import { YescapaStrategy } from "./strategies/yescapa/YescapaStrategy";
import { CamperScraperStrategy } from "./strategies/CamperScraperStrategy";
import { resolve } from "path";
import { readFileSync } from "fs";
import { FlightDB } from "./utils/db";
import { logger } from "./utils/logger";

const DB_PATH = resolve(__dirname, "../travel.sqlite");

export function register(api: any, config: any = {}) {
  const dbPath = config.dbPath || DB_PATH;

  // ─── Strategy registries ──────────────────────────────────────────────────
  const skyscanner = new SkyscannerStrategy();
  const kayakFlight = new KayakFlightStrategy();
  const kayakTrain = new KayakTrainStrategy();
  const trenesComScout = new TrenesComScoutStrategy();

  const flightStrategies = [
    { name: "skyscanner", strategy: skyscanner },
    { name: "kayak", strategy: kayakFlight },
  ];

  const trainStrategies = [{ name: "kayak", strategy: kayakTrain }];

  const camperStrategies: Array<{
    name: string;
    strategy: CamperScraperStrategy;
  }> = [{ name: "yescapa", strategy: new YescapaStrategy() }];

  // ─────────────────────────────────────────────────────────────────────────
  // TOOL: date_scout
  // ─────────────────────────────────────────────────────────────────────────
  api.registerTool(
    {
      name: "date_scout",
      description: `Scouts cheapest flight dates for one or more route/month combinations
across all available strategies. All combinations run concurrently.
Results are stored in the DB and queryable via find_best_date_combinations.`,
      parameters: {
        type: "object",
        properties: {
          session_id: {
            type: "string",
            description: "Orchestrator session ID",
          },
          routes: {
            type: "array",
            description: "Route + month combinations to scout.",
            items: {
              type: "object",
              properties: {
                origin: { type: "string", description: "Lowercase IATA code" },
                destination: {
                  type: "string",
                  description: "Lowercase IATA code",
                },
                month: { type: "string", description: "YYYY-MM format" },
              },
              required: ["origin", "destination", "month"],
            },
          },
        },
        required: ["session_id", "routes"],
      },
      async execute(_id: string, params: any) {
        const batchResult = await skyscanner.scoutDatesBatch({
          session_id: params.session_id,
          dbPath,
          items: params.routes.map((r: any) => ({
            origin: r.origin,
            destination: r.destination,
            month: r.month,
            session_id: params.session_id,
            dbPath,
          })),
        });

        return {
          status:
            batchResult.summary.error === 0
              ? "success"
              : batchResult.summary.success > 0
                ? "partial"
                : "error",
          results: batchResult.results,
        };
      },
    },
    { optional: true },
  );

  // ─────────────────────────────────────────────────────────────────────────
  // TOOL: train_scout
  // ─────────────────────────────────────────────────────────────────────────
  api.registerTool(
    {
      name: "train_scout",
      description: `Scouts cheapest train dates for one or more route/month combinations
using trenes.com API (no browser required — pure HTTP).
Accepts city names in Spanish (e.g. "Madrid", "Sevilla").
Station IDs are resolved automatically via getEstaciones API.
All combinations run concurrently. Partial results returned on failures.
Results stored in train_scouts table, queryable via find_best_train_date_combinations.`,
      parameters: {
        type: "object",
        properties: {
          session_id: {
            type: "string",
            description: "Orchestrator session ID",
          },
          routes: {
            type: "array",
            description: "Route + month combinations to scout.",
            items: {
              type: "object",
              properties: {
                origin_city: {
                  type: "string",
                  description: 'City name in Spanish, e.g. "Madrid"',
                },
                destination_city: {
                  type: "string",
                  description: 'City name in Spanish, e.g. "Sevilla"',
                },
                month: { type: "string", description: "YYYY-MM format" },
              },
              required: ["origin_city", "destination_city", "month"],
            },
          },
        },
        required: ["session_id", "routes"],
      },
      async execute(_id: string, params: any) {
        const batchResult = await trenesComScout.scoutDatesBatch({
          session_id: params.session_id,
          dbPath,
          items: params.routes.map((r: any) => ({
            origin_city: r.origin_city,
            destination_city: r.destination_city,
            month: r.month,
            session_id: params.session_id,
            dbPath,
          })),
        });

        return {
          status:
            batchResult.summary.error === 0
              ? "success"
              : batchResult.summary.success > 0
                ? "partial"
                : "error",
          results: batchResult.results,
        };
      },
    },
    { optional: true },
  );

  // ─────────────────────────────────────────────────────────────────────────
  // TOOL: flight_scraper
  // ─────────────────────────────────────────────────────────────────────────
  // Flights only (Skyscanner + Kayak flights). Trains are handled by train_scraper.
  api.registerTool(
    {
      name: "flight_scraper",
      description: `Searches flights for one or more date combinations across
Skyscanner and Kayak concurrently.
All tasks run concurrently via Promise.allSettled. Partial results on failure.
For trains, use the separate train_scraper tool.`,
      parameters: {
        type: "object",
        properties: {
          session_id: { type: "string", description: "Session ID" },
          pax: { type: "number", description: "Number of passengers" },
          combinations: {
            type: "array",
            description: "Date combinations to search.",
            items: {
              type: "object",
              properties: {
                origin: { type: "string", description: "Lowercase IATA code" },
                destination: {
                  type: "string",
                  description: "Lowercase IATA code",
                },
                exact_date: {
                  type: "string",
                  description: "Outbound date YYYY-MM-DD",
                },
                return_date: {
                  type: "string",
                  description: "Return date YYYY-MM-DD (optional, round trips)",
                },
              },
              required: ["origin", "destination", "exact_date"],
            },
          },
        },
        required: ["session_id", "pax", "combinations"],
      },
      async execute(_id: string, params: any) {
        const allResults: any[] = [];
        let totalSuccess = 0;
        let totalError = 0;

        for (const s of flightStrategies) {
          const batchResult = await s.strategy.scrapeFlightsBatch({
            session_id: params.session_id,
            dbPath,
            items: params.combinations.map((c: any) => ({
              origin: c.origin,
              destination: c.destination,
              exact_date: c.exact_date,
              return_date: c.return_date,
              pax: params.pax,
              session_id: params.session_id,
              dbPath,
            })),
          });

          // Add site info to results
          const mapped = batchResult.results.map((r) => ({
            site: s.name,
            ...r,
          }));
          allResults.push(...mapped);
          totalSuccess += batchResult.summary.success;
          totalError += batchResult.summary.error;
        }

        return {
          status:
            totalError === 0
              ? "success"
              : totalSuccess > 0
                ? "partial"
                : "error",
          results: allResults,
        };
      },
    },
    { optional: true },
  );

  // ─────────────────────────────────────────────────────────────────────────
  // TOOL: train_scraper
  // ─────────────────────────────────────────────────────────────────────────
  api.registerTool(
    {
      name: "train_scraper",
      description: `Searches trains for one or more date combinations.
Currently uses Kayak Trains. All combinations run concurrently.
Set children= per combination if travelling with children (array of ages).
Results are stored in a separate DB table from flights.`,
      parameters: {
        type: "object",
        properties: {
          session_id: { type: "string" },
          adults: { type: "number" },
          children: {
            type: "array",
            items: { type: "number" },
            description: "Child ages (empty array if no children).",
          },
          combinations: {
            type: "array",
            items: {
              type: "object",
              properties: {
                origin: { type: "string" },
                destination: { type: "string" },
                exact_date: { type: "string", description: "YYYY-MM-DD" },
                return_date: {
                  type: "string",
                  description: "YYYY-MM-DD, optional",
                },
              },
              required: ["origin", "destination", "exact_date"],
            },
          },
        },
        required: ["session_id", "adults", "combinations"],
      },
      async execute(_id: string, params: any) {
        const allResults: any[] = [];
        let totalSuccess = 0;
        let totalError = 0;

        for (const s of trainStrategies) {
          const batchResult = await s.strategy.scrapeTrainsBatch({
            session_id: params.session_id,
            dbPath,
            items: params.combinations.map((c: any) => ({
              origin: c.origin,
              destination: c.destination,
              exact_date: c.exact_date,
              return_date: c.return_date,
              adults: params.adults,
              children: params.children ?? [],
              session_id: params.session_id,
              dbPath,
            })),
          });

          const mapped = batchResult.results.map((r) => ({
            site: s.name,
            ...r,
          }));
          allResults.push(...mapped);
          totalSuccess += batchResult.summary.success;
          totalError += batchResult.summary.error;
        }

        return {
          status:
            totalError === 0
              ? "success"
              : totalSuccess > 0
                ? "partial"
                : "error",
          results: allResults,
        };
      },
    },
    { optional: true },
  );

  // ─────────────────────────────────────────────────────────────────────────
  // TOOL: find_best_date_combinations
  // ─────────────────────────────────────────────────────────────────────────
  api.registerTool({
    name: "find_best_date_combinations",
    description:
      "Analiza los datos de scouting (Skyscanner) y devuelve las mejores ventanas de fechas.",
    parameters: {
      type: "object",
      properties: {
        origin: { type: "string" },
        destination: { type: "string" },
        session_id: { type: "string" },
        top: { type: "number" },
        months: {
          type: "string",
          description: "Comma-separated YYYY-MM months",
        },
        min_days: { type: "number" },
        max_days: { type: "number" },
        return_origin: { type: "string", description: "Open-jaw only" },
        return_destination: { type: "string", description: "Open-jaw only" },
      },
      required: ["origin", "destination", "session_id"],
    },
    async execute(_id: string, params: any) {
      const db = new FlightDB(dbPath);
      try {
        const months = params.months
          ? params.months.split(",").map((m: string) => m.trim())
          : [];
        const results = db.extractDateCombinations({
          origin: params.origin,
          destination: params.destination,
          months,
          min_days: params.min_days || 7,
          max_days: params.max_days || 14,
          top: params.top || 5,
          session_id: params.session_id,
          return_origin: params.return_origin,
          return_destination: params.return_destination,
        });
        return { status: "success", data: results };
      } catch (error: any) {
        return {
          status: "error",
          reason: "extraction_failed",
          message: error.message,
        };
      } finally {
        db.close();
      }
    },
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TOOL: find_best_train_date_combinations
  // ─────────────────────────────────────────────────────────────────────────
  api.registerTool({
    name: "find_best_train_date_combinations",
    description: `Analyzes train scouting data (trenes.com) and returns the best date windows.
Requires train_scout to have run first for the given session and routes.
City names must match exactly what was passed to train_scout.`,
    parameters: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        origin_city: {
          type: "string",
          description: "Same city name used in train_scout",
        },
        destination_city: {
          type: "string",
          description: "Same city name used in train_scout",
        },
        months: {
          type: "string",
          description: "Comma-separated YYYY-MM months",
        },
        min_days: { type: "number" },
        max_days: { type: "number" },
        top: {
          type: "number",
          description: "Max combinations to return (default 5)",
        },
        return_origin_city: { type: "string", description: "Open-jaw only" },
        return_destination_city: {
          type: "string",
          description: "Open-jaw only",
        },
      },
      required: ["session_id", "origin_city", "destination_city"],
    },
    async execute(_id: string, params: any) {
      const db = new FlightDB(dbPath);
      try {
        const months = params.months
          ? params.months.split(",").map((m: string) => m.trim())
          : [];

        // Resolve station IDs from city names (needed for DB lookup)
        const originStation = await resolveStation(params.origin_city);
        const destinationStation = await resolveStation(
          params.destination_city,
        );

        let retOriginStation = {
          id: destinationStation.id,
          name: destinationStation.name,
        };
        let retDestinationStation = {
          id: originStation.id,
          name: originStation.name,
        };

        if (params.return_origin_city) {
          retOriginStation = await resolveStation(params.return_origin_city);
        }
        if (params.return_destination_city) {
          retDestinationStation = await resolveStation(
            params.return_destination_city,
          );
        }

        const results = db.extractTrainDateCombinations({
          origin_id: originStation.id,
          destination_id: destinationStation.id,
          origin_city: params.origin_city,
          destination_city: params.destination_city,
          months,
          min_days: params.min_days ?? 2,
          max_days: params.max_days ?? 14,
          top: params.top ?? 5,
          session_id: params.session_id,
          return_origin_id: params.return_origin_city
            ? retOriginStation.id
            : undefined,
          return_destination_id: params.return_destination_city
            ? retDestinationStation.id
            : undefined,
          return_origin_city: params.return_origin_city,
          return_destination_city: params.return_destination_city,
        });

        return { status: "success", data: results };
      } catch (error: any) {
        return {
          status: "error",
          reason: "extraction_failed",
          message: error.message,
        };
      } finally {
        db.close();
      }
    },
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TOOL: consolidate_final_flight_report
  // ─────────────────────────────────────────────────────────────────────────
  api.registerTool({
    name: "consolidate_final_flight_report",
    description: `Retrieves verified flight options from the DB. Never triggers scraping.

CALL ONCE per session — returns all scraped combos grouped by site.
Do NOT call multiple times for the same session/dates.`,
    parameters: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        origin: { type: "string", description: "Lowercase IATA code" },
        destination: { type: "string", description: "Lowercase IATA code" },
        limit: { type: "number", description: "Max options PER itinerary" },
        sort_by: { type: "string", enum: ["price", "dep_time", "stops"] },
        sort_dir: { type: "string", enum: ["asc", "desc"] },
      },
      required: ["session_id"],
    },
    async execute(_id: string, params: any) {
      const db = new FlightDB(dbPath);
      try {
        const results = db.queryFlightOptions({
          session_id: params.session_id,
          origin: params.origin,
          destination: params.destination,
          limit: params.limit || 3,
          sort_by: params.sort_by || "price",
          sort_dir: params.sort_dir || "asc",
        });
        return { status: "success", data: results };
      } catch (error: any) {
        return {
          status: "error",
          reason: "consolidation_failed",
          message: error.message,
        };
      } finally {
        db.close();
      }
    },
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TOOL: consolidate_final_train_report
  // ─────────────────────────────────────────────────────────────────────────
  api.registerTool({
    name: "consolidate_final_train_report",
    description: `Retrieves verified train options from the DB.`,
    parameters: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        origin: { type: "string" },
        destination: { type: "string" },
        limit: { type: "number" },
        sort_by: { type: "string", enum: ["price", "dep_time", "changes"] },
        sort_dir: { type: "string", enum: ["asc", "desc"] },
      },
      required: ["session_id"],
    },
    async execute(_id: string, params: any) {
      const db = new FlightDB(dbPath);
      try {
        const results = db.queryTrainOptions({
          session_id: params.session_id,
          origin: params.origin,
          destination: params.destination,
          limit: params.limit || 3,
          sort_by: params.sort_by || "price",
          sort_dir: params.sort_dir || "asc",
        });
        return { status: "success", data: results };
      } catch (error: any) {
        return {
          status: "error",
          reason: "consolidation_failed",
          message: error.message,
        };
      } finally {
        db.close();
      }
    },
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TOOL: fetch_campers_for_analysis
  // ─────────────────────────────────────────────────────────────────────────
  api.registerTool({
    name: "fetch_campers_for_analysis",
    description: `Retrieves top-N campers per vehicle type for LLM reranking.
Returns raw camper data including coordinates. Intended to be passed
to the camper-analyzer subagent, not displayed directly.`,
    parameters: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        city: { type: "string" },
        date_from: { type: "string", description: "YYYY-MM-DD" },
        date_to: { type: "string", description: "YYYY-MM-DD" },
        limit_per_type: {
          type: "number",
          description: "Max per vehicle_type (default 10)",
        },
      },
      required: ["session_id"],
    },
    async execute(_id: string, params: any) {
      const db = new FlightDB(dbPath);
      try {
        const results = db.queryCamperOptions({
          session_id: params.session_id,
          city: params.city,
          date_from: params.date_from,
          date_to: params.date_to,
          limit: params.limit_per_type ?? 10,
          group_by_type: true,
          sort_by: "price",
          sort_dir: "asc",
        });
        return { status: "success", data: results };
      } catch (error: any) {
        return { status: "error", message: error.message };
      } finally {
        db.close();
      }
    },
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TOOL: camper_scraper
  // ─────────────────────────────────────────────────────────────────────────
  api.registerTool(
    {
      name: "camper_scraper",
      description: `[v3 — contrato completo] Busca autocaravanas en Yescapa con filtros avanzados.
Soporta tipos de vehículo, número de cinturones, camas y equipamiento.
Extrae la x-api-key de la home y resuelve la localización dinámicamente.
Devuelve el total_count y guarda el JSON completo en disco.`,
      parameters: {
        type: "object",
        properties: {
          session_id: {
            type: "string",
            description: "Orchestrator session ID",
          },
          combinations: {
            type: "array",
            description: "City + date combinations to search.",
            items: {
              type: "object",
              properties: {
                city: {
                  type: "string",
                  description:
                    'Ciudad de recogida en español, e.g. "Barcelona"',
                },
                date_from: {
                  type: "string",
                  description: "Fecha de inicio YYYY-MM-DD",
                },
                date_to: {
                  type: "string",
                  description: "Fecha de fin YYYY-MM-DD",
                },
              },
              required: ["city", "date_from", "date_to"],
            },
          },
          types: {
            type: "array",
            items: { type: "number" },
            description:
              "IDs de tipo: 1:Perfilada, 2:Capuchina, 3:Integral, 4:Gran Volumen, 5:Van, 6:Caravana. Default: [] (todos)",
          },
          seatbelts: {
            type: "number",
            description: "Mínimo de cinturones. Default: omitido",
          },
          beds: {
            type: "number",
            description: "Mínimo de camas. Default: omitido",
          },
          equipment: {
            type: "array",
            items: { type: "string" },
            description:
              "Filtros: ac, shower_int, fridge, heating, gps, tv, wc, bedding, bike_rack, solar. Default: [ac, shower_int, fridge]",
          },
          page_size: {
            type: "number",
            description: "Resultados por página. Default: 20",
          },
        },
        required: ["session_id", "combinations"],
      },
      async execute(_id: string, params: any) {
        logger.info(`[Tool/camper_scraper] Inciando búsqueda para ${params.combinations.length} combinaciones (Session: ${params.session_id})`);
        const allResults: any[] = [];
        let totalSuccess = 0;
        let totalError = 0;

        for (const s of camperStrategies) {
          const batchResult = await s.strategy.scrapeCampersBatch({
            session_id: params.session_id,
            dbPath,
            combinations: params.combinations,
            types: params.types ?? [],
            seatbelts: params.seatbelts ?? null,
            beds: params.beds ?? null,
            equipment: params.equipment ?? ["ac", "shower_int", "fridge"],
            page_size: params.page_size ?? 20,
          });

          const mapped = batchResult.results.map((r) => ({
            site: s.name,
            ...r,
          }));
          allResults.push(...mapped);
          totalSuccess += batchResult.summary.success;
          totalError += batchResult.summary.error;
        }

        logger.info(`[Tool/camper_scraper] Completado: ${totalSuccess} success, ${totalError} error.`);
        return {
          status:
            totalError === 0
              ? "success"
              : totalSuccess > 0
                ? "partial"
                : "error",
          results: allResults,
        };
      },
    },
    { optional: true },
  );

  // ─────────────────────────────────────────────────────────────────────────
  // TOOL: send_report_email
  // ─────────────────────────────────────────────────────────────────────────
  api.registerTool(
    {
      name: "send_report_email",
      description: `Sends a Markdown file as a formatted HTML email via the email service.
Reads the file at the given absolute path and posts it to the configured
EMAIL_SERVICE_URL. Use after writing report.md to deliver results to the
recipient configured in the email service.`,
      parameters: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description: "Absolute path to the Markdown file to send.",
          },
          subject: {
            type: "string",
            description: "Email subject line.",
          },
        },
        required: ["file_path", "subject"],
      },
      async execute(_id: string, params: any) {
        const emailServiceUrl =
          config.emailServiceUrl ||
          process.env.EMAIL_SERVICE_URL ||
          "http://localhost:3000";

        // Read the markdown file
        let body: string;
        try {
          body = readFileSync(params.file_path, "utf-8");
        } catch (err: any) {
          return {
            status: "error",
            reason: "file_read_failed",
            message: `Could not read file at "${params.file_path}": ${err.message}`,
          };
        }

        // POST to the email service
        let response: Response;
        try {
          response = await fetch(`${emailServiceUrl}/api/email`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ subject: params.subject, body }),
          });
        } catch (err: any) {
          return {
            status: "error",
            reason: "email_service_unreachable",
            message: `Could not reach email service at "${emailServiceUrl}": ${err.message}`,
          };
        }

        if (!response.ok) {
          let detail = "";
          try {
            const json = await response.json();
            detail = json.error ?? JSON.stringify(json);
          } catch {
            detail = await response.text();
          }
          return {
            status: "error",
            reason: "email_service_error",
            message: `Email service responded ${response.status}: ${detail}`,
          };
        }

        const result = await response.json();
        return {
          status: "success",
          messageId: result.messageId,
        };
      },
    },
    { optional: true },
  );
}
