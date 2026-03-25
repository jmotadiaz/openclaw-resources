import { PlanState } from "./plan-markdown";
import { TrainQueryResultRow } from "../utils/db";

export function renderTrainReport(
  plan: PlanState,
  rows: TrainQueryResultRow[],
  camperMarkdown: Record<string, string>,
): string {
  if (rows.length === 0) {
    return "# Trip Report\n\n> ⚠️ No train options found in database.\n";
  }

  // Agrupar por (out_date, ret_date) = una "opción de viaje"
  const windows = new Map<string, TrainQueryResultRow[]>();
  for (const row of rows) {
    const key = `${row.out_date}:${row.ret_date ?? ""}`;
    if (!windows.has(key)) windows.set(key, []);
    windows.get(key)!.push(row);
  }

  const adults = plan.constraints.adults;
  const lines: string[] = [];
  let optNum = 0;

  for (const [key, options] of windows) {
    optNum++;
    const first = options[0];
    const days = first.ret_date
      ? Math.ceil(
          (new Date(first.ret_date).getTime() -
            new Date(first.out_date).getTime()) /
            86_400_000,
        )
      : null;

    // ── Header ──
    if (first.ret_date) {
      lines.push(
        `### 🗓️ Opción ${optNum}: ${first.out_date} → ${first.ret_date} (${days} días)`,
      );
      lines.push("");
      lines.push(
        `**${first.origin.toUpperCase()} ➔ ${first.destination.toUpperCase()} ➔ ${first.origin.toUpperCase()}**`,
      );
    } else {
      lines.push(`### 🗓️ Opción ${optNum}: ${first.out_date} (One-Way)`);
      lines.push("");
      lines.push(
        `**${first.origin.toUpperCase()} ➔ ${first.destination.toUpperCase()}**`,
      );
    }
    lines.push("");

    // ── Train table ──
    lines.push(`#### 🚄 Kayak — Trenes (mejores ${options.length})`);
    lines.push("");

    if (first.ret_date) {
      // Round-trip table
      lines.push(
        `| # | Ida | Vuelta | Total (${adults} adultos) | Operador | Cambios |`,
      );
      lines.push(`| :--- | :--- | :--- | :--- | :--- | :--- |`);
      options.forEach((t, i) => {
        const ida = `${t.out_dep_time}–${t.out_arr_time}`;
        const vuelta = t.ret_dep_time
          ? `${t.ret_dep_time}–${t.ret_arr_time}`
          : "—";
        lines.push(
          `| ${i + 1} | ${ida} | ${vuelta} | €${t.total_price} | ${t.operator} | ${t.out_changes} |`,
        );
      });
    } else {
      // One-way table
      lines.push(
        `| # | Hora | Total (${adults} adultos) | Operador | Cambios |`,
      );
      lines.push(`| :--- | :--- | :--- | :--- | :--- |`);
      options.forEach((t, i) => {
        lines.push(
          `| ${i + 1} | ${t.out_dep_time}–${t.out_arr_time} | €${t.total_price} | ${t.operator} | ${t.out_changes} |`,
        );
      });
    }

    // Search URL
    if (first.search_url) {
      lines.push("");
      lines.push(`🔗 [Ver trenes en Kayak](${first.search_url})`);
    }
    lines.push("");

    // ── Camper section ──
    const camperKey = `${first.out_date}:${first.ret_date ?? first.out_date}`;
    if (camperMarkdown[camperKey]) {
      lines.push(camperMarkdown[camperKey]);
      lines.push("");
    }

    lines.push("---");
    lines.push("");
  }

  return lines.join("\n");
}
