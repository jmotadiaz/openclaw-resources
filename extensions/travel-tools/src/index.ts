// extensions/travel-tools/src/index.ts
// ═══════════════════════════════════════════════════════════════════════════════
// Tool registrations for OpenClaw.
// Each tool is a thin wrapper that delegates to a function in actions.ts.
// All business logic lives in actions.ts and can be called directly from
// scripts without any LLM or agent runtime.
// ═══════════════════════════════════════════════════════════════════════════════

import { resolve } from "path";
import * as actions from "./actions";

const DB_PATH = resolve(__dirname, "../travel.sqlite");

export function register(api: any, config: any = {}) {
  const dbPath = config.dbPath || DB_PATH;
  const emailServiceUrl =
    config.emailServiceUrl ||
    process.env.EMAIL_SERVICE_URL ||
    "http://localhost:3000";

  // ═══════════════════════════════════════════════════════════════════════════
  // PLAN TOOLS
  // ═══════════════════════════════════════════════════════════════════════════

  api.registerTool({
    name: "train_plan_init",
    description:
      "Initializes a train travel planning session. Returns next_skill to guide the agent to the next phase.",
    parameters: {
      type: "object",
      required: [
        "session_id",
        "transport",
        "trip_type",
        "routes",
        "months",
        "constraints",
      ],
      properties: {
        session_id: { type: "string" },
        transport: { type: "string", enum: ["flight", "train"] },
        trip_type: {
          type: "string",
          enum: ["one-way", "round-trip", "open-jaw"],
        },
        routes: {
          type: "array",
          items: {
            type: "object",
            required: ["origin", "destination"],
            properties: {
              origin: { type: "string" },
              destination: { type: "string" },
            },
          },
        },
        months: { type: "array", items: { type: "string" } },
        constraints: {
          type: "object",
          required: ["adults", "children"],
          properties: {
            adults: { type: "number" },
            children: { type: "array", items: { type: "number" } },
            min_days: { type: "number" },
            max_days: { type: "number" },
          },
        },
        mode: { type: "string", enum: ["explore", "direct"] },
        combinations: {
          type: "array",
          items: {
            type: "object",
            required: ["origin", "destination", "exact_date"],
            properties: {
              origin: { type: "string" },
              destination: { type: "string" },
              exact_date: { type: "string" },
              return_date: { type: "string" },
            },
          },
        },
      },
    },
    execute: (_id: string, params: any) => actions.trainPlanInit(params),
  });

  api.registerTool({
    name: "train_plan_mark",
    description:
      "Updates status of checklist items in a train travel plan. Returns next_skill.",
    parameters: {
      type: "object",
      required: ["session_id", "items"],
      properties: {
        session_id: { type: "string" },
        items: {
          type: "array",
          items: {
            type: "object",
            required: ["task", "status"],
            properties: {
              task: { type: "string" },
              status: {
                type: "string",
                enum: ["todo", "doing", "done", "failed"],
              },
              note: { type: "string" },
            },
          },
        },
      },
    },
    execute: (_id: string, params: any) =>
      actions.trainPlanMark(params.session_id, params.items),
  });

  api.registerTool({
    name: "train_plan_append_searches",
    description:
      "Appends granular search combinations to the train plan's search checklist.",
    parameters: {
      type: "object",
      required: ["session_id", "combinations"],
      properties: {
        session_id: { type: "string" },
        combinations: {
          type: "array",
          items: {
            type: "object",
            required: ["description"],
            properties: { description: { type: "string" } },
          },
        },
      },
    },
    execute: (_id: string, params: any) =>
      actions.trainPlanAppendSearches(params.session_id, params.combinations),
  });

  api.registerTool({
    name: "train_plan_status",
    description:
      "Returns a compact summary of the current train travel session state.",
    parameters: {
      type: "object",
      required: ["session_id"],
      properties: { session_id: { type: "string" } },
    },
    execute: (_id: string, params: any) =>
      actions.trainPlanStatus(params.session_id),
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // REPORT TOOLS
  // ═══════════════════════════════════════════════════════════════════════════

  api.registerTool({
    name: "report_build",
    description:
      "Renders the final report.md based on DB results and the session plan.",
    parameters: {
      type: "object",
      required: ["session_id"],
      properties: { session_id: { type: "string" } },
    },
    execute: (_id: string, params: any) =>
      actions.reportBuild(params.session_id, dbPath),
  });

  api.registerTool({
    name: "report_send",
    description: "Sends the generated report.md as an email.",
    parameters: {
      type: "object",
      required: ["session_id", "subject"],
      properties: {
        session_id: { type: "string" },
        subject: { type: "string" },
      },
    },
    execute: (_id: string, params: any) =>
      actions.reportSend(params.session_id, params.subject, emailServiceUrl),
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // RANKED CAMPERS
  // ═══════════════════════════════════════════════════════════════════════════

  api.registerTool({
    name: "store_ranked_campers",
    description: "Persists LLM-evaluated camper rankings to the database.",
    parameters: {
      type: "object",
      required: ["session_id", "results"],
      properties: {
        session_id: { type: "string" },
        results: {
          type: "array",
          items: {
            type: "object",
            required: [
              "city",
              "date_from",
              "date_to",
              "option_id",
              "rank",
              "score",
            ],
            properties: {
              city: { type: "string" },
              date_from: { type: "string" },
              date_to: { type: "string" },
              option_id: { type: "number" },
              rank: { type: "number" },
              score: { type: "number" },
              score_reason: { type: "string" },
              station_dist_km: { type: "number" },
            },
          },
        },
      },
    },
    execute: (_id: string, params: any) =>
      actions.storeRankedCampers(params.session_id, params.results, dbPath),
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SCOUT TOOLS
  // ═══════════════════════════════════════════════════════════════════════════

  api.registerTool(
    {
      name: "date_scout",
      description:
        "Scouts cheapest flight dates for one or more route/month combinations across all available strategies.",
      parameters: {
        type: "object",
        required: ["session_id", "routes"],
        properties: {
          session_id: { type: "string" },
          routes: {
            type: "array",
            items: {
              type: "object",
              required: ["origin", "destination", "month"],
              properties: {
                origin: { type: "string" },
                destination: { type: "string" },
                month: { type: "string" },
              },
            },
          },
        },
      },
      execute: (_id: string, params: any) =>
        actions.dateScout(params.session_id, params.routes, dbPath),
    },
    { optional: true },
  );

  api.registerTool(
    {
      name: "train_scout",
      description:
        "Scouts cheapest train dates via trenes.com API. Accepts city names in Spanish.",
      parameters: {
        type: "object",
        required: ["session_id", "routes"],
        properties: {
          session_id: { type: "string" },
          routes: {
            type: "array",
            items: {
              type: "object",
              required: ["origin_city", "destination_city", "month"],
              properties: {
                origin_city: { type: "string" },
                destination_city: { type: "string" },
                month: { type: "string" },
              },
            },
          },
        },
      },
      execute: (_id: string, params: any) =>
        actions.trainScout(params.session_id, params.routes, dbPath),
    },
    { optional: true },
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // SCRAPER TOOLS
  // ═══════════════════════════════════════════════════════════════════════════

  api.registerTool(
    {
      name: "flight_scraper",
      description: "Searches flights across Skyscanner and Kayak concurrently.",
      parameters: {
        type: "object",
        required: ["session_id", "pax", "combinations"],
        properties: {
          session_id: { type: "string" },
          pax: { type: "number" },
          combinations: {
            type: "array",
            items: {
              type: "object",
              required: ["origin", "destination", "exact_date"],
              properties: {
                origin: { type: "string" },
                destination: { type: "string" },
                exact_date: { type: "string" },
                return_date: { type: "string" },
              },
            },
          },
        },
      },
      execute: (_id: string, params: any) =>
        actions.flightScraper(
          params.session_id,
          params.pax,
          params.combinations,
          dbPath,
        ),
    },
    { optional: true },
  );

  api.registerTool(
    {
      name: "train_scraper",
      description:
        "Searches trains via Kayak. All combinations run concurrently.",
      parameters: {
        type: "object",
        required: ["session_id", "adults", "combinations"],
        properties: {
          session_id: { type: "string" },
          adults: { type: "number" },
          children: { type: "array", items: { type: "number" } },
          combinations: {
            type: "array",
            items: {
              type: "object",
              required: ["origin", "destination", "exact_date"],
              properties: {
                origin: { type: "string" },
                destination: { type: "string" },
                exact_date: { type: "string" },
                return_date: { type: "string" },
              },
            },
          },
        },
      },
      execute: (_id: string, params: any) =>
        actions.trainScraper(
          params.session_id,
          params.adults,
          params.children ?? [],
          params.combinations,
          dbPath,
        ),
    },
    { optional: true },
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // DATE COMBINATION EXTRACTORS
  // ═══════════════════════════════════════════════════════════════════════════

  api.registerTool({
    name: "find_best_date_combinations",
    description:
      "Analiza los datos de scouting (Skyscanner) y devuelve las mejores ventanas de fechas.",
    parameters: {
      type: "object",
      required: ["origin", "destination", "session_id"],
      properties: {
        origin: { type: "string" },
        destination: { type: "string" },
        session_id: { type: "string" },
        top: { type: "number" },
        months: { type: "string" },
        min_days: { type: "number" },
        max_days: { type: "number" },
        return_origin: { type: "string" },
        return_destination: { type: "string" },
      },
    },
    execute: (_id: string, params: any) =>
      actions.findBestDateCombinations(params, dbPath),
  });

  api.registerTool({
    name: "find_best_train_date_combinations",
    description:
      "Analyzes train scouting data and returns the best date windows.",
    parameters: {
      type: "object",
      required: ["session_id", "origin_city", "destination_city"],
      properties: {
        session_id: { type: "string" },
        origin_city: { type: "string" },
        destination_city: { type: "string" },
        months: { type: "string" },
        min_days: { type: "number" },
        max_days: { type: "number" },
        top: { type: "number" },
        return_origin_city: { type: "string" },
        return_destination_city: { type: "string" },
      },
    },
    execute: (_id: string, params: any) =>
      actions.findBestTrainDateCombinations(params, dbPath),
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CONSOLIDATION (DB READ-ONLY)
  // ═══════════════════════════════════════════════════════════════════════════

  api.registerTool({
    name: "consolidate_final_flight_report",
    description:
      "Retrieves verified flight options from the DB. CALL ONCE per session.",
    parameters: {
      type: "object",
      required: ["session_id"],
      properties: {
        session_id: { type: "string" },
        origin: { type: "string" },
        destination: { type: "string" },
        limit: { type: "number" },
        sort_by: { type: "string", enum: ["price", "dep_time", "stops"] },
        sort_dir: { type: "string", enum: ["asc", "desc"] },
      },
    },
    execute: (_id: string, params: any) =>
      actions.consolidateFlightReport(params, dbPath),
  });

  api.registerTool({
    name: "consolidate_final_train_report",
    description: "Retrieves verified train options from the DB.",
    parameters: {
      type: "object",
      required: ["session_id"],
      properties: {
        session_id: { type: "string" },
        origin: { type: "string" },
        destination: { type: "string" },
        limit: { type: "number" },
        sort_by: { type: "string", enum: ["price", "dep_time", "changes"] },
        sort_dir: { type: "string", enum: ["asc", "desc"] },
      },
    },
    execute: (_id: string, params: any) =>
      actions.consolidateTrainReport(params, dbPath),
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CAMPER TOOLS
  // ═══════════════════════════════════════════════════════════════════════════

  api.registerTool({
    name: "fetch_campers_for_analysis",
    description:
      "Retrieves top-N campers per vehicle type for LLM reranking. CALL EXACTLY ONCE.",
    parameters: {
      type: "object",
      required: ["session_id", "combinations"],
      properties: {
        session_id: { type: "string" },
        combinations: {
          type: "array",
          items: {
            type: "object",
            required: ["city", "date_from", "date_to"],
            properties: {
              city: { type: "string" },
              date_from: { type: "string" },
              date_to: { type: "string" },
            },
          },
        },
        limit_per_type: { type: "number" },
      },
    },
    execute: (_id: string, params: any) =>
      actions.fetchCampersForAnalysis(params, dbPath),
  });

  api.registerTool(
    {
      name: "camper_scraper",
      description: "Busca autocaravanas en Yescapa con filtros avanzados.",
      parameters: {
        type: "object",
        required: ["session_id", "combinations"],
        properties: {
          session_id: { type: "string" },
          combinations: {
            type: "array",
            items: {
              type: "object",
              required: ["city", "date_from", "date_to"],
              properties: {
                city: { type: "string" },
                date_from: { type: "string" },
                date_to: { type: "string" },
              },
            },
          },
          types: { type: "array", items: { type: "number" } },
          seatbelts: { type: "number" },
          beds: { type: "number" },
          equipment: { type: "array", items: { type: "string" } },
          page_size: { type: "number" },
        },
      },
      execute: (_id: string, params: any) =>
        actions.camperScraper(params, dbPath),
    },
    { optional: true },
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // LEGACY / COMPAT
  // ═══════════════════════════════════════════════════════════════════════════

  api.registerTool(
    {
      name: "send_report_email",
      description:
        "Sends a Markdown file as a formatted HTML email. Legacy — prefer report_send.",
      parameters: {
        type: "object",
        required: ["file_path", "subject"],
        properties: {
          file_path: { type: "string" },
          subject: { type: "string" },
        },
      },
      execute: (_id: string, params: any) =>
        actions.sendReportEmail(
          params.file_path,
          params.subject,
          emailServiceUrl,
        ),
    },
    { optional: true },
  );

  api.registerTool(
    {
      name: "camper_store",
      description: "Legacy camper results store. Prefer store_ranked_campers.",
      parameters: {
        type: "object",
        required: ["session_id", "namespace", "data"],
        properties: {
          session_id: { type: "string" },
          namespace: { type: "string" },
          data: { type: "object" },
        },
      },
      execute: (_id: string, params: any) =>
        actions.camperStoreAction(
          params.session_id,
          params.namespace,
          params.data,
        ),
    },
    { optional: true },
  );

  api.registerTool({
    name: "camper_fetch",
    description:
      "Retrieves a camper results payload previously stored via camper_store.",
    parameters: {
      type: "object",
      required: ["session_id", "namespace"],
      properties: {
        session_id: { type: "string" },
        namespace: { type: "string" },
      },
    },
    execute: (_id: string, params: any) =>
      actions.camperFetchAction(params.session_id, params.namespace),
  });
}
