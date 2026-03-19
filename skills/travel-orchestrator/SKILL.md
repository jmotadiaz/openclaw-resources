---
name: travel-flight-orchestrator
description: Orchestrates a flight-only travel plan by scouting dates, searching flights across Skyscanner + Kayak, and consolidating results. For trains, use travel-train-orchestrator.
---

## Workflow

### Phase 0 — Session Setup & Checklist

Before any tool call, create the session directory and the execution checklist.

**Steps:**

1. Generate `{session_id}` from timestamp (e.g. `20260313_1325`).
2. Create `/home/openclaw/.openclaw/workspace/resources/{session_id}/plan.md` using the `write` tool.
3. Classify the trip type:

| User says… | Type | Return scouts needed |
|---|---|---|
| One destination, no return | `one-way` | None |
| Same origin/destination for return | `round-trip` | `destination→origin` |
| Return from a different city | `open-jaw` | `return_origin→outbound_origin` |

4. Write the user's exact constraints and the initial checklist state into `plan.md`.

**Full `plan.md` example at the end of Phase 0:**

```
Trip type: round-trip
Outbound:  MAD → SVQ
Return:    SVQ → MAD
Months:    2026-07
Min days:  2 | Max days: 5
Pax:       2

Checklist:
[x] Session Init
[ ] Scout Outbound MAD->SVQ (2026-07)   ← Skyscanner only
[ ] Scout Return   SVQ->MAD (2026-07)   ← Skyscanner only
[ ] Extractor Phase (find_best_date_combinations)
[ ] Search Checklist (appended after Phase 2)
[ ] Scraping Flights
[ ] Final Report
```

> ⚠️ For **one-way** trips, omit the return scout and return scraping lines.
> ⚠️ Always use `YYYY-MM` for months and `YYYY-MM-DD` for exact dates.

---

### Phase 1 — Date Scouting (parallel) — Skyscanner only

> ⚠️ **Kayak has no monthly calendar.** Only Skyscanner routes go into `routes`.

Call `date_scout`:

**example:**
```
date_scout(
  session_id: "{session_id}",
  routes: [
    { origin: "mad", destination: "svq", month: "2026-07" },
    { origin: "svq", destination: "mad", month: "2026-07" }   ← omit for one-way
  ]
)
```

Process results and mark checkboxes in `plan.md`.

**🛑 Do not advance to Phase 2 until all Scout checkboxes are `[x]` or `[!] FAILED`.**

---

### Phase 2 — Selecting the Best Windows

Call `find_best_date_combinations`:

**example:**
```
find_best_date_combinations(
  session_id:  "{session_id}",
  origin:      "mad",
  destination: "svq",
  min_days:    2,
  max_days:    5,
  top:         3,
  months:      "2026-07"
)
```

> For **one-way** trips, omit the `return` parameters if the tool supports them (but currently it uses scouts in DB).
> The tool returns a list of date combinations sorted by estimated price. 

Append the **Search Checklist** to `plan.md` using the format that matches the trip type:

**Round-trip example** (one entry per combo):
```
Search Checklist:
[ ] Search 1: MAD ➔ SVQ (Out: 2026-07-19) + SVQ ➔ MAD (Ret: 2026-07-22)
[ ] Search 2: MAD ➔ SVQ (Out: 2026-07-03) + SVQ ➔ MAD (Ret: 2026-07-06)
[ ] Search 3: MAD ➔ SVQ (Out: 2026-07-05) + SVQ ➔ MAD (Ret: 2026-07-08)
```

**Open-jaw example** (two entries per combo, labelled a/b):
```
Search Checklist:
[ ] Search 1a: MAD ➔ SVQ (Out: 2026-07-19)
[ ] Search 1b: SVQ ➔ BCN (Out: 2026-07-22)
[ ] Search 2a: MAD ➔ SVQ (Out: 2026-07-03)
[ ] Search 2b: SVQ ➔ BCN (Out: 2026-07-06)
```

**🛑 Do not advance to Phase 3 until the Search Checklist is written in `plan.md`.**

---

### Phase 3 — Scraping (parallel)

#### Flight Scraping (Skyscanner + Kayak Flights)

Internally it spawns 2 concurrent browsers per combination (Skyscanner + Kayak flights).

**Round-trip example:**
```
flight_scraper(
  session_id:   "{session_id}",
  pax:          2,
  combinations: [
    { origin: "mad", destination: "svq", exact_date: "2026-07-19", return_date: "2026-07-22" },
    { origin: "mad", destination: "svq", exact_date: "2026-07-03", return_date: "2026-07-06" }
  ]
)
```

**Open-jaw example** (one one-way entry per leg, no `return_date`):
```
flight_scraper(
  session_id:   "{session_id}",
  pax:          2,
  combinations: [
    { origin: "mad", destination: "svq", exact_date: "2026-07-19" },
    { origin: "svq", destination: "bcn", exact_date: "2026-07-22" }
  ]
)
```

**CAPTCHA handling:** if Kayak returns 0 results, mark `[!] FAILED: CAPTCHA` on the corresponding checkbox and report to the user. Do not retry.

