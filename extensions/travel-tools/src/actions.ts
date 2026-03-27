// extensions/travel-tools/src/actions.ts
// ═══════════════════════════════════════════════════════════════════════════════
// Standalone business-logic functions.
// Every function is fully self-contained: receives typed params, returns a
// result object. No dependency on OpenClaw, MCP, or any LLM runtime.
// The tool registrations in index.ts are thin wrappers around these.
// ═══════════════════════════════════════════════════════════════════════════════

import { resolve } from "path";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";

import { SkyscannerStrategy } from "./strategies/skyscanner/SkyscannerStrategy";
import { KayakFlightStrategy } from "./strategies/kayak/KayakFlightStrategy";
import { KayakTrainStrategy } from "./strategies/kayak/KayakTrainStrategy";
import { TrenesComScoutStrategy } from "./strategies/trenes-com/TrenesComScoutStrategy";
import { resolveStation } from "./strategies/trenes-com/trenes-com-api";
import { YescapaStrategy } from "./strategies/yescapa/YescapaStrategy";
import { CamperScraperStrategy } from "./strategies/CamperScraperStrategy";

import { TravelDB, RankedCamperRow } from "./utils/db";
import { logger } from "./utils/logger";
import { camperWrite, camperRead, planWrite, planRead } from "./utils/store";
import { inferNextTrainSkill, inferNextPhase } from "./templates/helpers";
import { PlanState, renderPlanMarkdown } from "./templates/plan-markdown";
import { renderTrainReport } from "./templates/train-report";
import { renderFlightReport } from "./templates/flight-report";

// ─── Strategy singletons ────────────────────────────────────────────────────

const skyscanner = new SkyscannerStrategy();
const kayakFlight = new KayakFlightStrategy();
const kayakTrain = new KayakTrainStrategy();
const trenesComScout = new TrenesComScoutStrategy();
const yescapa = new YescapaStrategy();

const flightStrategies = [
  { name: "skyscanner", strategy: skyscanner },
  { name: "kayak", strategy: kayakFlight },
];

const trainStrategies = [{ name: "kayak", strategy: kayakTrain }];

const camperStrategies: Array<{
  name: string;
  strategy: CamperScraperStrategy;
}> = [{ name: "yescapa", strategy: yescapa }];

// ─── Constants ──────────────────────────────────────────────────────────────

const WORKSPACE_RESOURCES = "/home/openclaw/.openclaw/workspace/resources";

function resDir(session_id: string): string {
  return `${WORKSPACE_RESOURCES}/${session_id}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PLAN ACTIONS
// ═══════════════════════════════════════════════════════════════════════════════

export interface TrainPlanInitParams {
  session_id: string;
  transport: "flight" | "train";
  trip_type: "one-way" | "round-trip" | "open-jaw";
  routes: Array<{ origin: string; destination: string }>;
  months: string[];
  constraints: {
    adults: number;
    children: number[];
    min_days?: number;
    max_days?: number;
  };
  mode?: "explore" | "direct";
  combinations?: Array<{
    origin: string;
    destination: string;
    exact_date: string;
    return_date?: string;
  }>;
}

export async function trainPlanInit(params: TrainPlanInitParams) {
  const mode = params.mode ?? "explore";
  const isDirect = mode === "direct";

  if (isDirect && (!params.combinations || params.combinations.length === 0)) {
    return {
      status: "error",
      message: "mode='direct' requires at least one combination.",
    };
  }

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

  const searchChecklist: Array<{
    id: number;
    description: string;
    status: "todo" | "doing" | "done" | "failed";
  }> = [];

  if (isDirect && params.combinations) {
    params.combinations.forEach((c, idx) => {
      const ret = c.return_date ? ` ↩ ${c.return_date}` : "";
      searchChecklist.push({
        id: idx + 1,
        description: `${c.origin} → ${c.destination} ${c.exact_date}${ret}`,
        status: "todo",
      });
    });
  }

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

  const dir = resDir(params.session_id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/plan.md`, renderPlanMarkdown(plan), "utf8");

  return {
    status: "success",
    mode,
    next_skill: isDirect ? "travel-train-scrape" : "travel-train-scout",
    session_id: params.session_id,
  };
}

