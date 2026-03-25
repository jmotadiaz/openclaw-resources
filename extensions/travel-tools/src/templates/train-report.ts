import { PlanState } from "./plan-markdown";
import { TrainQueryResultRow, RankedCamperRow } from "../utils/db";

export function renderTrainReport(
  plan: PlanState,
  rows: TrainQueryResultRow[],
  camperRows: RankedCamperRow[],
): string {
  if (rows.length === 0)
    return "> ⚠️ No se encontraron opciones de tren en la base de datos.\n";

  const windows = new Map<string, TrainQueryResultRow[]>();
  for (const row of rows) {
    const key = `${row.out_date}:${row.ret_date ?? ""}`;
    if (!windows.has(key)) windows.set(key, []);
    windows.get(key)!.push(row);
  }

  // Group campers by date window
  const campersByWindow = new Map<string, RankedCamperRow[]>();
  for (const c of camperRows) {
    const key = `${c.date_from}:${c.date_to}`;
    if (!campersByWindow.has(key)) campersByWindow.set(key, []);
    campersByWindow.get(key)!.push(c);
  }

  const adults = plan.constraints.adults;
  const lines: string[] = [];
  let optNum = 0;

  for (const [_key, options] of windows) {
    optNum++;
    const first = options[0];
    const days = first.ret_date
      ? Math.ceil(
          (new Date(first.ret_date).getTime() -
            new Date(first.out_date).getTime()) /
            86_400_000,
        )
      : null;

    // Header
    if (first.ret_date) {
      lines.push(
        `### 🗓️ Opción ${optNum}: ${first.out_date} → ${first.ret_date} (${days} días)`,
      );
      lines.push("");
      lines.push(
        `**${first.origin.toUpperCase()} ➔ ${first.destination.toUpperCase()} ➔ ${first.origin.toUpperCase()}**`,
      );
    } else {
      lines.push(`### 🗓️ Opción ${optNum}: ${first.out_date} (Solo ida)`);
      lines.push("");
      lines.push(
        `**${first.origin.toUpperCase()} ➔ ${first.destination.toUpperCase()}**`,
      );
    }
    lines.push("");

    // Train table
    lines.push(`#### 🚄 Kayak — Trenes (mejores ${options.length})`);
    lines.push("");

    options.forEach((t, i) => {
      const ida = `${t.out_dep_time}–${t.out_arr_time}`;
      if (first.ret_date) {
        const vuelta = t.ret_dep_time
          ? `${t.ret_dep_time}–${t.ret_arr_time}`
          : "—";
        lines.push(`${i + 1}. **Ida:** ${ida} ↔ **Vuelta:** ${vuelta}`);
      } else {
        lines.push(`${i + 1}. **Hora:** ${ida}`);
      }
      lines.push(`   - **Precio:** €${t.total_price} (${adults} adultos)`);
      lines.push(
        `   - **Operador:** ${t.operator} | **Cambios:** ${t.out_changes}`,
      );
    });

    if (first.search_url) {
      lines.push("");
      lines.push(`🔗 [Ver trenes en Kayak](${first.search_url})`);
    }
    lines.push("");

    // Camper section — match by out_date:ret_date
    const camperKey = `${first.out_date}:${first.ret_date ?? first.out_date}`;
    const campers = campersByWindow.get(camperKey);
    if (campers && campers.length > 0) {
      const city = campers[0].city;
      lines.push(
        `#### 🚐 Campers en ${city} (${first.out_date} → ${first.ret_date ?? first.out_date})`,
      );
      lines.push("");
      campers.forEach((c, i) => {
        const name = `[${c.title}](${c.ad_url})`;
        lines.push(
          `${i + 1}. **${name}** — ${c.vehicle_type} (${c.beds} camas)`,
        );
        lines.push(
          `   - **Precio:** €${c.price_per_day}/día (Total: €${c.total_price})`,
        );
        if (c.score_reason) {
          lines.push(`   - **Nota:** ${c.score_reason}`);
        }
      });
      lines.push("");
    }

    lines.push("---");
    lines.push("");
  }

  return lines.join("\n");
}
