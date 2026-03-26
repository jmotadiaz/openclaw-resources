import { SkyscannerStrategy } from "./strategies/skyscanner/SkyscannerStrategy";
import { KayakFlightStrategy } from "./strategies/kayak/KayakFlightStrategy";
import { KayakTrainStrategy } from "./strategies/kayak/KayakTrainStrategy";
import { TrenesComScoutStrategy } from "./strategies/trenes-com/TrenesComScoutStrategy";
import { resolveStation } from "./strategies/trenes-com/trenes-com-api";
import { YescapaStrategy } from "./strategies/yescapa/YescapaStrategy";
import { CamperScraperStrategy } from "./strategies/CamperScraperStrategy";
import { resolve } from "path";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import {
  TravelDB,
  QueryResultRow,
  TrainQueryResultRow,
  RankedCamperRow,
} from "./utils/db";
import { logger } from "./utils/logger";
import { camperWrite, camperRead, planWrite, planRead } from "./utils/store";
import { inferNextTrainSkill, inferNextPhase } from "./templates/helpers";
import { PlanState, renderPlanMarkdown } from "./templates/plan-markdown";
import { renderTrainReport } from "./templates/train-report";
import { renderFlightReport } from "./templates/flight-report";

const DB_PATH = resolve(__dirname, "../travel.sqlite");

// ═══════════════════════════════════════════════════════════════════════════════
// TOOL REGISTRATION
// ═══════════════════════════════════════════════════════════════════════════════