export interface PlanMarkItem {
  task: string;
  status: "todo" | "doing" | "done" | "failed";
  note?: string;
}

export async function trainPlanMark(session_id: string, items: PlanMarkItem[]) {
  const plan = planRead(session_id) as PlanState | null;
  if (!plan) return { status: "error", message: "Plan not found" };

  for (const update of items) {
    const needle = update.task.toLowerCase();
    const main = plan.checklist.find((i) =>
      i.task.toLowerCase().includes(needle),
    );
    if (main) {
      main.status = update.status;
      if (update.note) main.note = update.note;
      continue;
    }
    const search = plan.search_checklist?.find((i) =>
      i.description.toLowerCase().includes(needle),
    );
    if (search) {
      search.status = update.status;
    }
  }

  plan.updated_at = new Date().toISOString();
  planWrite(session_id, plan);
  const dir = resDir(session_id);
  writeFileSync(`${dir}/plan.md`, renderPlanMarkdown(plan), "utf8");

  return { status: "success", next_skill: inferNextTrainSkill(plan) };
}

export async function trainPlanAppendSearches(
  session_id: string,
  combinations: Array<{ description: string }>,
) {
  const plan = planRead(session_id) as PlanState | null;
  if (!plan) return { status: "error", message: "Plan not found" };

  const startId = (plan.search_checklist?.length ?? 0) + 1;
  combinations.forEach((combo, idx) => {
    if (!plan.search_checklist) plan.search_checklist = [];
    plan.search_checklist.push({
      id: startId + idx,
      description: combo.description,
      status: "todo",
    });
  });

  const scItem = plan.checklist.find((i) =>
    i.task.toLowerCase().includes("search checklist"),
  );
  if (scItem) scItem.status = "done";

  plan.updated_at = new Date().toISOString();
  planWrite(session_id, plan);
  const dir = resDir(session_id);
  writeFileSync(`${dir}/plan.md`, renderPlanMarkdown(plan), "utf8");

  return {
    status: "success",
    count: combinations.length,
    next_skill: inferNextTrainSkill(plan),
  };
}

export async function trainPlanStatus(session_id: string) {
  const plan = planRead(session_id) as PlanState | null;
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
}

// ═══════════════════════════════════════════════════════════════════════════════
// REPORT ACTIONS
// ═══════════════════════════════════════════════════════════════════════════════

