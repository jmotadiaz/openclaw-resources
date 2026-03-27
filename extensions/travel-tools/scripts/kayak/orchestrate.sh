#!/usr/bin/env bash
# extensions/travel-tools/scripts/orchestrate.sh
# ═══════════════════════════════════════════════════════════════════════════════
# Bash orchestrator — zero memory footprint.
#
# 1. Runs init-state.ts to generate/merge combinations into state.json
# 2. Loops calling run-batch.ts (each call = fresh Node process that dies)
# 3. Stops when run-batch.ts exits with code 2 (nothing left)
# 4. Exports results to JSON
#
# Usage:
#   chmod +x scripts/orchestrate.sh
#   ./scripts/orchestrate.sh [config.json] [state.json]
#
# Reanudable: si se mata el proceso, re-ejecutar retoma desde state.json.
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG="${1:-$SCRIPT_DIR/config.json}"
STATE="${2:-$SCRIPT_DIR/state.json}"

# ─── Read batch_size and pause from config ───────────────────────────────────

if ! command -v jq &>/dev/null; then
  echo "ERROR: jq is required. Install with: apt install jq" >&2
  exit 1
fi

BATCH_SIZE=$(jq -r '.batch_size // 5' "$CONFIG")
PAUSE=$(jq -r '.pause_between_batches_s // 10' "$CONFIG")

echo "═══════════════════════════════════════════════════════════════"
echo " Train scraping orchestrator"
echo " Config:     $CONFIG"
echo " State:      $STATE"
echo " Batch size: $BATCH_SIZE"
echo " Pause:      ${PAUSE}s between batches"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# ─── Phase 1: Init state ────────────────────────────────────────────────────

echo "▸ Initializing state..."
npx ts-node "$SCRIPT_DIR/init-state.ts" --config "$CONFIG" --state "$STATE"
echo ""

# ─── Phase 2: Execute batches ───────────────────────────────────────────────

BATCH_NUM=0
START_TIME=$(date +%s)

while true; do
  BATCH_NUM=$((BATCH_NUM + 1))
  ELAPSED=$(( $(date +%s) - START_TIME ))
  ELAPSED_MIN=$(( ELAPSED / 60 ))

  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo " Batch #$BATCH_NUM  (elapsed: ${ELAPSED_MIN}m)"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  # run-batch.ts exits:
  #   0 = batch processed
  #   1 = fatal error
  #   2 = nothing to do
  set +e
  npx ts-node "$SCRIPT_DIR/run-batch.ts" --state "$STATE" --batch-size "$BATCH_SIZE"
  EXIT_CODE=$?
  set -e

  if [ $EXIT_CODE -eq 2 ]; then
    echo ""
    echo "▸ All combinations processed."
    break
  fi

  if [ $EXIT_CODE -eq 1 ]; then
    echo ""
    echo "▸ Fatal error in run-batch. Check state.json for details."
    echo "▸ Re-run this script to retry remaining combinations."
    exit 1
  fi

  # Pause between batches to avoid rate limiting
  echo ""
  echo "▸ Pausing ${PAUSE}s before next batch..."
  sleep "$PAUSE"
done

# ─── Phase 3: Summary ───────────────────────────────────────────────────────

TOTAL_TIME=$(( $(date +%s) - START_TIME ))
TOTAL_MIN=$(( TOTAL_TIME / 60 ))

TOTAL=$(jq '.combinations | length' "$STATE")
DONE=$(jq '[.combinations[] | select(.status == "done")] | length' "$STATE")
FAILED=$(jq '[.combinations[] | select(.status == "failed")] | length' "$STATE")

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo " COMPLETE"
echo " Total:    $TOTAL combinations"
echo " Done:     $DONE"
echo " Failed:   $FAILED"
echo " Batches:  $BATCH_NUM"
echo " Time:     ${TOTAL_MIN} minutes"
echo "═══════════════════════════════════════════════════════════════"

# ─── Phase 4: Export results ─────────────────────────────────────────────────

if [ "$DONE" -gt 0 ]; then
  SESSION_ID=$(jq -r '.config.session_id' "$STATE")
  EXPORT_PATH="${SESSION_ID}-export.json"
  echo ""
  echo "▸ Exporting results..."
  npx ts-node "$SCRIPT_DIR/export-session.ts" \
    --session "$SESSION_ID" \
    --db "$(jq -r '.config.db' "$STATE")" \
    --type train \
    --out "$EXPORT_PATH"
fi

if [ "$FAILED" -gt 0 ]; then
  echo ""
  echo "▸ Failed combinations:"
  jq -r '.combinations[] | select(.status == "failed") | "  ✗ \(.id): \(.last_error)"' "$STATE"
fi
