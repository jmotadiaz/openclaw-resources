import { PlanState } from "./plan-markdown";
import { TrainQueryResultRow, QueryResultRow } from "../utils/db";

export function inferNextPhase(plan: PlanState): string {
  const allMainDone = plan.checklist.every((item) => item.status === "done" || item.status === "failed");
  if (!allMainDone) return "Phase 3: Scraping & Search"; // Fallback simple

  const searchesDone = plan.search_checklist?.every((item) => item.status === "done" || item.status === "failed");
  if (searchesDone) return "Phase 4: Final Report";
  
  return "Phase 3: Scraping";
}

export function inferNextTrainSkill(plan: PlanState): string | null {
  const find = (sub: string) =>
    plan.checklist.find((i) =>
      i.task.toLowerCase().includes(sub.toLowerCase()),
    );

  const scouting = find("scouting");
  if (scouting && scouting.status !== "done" && scouting.status !== "failed")
    return "travel-train-scout";

  const extractor = find("extractor");
  if (extractor && extractor.status !== "done" && extractor.status !== "failed")
    return "travel-train-extract";

  // Check if search_checklist exists and has pending items
  const searchCL = find("search checklist");
  if (searchCL && searchCL.status !== "done" && searchCL.status !== "failed")
    return "travel-train-extract";

  const scraping = find("scraping");
  if (scraping && scraping.status !== "done" && scraping.status !== "failed") {
    // If search_checklist has pending items, still in scraping
    if (
      plan.search_checklist &&
      plan.search_checklist.some((i) => i.status === "todo")
    )
      return "travel-train-scrape";
    return "travel-train-scrape";
  }

  const report = find("final report");
  if (report && report.status !== "done" && report.status !== "failed")
    return "travel-train-report";

  return null; // workflow complete
}

export function groupTrainByDateWindow(rows: TrainQueryResultRow[]): Record<string, TrainQueryResultRow[]> {
  const groups: Record<string, TrainQueryResultRow[]> = {};
  for (const row of rows) {
    const key = `${row.out_date}${row.ret_date ? " → " + row.ret_date : ""}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(row);
  }
  return groups;
}

export function groupByDateWindow(rows: QueryResultRow[]): Record<string, QueryResultRow[]> {
  const groups: Record<string, QueryResultRow[]> = {};
  for (const row of rows) {
    const key = `${row.out_date}${row.ret_date ? " → " + row.ret_date : ""}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(row);
  }
  return groups;
}

export function buildReportSummary(markdown: string): string {
  // Extract lines like "- **Option 1:** ..." from markdown
  const lines = markdown.split("\n");
  const options = lines.filter((l) => l.trim().startsWith("### 🗓️ Opción"));
  return options.join("\n");
}
