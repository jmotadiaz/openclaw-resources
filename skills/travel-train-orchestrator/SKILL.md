---
name: travel-train-orchestrator
description: Orchestrates a train travel plan by scouting dates via trenes.com, searching trains via Kayak, and consolidating results. For flights, use travel-flight-orchestrator.
---

## Workflow

### Phase 0 — Session Setup & Checklist

1. Generate `{session_id}` from timestamp (e.g. `20260313_1325`).
2. Create `/home/openclaw/.openclaw/workspace/resources/{session_id}/plan.md` using the `write` tool.
3. Classify the trip type:

| User says… | Type | Return scouts needed |
|---|---|---|
| One destination, no return | `one-way` | None |
| Same origin/destination for return | `round-trip` | `destination→origin` |
| Return from a different city | `open-jaw` | `return_origin→outbound_origin` |

4. Write the user's exact constraints and the initial checklist state into `plan.md`.

> ⚠️ Cities must be provided in **Spanish** (e.g. "Madrid", "Sevilla", "Barcelona").
> ⚠️ Always use `YYYY-MM` for months and `YYYY-MM-DD` for exact dates.

**Full `plan.md` example at the end of Phase 0:**

```
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

> ⚠️ For **one-way** trips, omit the return scout and return scraping lines.

---

### Phase 1 — Train Date Scouting (parallel) — trenes.com only

Call `train_scout` with city names in Spanish:

**Example:**
```
train_scout(
  session_id: "{session_id}",
  routes: [
    { origin_city: "Madrid",  destination_city: "Sevilla", month: "2026-07" },
    { origin_city: "Sevilla", destination_city: "Madrid",  month: "2026-07" }   ← omit for one-way
  ]
)
```

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

> For **one-way** trips, omit `return_origin_city` and `return_destination_city`.

The tool returns a list of date combinations sorted by estimated price.
Append the **Search Checklist** to `plan.md` using the format that matches the trip type:

**Round-trip example** (one entry per combo):
```
Search Checklist:
[ ] Search 1: Madrid ➔ Sevilla (Out: 2026-07-19) + Sevilla ➔ Madrid (Ret: 2026-07-22)
[ ] Search 2: Madrid ➔ Sevilla (Out: 2026-07-03) + Sevilla ➔ Madrid (Ret: 2026-07-06)
[ ] Search 3: Madrid ➔ Sevilla (Out: 2026-07-05) + Sevilla ➔ Madrid (Ret: 2026-07-08)
```

**Open-jaw example** (two entries per combo, labelled a/b):
```
Search Checklist:
[ ] Search 1a: Madrid ➔ Sevilla (Out: 2026-07-19)
[ ] Search 1b: Sevilla ➔ Barcelona (Out: 2026-07-22)
[ ] Search 2a: Madrid ➔ Sevilla (Out: 2026-07-03)
[ ] Search 2b: Sevilla ➔ Barcelona (Out: 2026-07-06)
```

**One-way example** (one entry per combo, no return):
```
Search Checklist:
[ ] Search 1: Madrid ➔ Sevilla (Out: 2026-07-19)
[ ] Search 2: Madrid ➔ Sevilla (Out: 2026-07-03)
[ ] Search 3: Madrid ➔ Sevilla (Out: 2026-07-05)
```

**🛑 Do not advance to Phase 3 until the Search Checklist is written in `plan.md`.**

---

### Phase 3 — Train Scraping (Kayak Trains)

> ⚠️ `train_scraper` uses IATA codes, not city names.
> Convert city names to IATA before calling: Madrid → `mad`, Sevilla → `svq`, Barcelona → `bcn`, etc.

Call `train_scraper` with the combinations from Phase 2. Mark each Search Checklist item as
`[x]` on success or `[!] FAILED: CAPTCHA` on failure.

**Round-trip example:**
```
train_scraper(
  session_id: "{session_id}",
  adults:     2,
  children:   [],
  combinations: [
    { origin: "mad", destination: "svq", exact_date: "2026-07-19", return_date: "2026-07-22" },
    { origin: "mad", destination: "svq", exact_date: "2026-07-03", return_date: "2026-07-06" },
    { origin: "mad", destination: "svq", exact_date: "2026-07-05", return_date: "2026-07-08" }
  ]
)
```

**Open-jaw example** (one leg per entry, no `return_date`):
```
train_scraper(
  session_id: "{session_id}",
  adults:     2,
  children:   [],
  combinations: [
    { origin: "mad", destination: "svq", exact_date: "2026-07-19" },
    { origin: "svq", destination: "bcn", exact_date: "2026-07-22" },
    { origin: "mad", destination: "svq", exact_date: "2026-07-03" },
    { origin: "svq", destination: "bcn", exact_date: "2026-07-06" }
  ]
)
```

**One-way example:**
```
train_scraper(
  session_id: "{session_id}",
  adults:     2,
  children:   [],
  combinations: [
    { origin: "mad", destination: "svq", exact_date: "2026-07-19" },
    { origin: "mad", destination: "svq", exact_date: "2026-07-03" },
    { origin: "mad", destination: "svq", exact_date: "2026-07-05" }
  ]
)
```

**CAPTCHA handling:** if Kayak returns 0 results, mark `[!] FAILED: CAPTCHA` on the
corresponding checkbox and report to the user. Do not retry.

**🛑 Do not advance to Phase 4 until all Search Checklist checkboxes are `[x]` or `[!] FAILED`.**

---

### Phase 4 — Consolidation and Final Report

#### Report scenario selector

Before writing the report, identify which template to use:

```
If trip_type == "one-way"    → Scenario A
If trip_type == "round-trip" → Scenario B
If trip_type == "open-jaw"   → Scenario C
```

#### 4a — Consolidate Trains

Call `consolidate_final_train_report` **exactly once — no date or site filter**:

**Example:**
```
consolidate_final_train_report(
  origin:      "mad",
  destination: "svq",
  session_id:  "{session_id}",
  limit:       2,
  sort_by:     "price",
  sort_dir:    "asc"
)
```

#### 4b — Write the Report

1. Write the full report to `report.md` using the `write` tool with the format for the matching scenario.
2. Mark `[x] Final Report` in `plan.md`.
3. Reply to the user in the chat channel using this format:

```markdown
> ✅ Train report ready: `/home/openclaw/.openclaw/workspace/resources/{session_id}/report.md`
>
> **Best option per combo:**
> - 🚄 [Option N] [dates] — €[price] ([search_url])
```

---

## report.md Format

---

### Scenario A — One-Way Trip

```markdown
### 🚄 Travel Option [N]: [Date] (One-Way)