export async function reportBuild(session_id: string, dbPath: string) {
  const plan = planRead(session_id) as PlanState | null;
  if (!plan) return { status: "error", message: "Plan not found" };

  const db = new TravelDB(dbPath);
  try {
    let markdown: string;

    if (plan.transport === "train") {
      const rows = db.queryTrainOptions({
        session_id,
        limit: 2,
        sort_by: "price",
        sort_dir: "asc",
      });
      const camperRows = db.getRankedCampers(session_id);
      markdown = renderTrainReport(plan, rows, camperRows);
    } else {
      const rows = db.queryFlightOptions({
        session_id,
        limit: 2,
        sort_by: "price",
        sort_dir: "asc",
      });
      markdown = renderFlightReport(plan, rows);
    }

    const dir = resDir(session_id);
    mkdirSync(dir, { recursive: true });
    const reportPath = `${dir}/report.md`;
    writeFileSync(reportPath, markdown, "utf8");

    const optionCount = (markdown.match(/### [🗓️✈️]/g) || []).length;
    const summary =
      optionCount > 0 ? `${optionCount} opciones generadas` : "Sin resultados";

    return { status: "success", report_path: reportPath, summary };
  } catch (error: any) {
    return { status: "error", message: error.message };
  } finally {
    db.close();
  }
}

export async function reportSend(
  session_id: string,
  subject: string,
  emailServiceUrl: string,
) {
  const dir = resDir(session_id);
  const reportPath = `${dir}/report.md`;

  if (!existsSync(reportPath)) {
    return {
      status: "error",
      message: "report.md not found. Run report_build first.",
    };
  }

  const body = readFileSync(reportPath, "utf-8");

  try {
    const response = await fetch(`${emailServiceUrl}/api/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject, body }),
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
}

// ═══════════════════════════════════════════════════════════════════════════════
// RANKED CAMPERS
// ═══════════════════════════════════════════════════════════════════════════════

export interface RankedCamperInput {
  city: string;
  date_from: string;
  date_to: string;
  option_id: number;
  rank: number;
  score: number;
  score_reason?: string;
  station_dist_km?: number;
}

export async function storeRankedCampers(
  session_id: string,
  results: RankedCamperInput[],
  dbPath: string,
) {
  const db = new TravelDB(dbPath);
  try {
    for (const r of results) {
      db.upsertRankedCamper({
        session_id,
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
    return { status: "success", count: results.length };
  } catch (e: any) {
    return { status: "error", message: e.message };
  } finally {
    db.close();
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCOUT ACTIONS
// ═══════════════════════════════════════════════════════════════════════════════

export interface DateScoutRoute {
  origin: string;
  destination: string;
  month: string;
}

export async function dateScout(
  session_id: string,
  routes: DateScoutRoute[],
  dbPath: string,
) {
  const batchResult = await skyscanner.scoutDatesBatch({
    session_id,
    dbPath,
    items: routes.map((r) => ({
      origin: r.origin,
      destination: r.destination,
      month: r.month,
      session_id,
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
}

export interface TrainScoutRoute {
  origin_city: string;
  destination_city: string;
  month: string;
}

export async function trainScout(
  session_id: string,
  routes: TrainScoutRoute[],
  dbPath: string,
) {
  const batchResult = await trenesComScout.scoutDatesBatch({
    session_id,
    dbPath,
    items: routes.map((r) => ({
      origin_city: r.origin_city,
      destination_city: r.destination_city,
      month: r.month,
      session_id,
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
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCRAPER ACTIONS
// ═══════════════════════════════════════════════════════════════════════════════

export interface FlightCombination {
  origin: string;
  destination: string;
  exact_date: string;
  return_date?: string;
}

export async function flightScraper(
  session_id: string,
  pax: number,
  combinations: FlightCombination[],
  dbPath: string,
) {
  const allResults: any[] = [];
  let totalSuccess = 0,
    totalError = 0;

  for (const s of flightStrategies) {
    const batchResult = await s.strategy.scrapeFlightsBatch({
      session_id,
      dbPath,
      items: combinations.map((c) => ({
        origin: c.origin,
        destination: c.destination,
        exact_date: c.exact_date,
        return_date: c.return_date,
        pax,
        session_id,
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
      totalError === 0 ? "success" : totalSuccess > 0 ? "partial" : "error",
    results: allResults,
  };
}

export interface TrainCombination {
  origin: string;
  destination: string;
  exact_date: string;
  return_date?: string;
}

export async function trainScraper(
  session_id: string,
  adults: number,
  children: number[],
  combinations: TrainCombination[],
  dbPath: string,
) {
  const allResults: any[] = [];
  let totalSuccess = 0,
    totalError = 0;

  for (const s of trainStrategies) {
    const batchResult = await s.strategy.scrapeTrainsBatch({
      session_id,
      dbPath,
      items: combinations.map((c) => ({
        origin: c.origin,
        destination: c.destination,
        exact_date: c.exact_date,
        return_date: c.return_date,
        adults,
        children,
        session_id,
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
      totalError === 0 ? "success" : totalSuccess > 0 ? "partial" : "error",
    results: allResults,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// DATE COMBINATION EXTRACTORS
// ═══════════════════════════════════════════════════════════════════════════════

export interface FindBestDateCombinationsParams {
  origin: string;
  destination: string;
  session_id: string;
  months?: string;
  min_days?: number;
  max_days?: number;
  top?: number;
  return_origin?: string;
  return_destination?: string;
}

export async function findBestDateCombinations(
  params: FindBestDateCombinationsParams,
  dbPath: string,
) {
  const db = new TravelDB(dbPath);
  try {
    const months = params.months
      ? params.months.split(",").map((m) => m.trim())
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
}

export interface FindBestTrainDateCombinationsParams {
  session_id: string;
  origin_city: string;
  destination_city: string;
  months?: string;
  min_days?: number;
  max_days?: number;
  top?: number;
  return_origin_city?: string;
  return_destination_city?: string;
}

export async function findBestTrainDateCombinations(
  params: FindBestTrainDateCombinationsParams,
  dbPath: string,
) {
  const db = new TravelDB(dbPath);
  try {
    const months = params.months
      ? params.months.split(",").map((m) => m.trim())
      : [];
    const originStation = await resolveStation(params.origin_city);
    const destinationStation = await resolveStation(params.destination_city);

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
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONSOLIDATION (DB READ-ONLY)
// ═══════════════════════════════════════════════════════════════════════════════

export interface ConsolidateFlightParams {
  session_id: string;
  origin?: string;
  destination?: string;
  limit?: number;
  sort_by?: "price" | "dep_time" | "stops";
  sort_dir?: "asc" | "desc";
}

export async function consolidateFlightReport(
  params: ConsolidateFlightParams,
  dbPath: string,
) {
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
}

export interface ConsolidateTrainParams {
  session_id: string;
  origin?: string;
  destination?: string;
  limit?: number;
  sort_by?: "price" | "dep_time" | "changes";
  sort_dir?: "asc" | "desc";
}

export async function consolidateTrainReport(
  params: ConsolidateTrainParams,
  dbPath: string,
) {
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
}

// ═══════════════════════════════════════════════════════════════════════════════
// CAMPER ACTIONS
// ═══════════════════════════════════════════════════════════════════════════════

export interface CamperScraperParams {
  session_id: string;
  combinations: Array<{ city: string; date_from: string; date_to: string }>;
  types?: number[];
  seatbelts?: number | null;
  beds?: number | null;
  equipment?: string[];
  page_size?: number;
}

export async function camperScraper(
  params: CamperScraperParams,
  dbPath: string,
) {
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
      totalError === 0 ? "success" : totalSuccess > 0 ? "partial" : "error",
    results: allResults,
  };
}

export interface FetchCampersForAnalysisParams {
  session_id: string;
  combinations: Array<{ city: string; date_from: string; date_to: string }>;
  limit_per_type?: number;
}

export async function fetchCampersForAnalysis(
  params: FetchCampersForAnalysisParams,
  dbPath: string,
) {
  const db = new TravelDB(dbPath);
  try {
    logger.info("Fetching campers for analysis", JSON.stringify({ params }));
    const results = db.queryCamperOptionsMulti({
      session_id: params.session_id,
      combinations: params.combinations,
      limit: params.limit_per_type ?? 5,
      group_by_type: true,
      sort_by: "price",
      sort_dir: "asc",
    });
    logger.info("Fetched campers for analysis", JSON.stringify({ results }));
    return { status: "success", data: results };
  } catch (error: any) {
    logger.error("Error fetching campers for analysis", error.message);
    return { status: "error", message: error.message };
  } finally {
    db.close();
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// LEGACY / COMPAT ACTIONS
// ═══════════════════════════════════════════════════════════════════════════════

export async function sendReportEmail(
  file_path: string,
  subject: string,
  emailServiceUrl: string,
) {
  let body: string;
  try {
    body = readFileSync(file_path, "utf-8");
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
      body: JSON.stringify({ subject, body }),
    });
    if (!response.ok) {
      return { status: "error", message: `${response.status}` };
    }
    const result = await response.json();
    return { status: "success", messageId: result.messageId };
  } catch (err: any) {
    return { status: "error", message: err.message };
  }
}

export async function camperStoreAction(
  session_id: string,
  namespace: string,
  data: unknown,
) {
  try {
    camperWrite(session_id, namespace, data);
    return { status: "success", session_id, namespace };
  } catch (e: any) {
    return { status: "error", message: e.message };
  }
}

export async function camperFetchAction(session_id: string, namespace: string) {
  try {
    const data = camperRead(session_id, namespace);
    if (data === null) return { status: "not_found", session_id, namespace };
    return { status: "success", session_id, namespace, data };
  } catch (e: any) {
    return { status: "error", message: e.message };
  }
}
