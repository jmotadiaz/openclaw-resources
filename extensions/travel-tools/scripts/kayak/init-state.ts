#!/usr/bin/env node
// extensions/travel-tools/scripts/init-state.ts
// ═══════════════════════════════════════════════════════════════════════════════
// Reads config.json, computes the cartesian product of
// (routes × months × trip_days × start_days), writes state.json.
//
// Usage:
//   npx ts-node scripts/init-state.ts [--config config.json] [--state state.json]
//
// Safe to re-run: only adds NEW combinations (preserves existing status).
// ═══════════════════════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";
import { parseArgs } from "util";

const { values: args } = parseArgs({
  options: {
    config: { type: "string", default: resolve(__dirname, "config.json") },
    state:  { type: "string", default: resolve(__dirname, "state.json") },
  },
});

interface Config {
  routes: Array<{ origin: string; destination: string }>;
  months: string[];
  trip_days: number[];
  adults: number;
  children: number[];
  db: string;
  batch_size: number;
  max_retries: number;
  pause_between_batches_s: number;
}

interface Combination {
  id: string;
  origin: string;
  destination: string;
  exact_date: string;
  return_date: string;
  trip_days: number;
  status: "pending" | "running" | "done" | "retry" | "failed";
  attempts: number;
  last_error: string | null;
}

interface State {
  config: Config;
  created_at: string;
  updated_at: string;
  combinations: Combination[];
}

// ─── Read config ────────────────────────────────────────────────────────────

const configPath = resolve(args.config!);
const statePath = resolve(args.state!);

if (!existsSync(configPath)) {
  console.error(`Config not found: ${configPath}`);
  process.exit(1);
}

const config: Config = JSON.parse(readFileSync(configPath, "utf8"));

// ─── Generate combinations ──────────────────────────────────────────────────

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const newCombinations: Combination[] = [];

for (const route of config.routes) {
  for (const month of config.months) {
    const [year, mon] = month.split("-").map(Number);
    const dim = daysInMonth(year, mon);

    for (const days of config.trip_days) {
      for (let startDay = 1; startDay <= dim; startDay++) {
        const outDate = new Date(year, mon - 1, startDay);
        const retDate = new Date(year, mon - 1, startDay + days);

        const outStr = fmtDate(outDate);
        const retStr = fmtDate(retDate);

        const id = `${route.origin}-${route.destination}-${outStr}-${days}d`;

        newCombinations.push({
          id,
          origin: route.origin,
          destination: route.destination,
          exact_date: outStr,
          return_date: retStr,
          trip_days: days,
          status: "pending",
          attempts: 0,
          last_error: null,
        });
      }
    }
  }
}

// ─── Merge with existing state (idempotent) ─────────────────────────────────

let state: State;

if (existsSync(statePath)) {
  state = JSON.parse(readFileSync(statePath, "utf8"));
  const existingIds = new Set(state.combinations.map((c) => c.id));
  let added = 0;

  for (const combo of newCombinations) {
    if (!existingIds.has(combo.id)) {
      state.combinations.push(combo);
      added++;
    }
  }

  state.updated_at = new Date().toISOString();
  console.log(
    `State exists: ${existingIds.size} existing, ${added} new added.`,
  );
} else {
  state = {
    config,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    combinations: newCombinations,
  };
  console.log(`State created: ${newCombinations.length} combinations.`);
}

// ─── Summary ────────────────────────────────────────────────────────────────

const byStatus = {
  pending: state.combinations.filter((c) => c.status === "pending").length,
  retry:   state.combinations.filter((c) => c.status === "retry").length,
  running: state.combinations.filter((c) => c.status === "running").length,
  done:    state.combinations.filter((c) => c.status === "done").length,
  failed:  state.combinations.filter((c) => c.status === "failed").length,
};

console.log(`\nTotal: ${state.combinations.length}`);
console.log(`  pending: ${byStatus.pending}`);
console.log(`  retry:   ${byStatus.retry}`);
console.log(`  done:    ${byStatus.done}`);
console.log(`  failed:  ${byStatus.failed}`);

// ─── Write ──────────────────────────────────────────────────────────────────

writeFileSync(statePath, JSON.stringify(state, null, 2), "utf8");
console.log(`\nWritten: ${statePath}`);
