#!/usr/bin/env node
// extensions/travel-tools/scripts/run-batch.ts
// ═══════════════════════════════════════════════════════════════════════════════
// Ephemeral worker — picks up to N pending/retry combinations from state.json,
// runs trainScraper, updates state.json, then EXITS.
//
// Called by orchestrate.sh in a loop. Each invocation is a fresh Node process
// so memory is fully released between batches.
//
// Usage:
//   npx ts-node scripts/run-batch.ts [--state state.json] [--batch-size 5]
//
// Exit codes:
//   0 = batch processed (some may have failed individually)
//   1 = fatal error (state unreadable, etc.)
//   2 = nothing to do (all done or failed)
// ═══════════════════════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { parseArgs } from "util";
import { trainScraper } from "../../src/actions";

const { values: args } = parseArgs({
  options: {
    state: { type: "string", default: resolve(__dirname, "state.json") },
    "batch-size": { type: "string", default: "5" },
  },
});

const STATE_PATH = resolve(args.state!);
const BATCH_SIZE = parseInt(args["batch-size"]!, 10);

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
  config: {
    adults: number;
    children: number[];
    db: string;
    max_retries: number;
    [k: string]: any;
  };
  combinations: Combination[];
  [k: string]: any;
}

// ─── Read state ─────────────────────────────────────────────────────────────

let state: State;
try {
  state = JSON.parse(readFileSync(STATE_PATH, "utf8"));
} catch (e: any) {
  console.error(`Cannot read state: ${e.message}`);
  process.exit(1);
}

const dbPath = resolve(state.config.db);
const maxRetries = state.config.max_retries ?? 3;

// ─── Pick batch ─────────────────────────────────────────────────────────────

// Priority: retry first (they've waited), then pending
const actionable = state.combinations.filter(
  (c) => c.status === "retry" || c.status === "pending",
);

if (actionable.length === 0) {
  const done = state.combinations.filter((c) => c.status === "done").length;
  const failed = state.combinations.filter((c) => c.status === "failed").length;
  console.log(`Nothing to do. done=${done} failed=${failed}`);
  process.exit(2);
}

// Sort: retries first, then pending (FIFO within each group)
actionable.sort((a, b) => {
  if (a.status === "retry" && b.status !== "retry") return -1;
  if (a.status !== "retry" && b.status === "retry") return 1;
  return 0;
});

const batch = actionable.slice(0, BATCH_SIZE);

console.log(`\n═══ Batch: ${batch.length} combinations ═══`);
batch.forEach((c) =>
  console.log(`  ${c.id} [${c.status}, attempt ${c.attempts}]`),
);

// ─── Mark as running & flush ────────────────────────────────────────────────

for (const c of batch) {
  c.status = "running";
}
state.updated_at = new Date().toISOString();
writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), "utf8");

// ─── Session ID from config ─────────────────────────────────────────────────

const sessionId = state.config.session_id as string;
if (!sessionId) {
  console.error("config.session_id is required in state.json");
  process.exit(1);
}

// ─── Run scraper ────────────────────────────────────────────────────────────

async function run() {
  const combinations = batch.map((c) => ({
    origin: c.origin,
    destination: c.destination,
    exact_date: c.exact_date,
    return_date: c.return_date,
  }));

  let result: any;
  try {
    result = await trainScraper(
      sessionId,
      state.config.adults,
      state.config.children ?? [],
      combinations,
      dbPath,
    );
  } catch (e: any) {
    // Whole batch crashed — mark all as retry/failed
    console.error(`Batch-level crash: ${e.message}`);
    for (const c of batch) {
      c.attempts++;
      if (c.attempts >= maxRetries) {
        c.status = "failed";
        c.last_error = `batch crash: ${e.message}`;
      } else {
        c.status = "retry";
        c.last_error = `batch crash: ${e.message}`;
      }
    }
    flushState();
    return;
  }

  // ─── Map results back to combinations ───────────────────────────────────

  const resultsByLabel = new Map<string, any>();
  for (const r of result.results ?? []) {
    if (r.label) resultsByLabel.set(r.label, r);
  }

  for (const c of batch) {
    // trainScraper labels: "origin->destination:exact_date"
    const label = `${c.origin}->${c.destination}:${c.exact_date}`;
    const r = resultsByLabel.get(label);

    c.attempts++;

    if (r && r.status === "success") {
      c.status = "done";
      c.last_error = null;
      console.log(`  ✓ ${c.id}`);
    } else {
      const reason = r?.reason ?? "no result returned";
      if (c.attempts >= maxRetries) {
        c.status = "failed";
        c.last_error = reason;
        console.log(`  ✗ ${c.id} FAILED (${c.attempts} attempts): ${reason}`);
      } else {
        c.status = "retry";
        c.last_error = reason;
        console.log(
          `  ↻ ${c.id} retry (attempt ${c.attempts}/${maxRetries}): ${reason}`,
        );
      }
    }
  }

  flushState();
}

function flushState() {
  state.updated_at = new Date().toISOString();
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), "utf8");

  // Print summary
  const counts = {
    pending: state.combinations.filter((c) => c.status === "pending").length,
    retry: state.combinations.filter((c) => c.status === "retry").length,
    done: state.combinations.filter((c) => c.status === "done").length,
    failed: state.combinations.filter((c) => c.status === "failed").length,
  };
  const remaining = counts.pending + counts.retry;
  console.log(
    `\n  State: ${counts.done} done, ${counts.failed} failed, ${remaining} remaining`,
  );
}

run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(`Fatal: ${e.message}`);
    process.exit(1);
  });
