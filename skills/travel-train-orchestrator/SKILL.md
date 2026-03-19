---
name: travel-train-orchestrator
description: Orchestrates a train travel plan by scouting dates via trenes.com, searching trains via Kayak, and consolidating results. For flights, use travel-flight-orchestrator.
---

## Workflow

### Phase 0 — Session Setup & Checklist

1. Generate `{session_id}` from timestamp (e.g. `20260313_1325`).
2. Create `/home/openclaw/.openclaw/workspace/resources/{session_id}/plan.md`.
3. Classify trip type (one-way / round-trip / open-jaw) — same logic as flights.
4. Write constraints and checklist into `plan.md`.

> ⚠️ Cities must be provided in **Spanish** (e.g. "Madrid", "Sevilla", "Barcelona").
> ⚠️ Always use `YYYY-MM` for months and `YYYY-MM-DD` for exact dates.

**Full `plan.md` example at end of Phase 0:**

```markdown
Trip type: round-trip
Outbound:  Madrid → Sevilla
Return:    Sevilla → Madrid
Months:    2026-07
Min days:  2 | Max days: 5
Adults:    2 | Children: []

Checklist:
[x] Session Init
[ ] Train Scout Outbound Madrid->Sevilla (2026-07)   ← trenes.com
[ ] Train Scout Return   Sevilla->Madrid (2026-07)   ← trenes.com
[ ] Extractor Phase (find_best_train_date_combinations)
[ ] Search Checklist (appended after Phase 2)
[ ] Scraping Trains
[ ] Final Report
```

---

### Phase 1 — Train Date Scouting (parallel) — trenes.com only

Call `train_scout` with city names in Spanish:

**Example:**
```
train_scout(
  session_id: "{session_id}",
  routes: [
    { origin_city: "Madrid",  destination_city: "Sevilla", month: "2026-07" },
    { origin_city: "Sevilla", destination_city: "Madrid",  month: "2026-07" }
  ]
)
```

> ⚠️ For one-way trips, include only the outbound route.

Process results and mark checkboxes in `plan.md`.

**🛑 Do not advance to Phase 2 until all Train Scout checkboxes are `[x]` or `[!] FAILED`.**

---

### Phase 2 — Selecting Best Windows

Call `find_best_train_date_combinations`:

**Example:**
```
find_best_train_date_combinations(
  session_id:       "{session_id}",
  origin_city:      "Madrid",
  destination_city: "Sevilla",
  months:           "2026-07",
  min_days:         2,
  max_days:         5,
  top:              3
)
```

Append Search Checklist to `plan.md` (same format as flight orchestrator).

**🛑 Do not advance to Phase 3 until Search Checklist is written.**

---

### Phase 3 — Train Scraping (Kayak Trains)

Call `train_scraper` with the combinations from Phase 2:

**Round-trip example:**
```
train_scraper(
  session_id: "{session_id}",
  adults:     2,
  children:   [],
  combinations: [
    { origin: "mad", destination: "svq", exact_date: "2026-07-19", return_date: "2026-07-22" },
    { origin: "mad", destination: "svq", exact_date: "2026-07-03", return_date: "2026-07-06" }
  ]
)
```

> ⚠️ `train_scraper` uses IATA codes, not city names.
> Use the standard IATA-to-station mapping for Kayak.

**CAPTCHA handling:** mark `[!] FAILED: CAPTCHA` and report. Do not retry.

**🛑 Do not advance to Phase 4 until all Scraping checkboxes are `[x]` or `[!] FAILED`.**

---

### Phase 4 — Consolidation and Final Report

#### 4a — Consolidate Trains

```
consolidate_final_train_report(
  origin:      "mad",
  destination: "svq",
  session_id:  "{session_id}",
  limit:       2,
  sort_by:     "price"
)
```

#### 4b — Write Report

Write the full report to `report.md`. Format:

```markdown
### 🚄 Travel Option [N]: [OUT_DATE] → [RET_DATE] ([DAYS] days)

**[Origin City] ➔ [Destination City] ➔ [Origin City]**

#### 🔵 Kayak — Trains (best 2)
| # | Outbound | Return | Total ([PAX] pax) | Operator | Changes |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | DEP–ARR | DEP–ARR | €PRICE | OPERATOR | 0 |
| 2 | DEP–ARR | DEP–ARR | €PRICE | OPERATOR | 0 |

🔗 [View trains on Kayak](SEARCH_URL)
```

Mark `[x] Final Report` in `plan.md`.
Reply to the user in the chat channel using this format:

```markdown
> ✅ Train report ready: `/home/openclaw/.openclaw/workspace/resources/{session_id}/report.md`
>
> **Best option:**
> - 🚄 Kayak trains: [Option N] [dates] — €[price] ([search_url])
```