**🛑 Do not advance to Phase 4 until all Scraping checkboxes are `[x]` or `[!] FAILED`.**

---

### Phase 4 — Data Consolidation and Final Report

#### Report scenario selector

Before writing the report, identify which template to use:

```
If trip_type == "one-way"    → Scenario A
If trip_type == "round-trip" → Scenario B
If trip_type == "open-jaw"   → Scenario C
```

#### 4a — Consolidate Flights

Call `consolidate_final_flight_report` **exactly once — no date or site filter**:

**example:**
```
consolidate_final_flight_report(
  origin:      "mad",
  destination: "svq",
  session_id:  "{session_id}",
  limit:       2,
  sort_by:     "price",
  sort_dir:    "asc"
)
```

#### 4b — Write the Report

1. Write the full report to `report.md` using the `write` tool with the format for the matching scenario (see section below).
2. Mark `[x] Final Report` in `plan.md`.
3. Reply to the user in the chat channel using this format:

```markdown
> ✅ Report ready: `/home/openclaw/.openclaw/workspace/resources/{session_id}/report.md`
>
> **Best option per site:**
> - 🟠 Skyscanner: [Option N] [dates] — €[price] ([search_url])
> - 🔵 Kayak flights: [Option N] [dates] — €[price] ([search_url])
```

---

## report.md Format

---

### Scenario A — One-Way Trip

```markdown
### ✈️ Travel Option [N]: [Date] (One-Way)

**Outbound: [ORG] ➔ [DST] | [DATE]**

#### 🟠 Skyscanner (best 2)
| # | Time | Total ([PAX] pax) | Airline |
| :--- | :--- | :--- | :--- |
| 1 | DEP – ARR | €PRICE | AIRLINE |
| 2 | DEP – ARR | €PRICE | AIRLINE |

🔗 [View on Skyscanner](SEARCH_URL)

#### 🔵 Kayak (best 2)
| # | Time | Total ([PAX] pax) | Airline |
| :--- | :--- | :--- | :--- |
| 1 | DEP – ARR | €PRICE | AIRLINE |
| 2 | DEP – ARR | €PRICE | AIRLINE |

🔗 [View on Kayak](SEARCH_URL)
```

---

### Scenario B — Round-Trip

```markdown
### ✈️ Travel Option [N]: [OUT_DATE] → [RET_DATE] ([DAYS] days)

**[ORG] ➔ [DST] ➔ [ORG]**

#### 🟠 Skyscanner — Flights
| # | Outbound | Return | Total ([PAX] pax) | Airline |
| :--- | :--- | :--- | :--- | :--- |
| 1 | DEP–ARR | DEP–ARR | €PRICE | AIRLINE |
| 2 | DEP–ARR | DEP–ARR | €PRICE | AIRLINE |

🔗 [View on Skyscanner](SEARCH_URL)

#### 🔵 Kayak — Flights
| # | Outbound | Return | Total ([PAX] pax) | Airline |
| :--- | :--- | :--- | :--- | :--- |
| 1 | DEP–ARR | DEP–ARR | €PRICE | AIRLINE |
| 2 | DEP–ARR | DEP–ARR | €PRICE | AIRLINE |

🔗 [View on Kayak](SEARCH_URL)
```

---

### Scenario C — Multi-City / Open-Jaw

Same structure as Scenario B but with separate **Outbound** and **Return** sub-sections per source. Each sub-section has its own table followed by its own `🔗` link on a separate line. The `combo_total` per site is shown in the section header.

```markdown
### ✈️ Travel Option [N]: [OUT_DATE] → [RET_DATE] ([DAYS] days)

**[ORG] ➔ [DST_OUT] / [RET_ORG] ➔ [DST_RET]**

#### 🟠 Skyscanner — Combined total: €COMBO

**Outbound: [ORG] ➔ [DST] | [DATE]**
| # | Time | Total ([PAX] pax) | Airline |
| :--- | :--- | :--- | :--- |
| 1 | DEP–ARR | €PRICE | AIRLINE |

🔗 [View outbound on Skyscanner](SEARCH_URL_OUT)

**Return: [RET_ORG] ➔ [RET_DST] | [RET_DATE]**
| # | Time | Total ([PAX] pax) | Airline |
| :--- | :--- | :--- | :--- |
| 1 | DEP–ARR | €PRICE | AIRLINE |

🔗 [View return on Skyscanner](SEARCH_URL_RET)

#### 🔵 Kayak — Combined total: €COMBO

**Outbound: [ORG] ➔ [DST] | [DATE]**
| # | Time | Total ([PAX] pax) | Airline |
| :--- | :--- | :--- | :--- |
| 1 | DEP–ARR | €PRICE | AIRLINE |

🔗 [View outbound on Kayak](SEARCH_URL_OUT)

**Return: [RET_ORG] ➔ [RET_DST] | [RET_DATE]**
| # | Time | Total ([PAX] pax) | Airline |
| :--- | :--- | :--- | :--- |
| 1 | DEP–ARR | €PRICE | AIRLINE |

🔗 [View return on Kayak](SEARCH_URL_RET)
```
