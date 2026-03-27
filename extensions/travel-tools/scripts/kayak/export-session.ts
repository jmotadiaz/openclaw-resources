#!/usr/bin/env node
// extensions/travel-tools/scripts/export-session.ts
// ═══════════════════════════════════════════════════════════════════════════════
// Export-only — no scraping, just reads DB and writes JSON.
//
// Usage:
//   npx ts-node scripts/export-session.ts \
//     --session batch-mad-svq-2026-07-15d \
//     --db ./travel.sqlite \
//     --type train           # or "flight" or "all"
// ═══════════════════════════════════════════════════════════════════════════════

import { resolve } from "path";
import { writeFileSync } from "fs";
import { parseArgs } from "util";
import { TravelDB } from "../../src/utils/db";

const { values: args } = parseArgs({
  options: {
    session: { type: "string", short: "s" },
    db: { type: "string", default: resolve(__dirname, "../travel.sqlite") },
    type: { type: "string", default: "all" }, // train | flight | all
    out: { type: "string" },
    limit: { type: "string", default: "9999" },
  },
});

if (!args.session) {
  console.error("Required: --session <session_id>");
  process.exit(1);
}

const SESSION = args.session!;
const DB_PATH = resolve(args.db!);
const TYPE = args.type!;
const LIMIT = parseInt(args.limit!, 10);

function main() {
  const db = new TravelDB(DB_PATH);
  const output: Record<string, unknown> = {
    meta: {
      session_id: SESSION,
      exported_at: new Date().toISOString(),
      type: TYPE,
    },
  };

  try {
    if (TYPE === "train" || TYPE === "all") {
      const trains = db.queryTrainOptions({
        session_id: SESSION,
        limit: LIMIT,
        sort_by: "price",
        sort_dir: "asc",
      });
      output.trains = trains.map((r) => ({
        out_date: r.out_date,
        ret_date: r.ret_date,
        search_url: r.search_url,
        operator: r.operator,
        total_price: r.total_price,
        out_dep_time: r.out_dep_time,
        out_arr_time: r.out_arr_time,
        ret_dep_time: r.ret_dep_time,
        ret_arr_time: r.ret_arr_time,
      }));
      (output.meta as any).train_count = trains.length;
    }

    if (TYPE === "flight" || TYPE === "all") {
      const flights = db.queryFlightOptions({
        session_id: SESSION,
        limit: LIMIT,
        sort_by: "price",
        sort_dir: "asc",
      });
      output.flights = flights.map((r) => ({
        out_date: r.out_date,
        ret_date: r.ret_date,
        search_url: r.search_url,
        airline: r.airline,
        total_price: r.total_price,
        out_dep_time: r.out_dep_time,
        out_arr_time: r.out_arr_time,
        ret_dep_time: r.ret_dep_time,
        ret_arr_time: r.ret_arr_time,
      }));
      (output.meta as any).flight_count = flights.length;
    }

    const outPath = args.out || `${SESSION}-export.json`;
    writeFileSync(outPath, JSON.stringify(output, null, 2), "utf8");
    console.log(`✓ Exported to ${outPath}`);
    console.log(`  ${JSON.stringify(output.meta)}`);
  } finally {
    db.close();
  }
}

main();