**Outbound: [Origin City] ➔ [Destination City] | [DATE]**

#### 🔵 Kayak — Trains (best 2)
| # | Time | Total ([ADULTS] adults) | Operator | Changes |
| :--- | :--- | :--- | :--- | :--- |
| 1 | DEP–ARR | €PRICE | OPERATOR | 0 |
| 2 | DEP–ARR | €PRICE | OPERATOR | 0 |

🔗 [View trains on Kayak](SEARCH_URL)
```

---

### Scenario B — Round-Trip

```markdown
### 🚄 Travel Option [N]: [OUT_DATE] → [RET_DATE] ([DAYS] days)

**[Origin City] ➔ [Destination City] ➔ [Origin City]**

**Scout estimate (trenes.com):** outbound from €[OUT_PRICE] · return from €[RET_PRICE] · total ~€[TOTAL]

#### 🔵 Kayak — Trains (best 2)
| # | Outbound | Return | Total ([ADULTS] adults) | Operator | Changes |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | DEP–ARR | DEP–ARR | €PRICE | OPERATOR | 0 |
| 2 | DEP–ARR | DEP–ARR | €PRICE | OPERATOR | 0 |

🔗 [View trains on Kayak](SEARCH_URL)
```

---

### Scenario C — Multi-City / Open-Jaw

```markdown
### 🚄 Travel Option [N]: [OUT_DATE] → [RET_DATE] ([DAYS] days)

**[Origin City] ➔ [Dst City] / [Ret Origin City] ➔ [Ret Dst City]**

**Scout estimate (trenes.com):** outbound from €[OUT_PRICE] · return from €[RET_PRICE] · total ~€[TOTAL]

#### 🔵 Kayak — Trains (combined total: ~€[COMBO])

**Outbound: [Origin City] ➔ [Dst City] | [OUT_DATE]**
| # | Time | Total ([ADULTS] adults) | Operator | Changes |
| :--- | :--- | :--- | :--- | :--- |
| 1 | DEP–ARR | €PRICE | OPERATOR | 0 |

🔗 [View outbound trains on Kayak](SEARCH_URL_OUT)

**Return: [Ret Origin City] ➔ [Ret Dst City] | [RET_DATE]**
| # | Time | Total ([ADULTS] adults) | Operator | Changes |
| :--- | :--- | :--- | :--- | :--- |
| 1 | DEP–ARR | €PRICE | OPERATOR | 0 |

🔗 [View return trains on Kayak](SEARCH_URL_RET)
```
