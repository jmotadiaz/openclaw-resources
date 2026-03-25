export interface ChecklistItem {
  task: string;
  status: "todo" | "doing" | "done" | "failed";
  note?: string;
}

export interface SearchChecklistItem {
  id: number;
  description: string;
  status: "todo" | "doing" | "done" | "failed";
}

export interface PlanState {
  session_id: string;
  transport: "flight" | "train";
  trip_type: "one-way" | "round-trip" | "open-jaw";
  routes: Array<{ origin: string; destination: string }>;
  months: string[];
  constraints: {
    min_days?: number;
    max_days?: number;
    adults: number;
    children: number[];
  };
  checklist: ChecklistItem[];
  search_checklist?: SearchChecklistItem[];
  created_at: string;
  updated_at: string;
}

export function renderPlanMarkdown(plan: PlanState): string {
  const lines: string[] = [];
  lines.push(`# Travel Plan: ${plan.session_id}`);
  lines.push("");
  lines.push(`- **Transport:** ${plan.transport}`);
  lines.push(`- **Trip type:** ${plan.trip_type}`);
  lines.push(`- **Routes:** ${plan.routes.map(r => `${r.origin} → ${r.destination}`).join(", ")}`);
  lines.push(`- **Months:** ${plan.months.join(", ")}`);
  lines.push(`- **Travellers:** ${plan.constraints.adults} adults${plan.constraints.children.length ? `, children: [${plan.constraints.children.join(", ")}]` : ""}`);
  if (plan.constraints.min_days) lines.push(`- **Duration:** ${plan.constraints.min_days}-${plan.constraints.max_days} days`);
  lines.push("");
  lines.push("## Checklist");
  for (const item of plan.checklist) {
    const block = item.status === "done" ? "[x]" : item.status === "failed" ? "[!]" : item.status === "doing" ? "[/]" : "[ ]";
    lines.push(`${block} ${item.task}${item.note ? `   ← ${item.note}` : ""}`);
  }

  if (plan.search_checklist && plan.search_checklist.length > 0) {
    lines.push("");
    lines.push("## Search Checklist");
    for (const item of plan.search_checklist) {
      const block = item.status === "done" ? "[x]" : item.status === "failed" ? "[!]" : item.status === "doing" ? "[/]" : "[ ]";
      lines.push(`${block} Search ${item.id}: ${item.description}`);
    }
  }

  lines.push("");
  lines.push(`_Last updated: ${plan.updated_at}_`);
  return lines.join("\n");
}
