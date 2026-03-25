import { PlanState } from "./plan-markdown";
import { TrainQueryResultRow, QueryResultRow } from "../utils/db";

export function inferNextPhase(plan: PlanState): string {
  const allMainDone = plan.checklist.every((item) => item.status === "done" || item.status === "failed");
  if (!allMainDone) return "Phase 3: Scraping & Search"; // Fallback simple

  const searchesDone = plan.search_checklist?.every((item) => item.status === "done" || item.status === "failed");
  if (searchesDone) return "Phase 4: Final Report";
  
  return "Phase 3: Scraping";
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