export function register(api: any, config: any = {}) {
  const dbPath = config.dbPath || DB_PATH;

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

  // ═══════════════════════════════════════════════════════════════════════════
  // PLAN TOOLS (NEW)
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
        months: {
          type: "array",
          description: "Requerido cuando mode='explore'.",
          items: { type: "string" },
        },
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
        mode: {
          type: "string",
          enum: ["explore", "direct"],
          description:
            "explore = fechas abiertas (flujo completo con scouting). direct = rutas/fechas concretas (salta al scraping).",
        },
        combinations: {
          type: "array",
          description:
            "Requerido cuando mode='direct'. Origen y destino deben ser codigos IATA.",
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
    async execute(_id: string, params: any) {
      const mode = params.mode ?? "explore";
      const isDirect = mode === "direct";

      // ── Validación: direct requiere combinations ──
      if (
        isDirect &&
        (!params.combinations || params.combinations.length === 0)
      ) {
        return {
          status: "error",
          message: "mode='direct' requires at least one combination.",
        };
      }

      // ── Checklist principal ──
      const checklist: Array<{
        task: string;
        status: "todo" | "doing" | "done" | "failed";
        note?: string;
      }> = [
        { task: "Session Init", status: "done" },
        {
          task: "Scouting Phase",
          status: isDirect ? "done" : "todo",
          ...(isDirect && { note: "Skipped (direct mode)" }),
        },
        {
          task: "Extractor Phase",
          status: isDirect ? "done" : "todo",
          ...(isDirect && { note: "Skipped (direct mode)" }),
        },
        {
          task: "Search Checklist",
          status: isDirect ? "done" : "todo",
          ...(isDirect && { note: "Pre-filled (direct mode)" }),
        },
        { task: "Scraping Phase", status: "todo" },
        { task: "Final Report", status: "todo" },
      ];
      if (params.transport === "train") {
        checklist.push({ task: "Email Report", status: "todo" });
      }

      // ── Search checklist: pre-rellenar en modo direct ──
      const searchChecklist: Array<{
        id: number;
        description: string;
        status: "todo" | "doing" | "done" | "failed";
      }> = [];

      if (isDirect) {
        params.combinations.forEach((c: any, idx: number) => {
          const ret = c.return_date ? ` ↩ ${c.return_date}` : "";
          searchChecklist.push({
            id: idx + 1,
            description: `${c.origin} → ${c.destination} ${c.exact_date}${ret}`,
            status: "todo",
          });
        });
      }

      // ── Construir plan ──
      const plan: PlanState = {
        session_id: params.session_id,
        transport: params.transport,
        trip_type: params.trip_type,
        routes: params.routes,
        months: params.months,
        constraints: {
          min_days: params.constraints.min_days ?? 2,
          max_days: params.constraints.max_days ?? 14,
          adults: params.constraints.adults,
          children: params.constraints.children ?? [],
        },
        checklist,
        search_checklist: searchChecklist,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      planWrite(params.session_id, plan);

      const resDir = `/home/openclaw/.openclaw/workspace/resources/${params.session_id}`;
      mkdirSync(resDir, { recursive: true });
      writeFileSync(`${resDir}/plan.md`, renderPlanMarkdown(plan), "utf8");

      return {
        status: "success",
        mode,
        next_skill: isDirect ? "travel-train-scrape" : "travel-train-scout",
        session_id: params.session_id,
      };
    },
  });

  api.registerTool({
    name: "train_plan_mark",
    description:
      "Updates status of checklist items in a train travel plan. Returns next_skill for the next phase.",
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
              task: {
                type: "string",
                description: "Literal match or substring",
              },
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
    async execute(_id: string, params: any) {
      const plan = planRead(params.session_id) as PlanState | null;
      if (!plan) return { status: "error", message: "Plan not found" };

      for (const update of params.items) {
        const needle = update.task.toLowerCase();
        // Check main checklist
        const main = plan.checklist.find((i) =>
          i.task.toLowerCase().includes(needle),
        );
        if (main) {
          main.status = update.status;
          if (update.note) main.note = update.note;
          continue;
        }
        // Check search checklist
        const search = plan.search_checklist?.find((i) =>
          i.description.toLowerCase().includes(needle),
        );
        if (search) {
          search.status = update.status;
        }
      }

      plan.updated_at = new Date().toISOString();
      planWrite(params.session_id, plan);
      const resDir = `/home/openclaw/.openclaw/workspace/resources/${params.session_id}`;
      writeFileSync(`${resDir}/plan.md`, renderPlanMarkdown(plan), "utf8");

      return { status: "success", next_skill: inferNextTrainSkill(plan) };
    },
  });

  api.registerTool({
    name: "train_plan_append_searches",
    description:
      "Appends granular search combinations to the train plan's search checklist. Returns next_skill for the next phase.",
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
    async execute(_id: string, params: any) {
      const plan = planRead(params.session_id) as PlanState | null;
      if (!plan) return { status: "error", message: "Plan not found" };

      const startId = (plan.search_checklist?.length ?? 0) + 1;
      params.combinations.forEach((combo: any, idx: number) => {
        if (!plan.search_checklist) plan.search_checklist = [];
        plan.search_checklist.push({
          id: startId + idx,
          description: combo.description,
          status: "todo",
        });
      });

      // Mark "Search Checklist" step as done
      const scItem = plan.checklist.find((i) =>
        i.task.toLowerCase().includes("search checklist"),
      );
      if (scItem) scItem.status = "done";

      plan.updated_at = new Date().toISOString();
      planWrite(params.session_id, plan);
      const resDir = `/home/openclaw/.openclaw/workspace/resources/${params.session_id}`;
      writeFileSync(`${resDir}/plan.md`, renderPlanMarkdown(plan), "utf8");

      return {
        status: "success",
        count: params.combinations.length,
        next_skill: inferNextTrainSkill(plan),
      };
    },
  });

  api.registerTool({
    name: "train_plan_status",
    description:
      "Returns a compact summary of the current train travel session state, including next_skill.",
    parameters: {
      type: "object",
      required: ["session_id"],
      properties: { session_id: { type: "string" } },
    },
    async execute(_id: string, params: any) {
      const plan = planRead(params.session_id) as PlanState | null;
      if (!plan) return { status: "error", message: "Plan not found" };

      const all = [
        ...plan.checklist,
        ...(plan.search_checklist ?? []).map((s) => ({
          task: s.description,
          status: s.status,
        })),
      ];
      return {
        status: "success",
        transport: plan.transport,
        trip_type: plan.trip_type,
        current_phase: inferNextPhase(plan),
        next_skill: inferNextTrainSkill(plan),
        done: all.filter((i) => i.status === "done").length,
        failed: all.filter((i) => i.status === "failed").length,
        pending: all.filter((i) => i.status === "todo").length,
        total: all.length,
      };
    },
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // REPORT TOOLS (NEW)
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
    async execute(_id: string, params: any) {
      const plan = planRead(params.session_id) as PlanState | null;
      if (!plan) return { status: "error", message: "Plan not found" };

      const db = new TravelDB(dbPath);
      try {
        let markdown: string;

        if (plan.transport === "train") {
          // ← CHANGED: session-only query, no origin/destination filter
          const rows = db.queryTrainOptions({
            session_id: params.session_id,
            limit: 2,
            sort_by: "price",
            sort_dir: "asc",
          });
          const camperRows = db.getRankedCampers(params.session_id);
          markdown = renderTrainReport(plan, rows, camperRows);
        } else {
          const rows = db.queryFlightOptions({
            session_id: params.session_id,
            limit: 2,
            sort_by: "price",
            sort_dir: "asc",
          });
          markdown = renderFlightReport(plan, rows);
        }

        const resDir = `/home/openclaw/.openclaw/workspace/resources/${params.session_id}`;
        mkdirSync(resDir, { recursive: true });
        const reportPath = `${resDir}/report.md`;
        writeFileSync(reportPath, markdown, "utf8");

        // Build a compact summary for the orchestrator's chat reply
        const optionCount = (markdown.match(/### [🗓️✈️]/g) || []).length;
        const summary =
          optionCount > 0
            ? `${optionCount} opciones generadas`
            : "Sin resultados";

        return { status: "success", report_path: reportPath, summary };
      } catch (error: any) {
        return { status: "error", message: error.message };
      } finally {
        db.close();
      }
    },
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
    async execute(_id: string, params: any) {
      const resDir = `/home/openclaw/.openclaw/workspace/resources/${params.session_id}`;
      const reportPath = `${resDir}/report.md`;

      if (!existsSync(reportPath)) {
        return {
          status: "error",
          message: "report.md not found. Run report_build first.",
        };
      }

      const body = readFileSync(reportPath, "utf-8");
      const emailServiceUrl =
        config.emailServiceUrl ||
        process.env.EMAIL_SERVICE_URL ||
        "http://localhost:3000";

      try {
        const response = await fetch(`${emailServiceUrl}/api/email`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subject: params.subject, body }),
        });
        if (!response.ok) {
          const detail = await response.text();
          return {
            status: "error",
            message: `Email service ${response.status}: ${detail}`,
          };
        }
        const result = await response.json();
        return { status: "success", messageId: result.messageId };
      } catch (err: any) {
        return { status: "error", message: err.message };
      }
    },
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // RANKED CAMPERS TOOL (NEW — replaces camper_store for the subagent)
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
    async execute(_id: string, params: any) {
      const db = new TravelDB(dbPath);
      try {
        for (const r of params.results) {
          db.upsertRankedCamper({
            session_id: params.session_id,
            city: r.city,
            date_from: r.date_from,
            date_to: r.date_to,
            option_id: r.option_id,
            rank: r.rank,
            score: r.score,
            score_reason: r.score_reason,
            station_dist_km: r.station_dist_km,
          });
        }
        return { status: "success", count: params.results.length };
      } catch (e: any) {
        return { status: "error", message: e.message };
      } finally {
        db.close();
      }
    },
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // EXISTING TOOLS (unchanged)
  // ═══════════════════════════════════════════════════════════════════════════

  // ─── date_scout ─────────────────────────────────────────────────────────────
  api.registerTool(
    {
      name: "date_scout",
      description: `Scouts cheapest flight dates for one or more route/month combinations across all available strategies.`,
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

  // ─── train_scout ────────────────────────────────────────────────────────────
  api.registerTool(
    {
      name: "train_scout",
      description: `Scouts cheapest train dates via trenes.com API. Accepts city names in Spanish.`,
      parameters: {
        type: "object",
        properties: {
          session_id: { type: "string" },
          routes: {
            type: "array",
            items: {
              type: "object",
              properties: {
                origin_city: {
                  type: "string",
                  description: "City name in Spanish",
                },
                destination_city: {
                  type: "string",
                  description: "City name in Spanish",
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

  // ─── flight_scraper ─────────────────────────────────────────────────────────
  api.registerTool(
    {
      name: "flight_scraper",
      description: `Searches flights across Skyscanner and Kayak concurrently.`,
      parameters: {
        type: "object",
        properties: {
          session_id: { type: "string" },
          pax: { type: "number" },
          combinations: {
            type: "array",
            items: {
              type: "object",
              properties: {
                origin: { type: "string" },
                destination: { type: "string" },
                exact_date: { type: "string" },
                return_date: { type: "string" },
              },
              required: ["origin", "destination", "exact_date"],
            },
          },
        },
        required: ["session_id", "pax", "combinations"],
      },
      async execute(_id: string, params: any) {
        const allResults: any[] = [];
        let totalSuccess = 0,
          totalError = 0;
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
          allResults.push(
            ...batchResult.results.map((r) => ({ site: s.name, ...r })),
          );
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

  // ─── train_scraper ──────────────────────────────────────────────────────────
  api.registerTool(
    {
      name: "train_scraper",
      description: `Searches trains via Kayak. All combinations run concurrently.`,
      parameters: {
        type: "object",
        properties: {
          session_id: { type: "string" },
          adults: { type: "number" },
          children: { type: "array", items: { type: "number" } },
          combinations: {
            type: "array",
            items: {
              type: "object",
              properties: {
                origin: { type: "string" },
                destination: { type: "string" },
                exact_date: { type: "string" },
                return_date: { type: "string" },
              },
              required: ["origin", "destination", "exact_date"],
            },
          },
        },
        required: ["session_id", "adults", "combinations"],
      },
      async execute(_id: string, params: any) {
        const allResults: any[] = [];
        let totalSuccess = 0,
          totalError = 0;
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
          allResults.push(
            ...batchResult.results.map((r) => ({ site: s.name, ...r })),
          );
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

  // ─── find_best_date_combinations ────────────────────────────────────────────
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
        months: { type: "string" },
        min_days: { type: "number" },
        max_days: { type: "number" },
        return_origin: { type: "string" },
        return_destination: { type: "string" },
      },
      required: ["origin", "destination", "session_id"],
    },
    async execute(_id: string, params: any) {
      const db = new TravelDB(dbPath);
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

  // ─── find_best_train_date_combinations ──────────────────────────────────────
  api.registerTool({
    name: "find_best_train_date_combinations",
    description: `Analyzes train scouting data and returns the best date windows.`,
    parameters: {
      type: "object",
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
      required: ["session_id", "origin_city", "destination_city"],
    },
    async execute(_id: string, params: any) {
      const db = new TravelDB(dbPath);
      try {
        const months = params.months
          ? params.months.split(",").map((m: string) => m.trim())
          : [];
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
        if (params.return_origin_city)
          retOriginStation = await resolveStation(params.return_origin_city);
        if (params.return_destination_city)
          retDestinationStation = await resolveStation(
            params.return_destination_city,
          );

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

  // ─── consolidate_final_flight_report ────────────────────────────────────────
  api.registerTool({
    name: "consolidate_final_flight_report",
    description: `Retrieves verified flight options from the DB. CALL ONCE per session.`,
    parameters: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        origin: { type: "string" },
        destination: { type: "string" },
        limit: { type: "number" },
        sort_by: { type: "string", enum: ["price", "dep_time", "stops"] },
        sort_dir: { type: "string", enum: ["asc", "desc"] },
      },
      required: ["session_id"],
    },
    async execute(_id: string, params: any) {
      const db = new TravelDB(dbPath);
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

  // ─── consolidate_final_train_report ─────────────────────────────────────────
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
      const db = new TravelDB(dbPath);
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

  // ─── fetch_campers_for_analysis ─────────────────────────────────────────────
  api.registerTool({
    name: "fetch_campers_for_analysis",
    description: `Retrieves top-N campers per vehicle type for LLM reranking. CALL EXACTLY ONCE.`,
    parameters: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        combinations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              city: { type: "string" },
              date_from: { type: "string" },
              date_to: { type: "string" },
            },
            required: ["city", "date_from", "date_to"],
          },
        },
        limit_per_type: { type: "number" },
      },
      required: ["session_id", "combinations"],
    },
    async execute(_id: string, params: any) {
      const db = new TravelDB(dbPath);
      try {
        logger.info(
          "Fetching campers for analysis",
          JSON.stringify({ params }),
        );
        const results = db.queryCamperOptionsMulti({
          session_id: params.session_id,
          combinations: params.combinations,
          limit: params.limit_per_type ?? 5,
          group_by_type: true,
          sort_by: "price",
          sort_dir: "asc",
        });
        logger.info(
          "Fetched campers for analysis",
          JSON.stringify({ results }),
        );
        return { status: "success", data: results };
      } catch (error: any) {
        logger.error("Error fetching campers for analysis", error.message);
        return { status: "error", message: error.message };
      } finally {
        db.close();
      }
    },
  });

  // ─── camper_scraper ─────────────────────────────────────────────────────────
  api.registerTool(
    {
      name: "camper_scraper",
      description: `Busca autocaravanas en Yescapa con filtros avanzados.`,
      parameters: {
        type: "object",
        properties: {
          session_id: { type: "string" },
          combinations: {
            type: "array",
            items: {
              type: "object",
              properties: {
                city: { type: "string" },
                date_from: { type: "string" },
                date_to: { type: "string" },
              },
              required: ["city", "date_from", "date_to"],
            },
          },
          types: { type: "array", items: { type: "number" } },
          seatbelts: { type: "number" },
          beds: { type: "number" },
          equipment: { type: "array", items: { type: "string" } },
          page_size: { type: "number" },
        },
        required: ["session_id", "combinations"],
      },
      async execute(_id: string, params: any) {
        const allResults: any[] = [];
        let totalSuccess = 0,
          totalError = 0;
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
          allResults.push(
            ...batchResult.results.map((r) => ({ site: s.name, ...r })),
          );
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

  // ─── send_report_email (legacy — kept for backward compat) ──────────────────
  api.registerTool(
    {
      name: "send_report_email",
      description: `Sends a Markdown file as a formatted HTML email. Legacy — prefer report_send.`,
      parameters: {
        type: "object",
        properties: {
          file_path: { type: "string" },
          subject: { type: "string" },
        },
        required: ["file_path", "subject"],
      },
      async execute(_id: string, params: any) {
        const emailServiceUrl =
          config.emailServiceUrl ||
          process.env.EMAIL_SERVICE_URL ||
          "http://localhost:3000";
        let body: string;
        try {
          body = readFileSync(params.file_path, "utf-8");
        } catch (err: any) {
          return {
            status: "error",
            reason: "file_read_failed",
            message: err.message,
          };
        }
        try {
          const response = await fetch(`${emailServiceUrl}/api/email`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ subject: params.subject, body }),
          });
          if (!response.ok) {
            return { status: "error", message: `${response.status}` };
          }
          const result = await response.json();
          return { status: "success", messageId: result.messageId };
        } catch (err: any) {
          return { status: "error", message: err.message };
        }
      },
    },
    { optional: true },
  );

  // ─── camper_store (legacy — kept for backward compat) ───────────────────────
  api.registerTool(
    {
      name: "camper_store",
      description: `Legacy camper results store. Prefer store_ranked_campers.`,
      parameters: {
        type: "object",
        properties: {
          session_id: { type: "string" },
          namespace: { type: "string" },
          data: { type: "object" },
        },
        required: ["session_id", "namespace", "data"],
      },
      async execute(_id: string, params: any) {
        try {
          camperWrite(params.session_id, params.namespace, params.data);
          return {
            status: "success",
            session_id: params.session_id,
            namespace: params.namespace,
          };
        } catch (e: any) {
          return { status: "error", message: e.message };
        }
      },
    },
    { optional: true },
  );

  // ─── camper_fetch ───────────────────────────────────────────────────────────
  api.registerTool({
    name: "camper_fetch",
    description: `Retrieves a camper results payload previously stored via camper_store.`,
    parameters: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        namespace: { type: "string" },
      },
      required: ["session_id", "namespace"],
    },
    async execute(_id: string, params: any) {
      try {
        const data = camperRead(params.session_id, params.namespace);
        if (data === null)
          return {
            status: "not_found",
            session_id: params.session_id,
            namespace: params.namespace,
          };
        return {
          status: "success",
          session_id: params.session_id,
          namespace: params.namespace,
          data,
        };
      } catch (e: any) {
        return { status: "error", message: e.message };
      }
    },
  });
}
