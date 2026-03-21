---
name: travel-train-orchestrator
description: Orchestrates a train travel plan by scouting dates via trenes.com, searching trains via Kayak and campers via Yescapa, and consolidating results. For flights, use travel-flight-orchestrator.
---

## Workflow

### Phase 0 — Session Setup & Checklist

1. Generate `{session_id}` from timestamp (e.g. `20260313_1325`).
2. Create `/home/openclaw/.openclaw/workspace/resources/{session_id}/plan.md` using the `write` tool.
3. Classify the trip type:

| User says…                         | Type         | Return scouts needed            |
| ---------------------------------- | ------------ | ------------------------------- |
| One destination, no return         | `one-way`    | None                            |
| Same origin/destination for return | `round-trip` | `destination→origin`            |
| Return from a different city       | `open-jaw`   | `return_origin→outbound_origin` |

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
[ ] Scraping Trains & Campers
[ ] Final Report
```

> ⚠️ For **one-way** trips, omit the return scout line.

---

### Phase 1 — Train Date Scouting (parallel) — trenes.com only

Call `train_scout` with city names in Spanish:

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

Append the **Search Checklist** to `plan.md`. Each combo gets two lines: one for trains (`🚄`) and one for campers (`🚐`). The camper city is always the **train destination** (where the traveller arrives).

**Round-trip example:**

```
Search Checklist:
[ ] Search 1 🚄: Madrid ➔ Sevilla (Out: 2026-07-19) + Sevilla ➔ Madrid (Ret: 2026-07-22)
[ ] Search 1 🚐: Campers en Sevilla (2026-07-19 → 2026-07-22)
[ ] Search 2 🚄: Madrid ➔ Sevilla (Out: 2026-07-03) + Sevilla ➔ Madrid (Ret: 2026-07-06)
[ ] Search 2 🚐: Campers en Sevilla (2026-07-03 → 2026-07-06)
[ ] Search 3 🚄: Madrid ➔ Sevilla (Out: 2026-07-05) + Sevilla ➔ Madrid (Ret: 2026-07-08)
[ ] Search 3 🚐: Campers en Sevilla (2026-07-05 → 2026-07-08)
```

**Open-jaw example:**

```
Search Checklist:
[ ] Search 1a 🚄: Madrid ➔ Sevilla (Out: 2026-07-19)
[ ] Search 1b 🚄: Sevilla ➔ Barcelona (Out: 2026-07-22)
[ ] Search 1  🚐: Campers en Sevilla (2026-07-19 → 2026-07-22)
[ ] Search 2a 🚄: Madrid ➔ Sevilla (Out: 2026-07-03)
[ ] Search 2b 🚄: Sevilla ➔ Barcelona (Out: 2026-07-06)
[ ] Search 2  🚐: Campers en Sevilla (2026-07-03 → 2026-07-06)
```

**One-way example:**

```
Search Checklist:
[ ] Search 1 🚄: Madrid ➔ Sevilla (Out: 2026-07-19)
[ ] Search 1 🚐: Campers en Sevilla (2026-07-19 → ?)   ← date_to = date_from + 1 day (open-ended)
```

**🛑 Do not advance to Phase 3 until the Search Checklist is written in `plan.md`.**

---

### Phase 3 — Scraping: Trains + Campers (same turn)

Call `train_scraper` and `camper_scraper` **in the same turn**. They run independently — `camper_scraper` is pure HTTP and does not compete with `train_scraper` for browser resources.

> ⚠️ `train_scraper` uses IATA codes: Madrid → `mad`, Sevilla → `svq`, Barcelona → `bcn`, etc.
> ⚠️ `camper_scraper` uses Spanish city names and a `combinations[]` array — one entry per time window.

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

camper_scraper(
  session_id: "{session_id}",
  combinations: [
    { city: "Sevilla", date_from: "2026-07-19", date_to: "2026-07-22" },
    { city: "Sevilla", date_from: "2026-07-03", date_to: "2026-07-06" },
    { city: "Sevilla", date_from: "2026-07-05", date_to: "2026-07-08" }
  ],
  equipment: ["ac", "shower_int", "fridge"]
)
```

**Open-jaw example** (camper city = destination of first leg):

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

camper_scraper(
  session_id: "{session_id}",
  combinations: [
    { city: "Sevilla", date_from: "2026-07-19", date_to: "2026-07-22" },
    { city: "Sevilla", date_from: "2026-07-03", date_to: "2026-07-06" }
  ],
  equipment: ["ac", "shower_int", "fridge"]
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

camper_scraper(
  session_id: "{session_id}",
  combinations: [
    { city: "Sevilla", date_from: "2026-07-19", date_to: "2026-07-20" },
    { city: "Sevilla", date_from: "2026-07-03", date_to: "2026-07-04" },
    { city: "Sevilla", date_from: "2026-07-05", date_to: "2026-07-06" }
  ],
  equipment: ["ac", "shower_int", "fridge"]
)
```

After both tools complete, mark checkboxes in `plan.md`:

- `[x]` on success, noting saved count for campers: `— 13 resultados guardados`
- `[!] FAILED: CAPTCHA` for train failures
- `[!] FAILED: {reason}` for camper failures

**🛑 Do not advance to Phase 4 until all Search Checklist checkboxes are `[x]` or `[!] FAILED`.**

---

### Phase 4 — Consolidation and Final Report

#### 4a — Consolidate Trains

Call `consolidate_final_train_report` **exactly once**:

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

#### 4b — Consolidate Campers

Call `consolidate_final_camper_report` **exactly once**:

```
consolidate_final_camper_report(
  session_id: "{session_id}",
  city:       "Sevilla",
  limit:      5,
  sort_by:    "price",
  sort_dir:   "asc"
)
```

#### 4c — Write the Report

Write the full report to `report.md` using the `write` tool, mark `[x] Final Report` in `plan.md`, then reply:

```
✅ Report ready: `/home/openclaw/.openclaw/workspace/resources/{session_id}/report.md`
```

**Nothing else.** No summary, no table, no comments.

---

## report.md Format

Each time window gets a single `🗓️ Opción N` block containing trains first, then campers.
The train URL goes below its table. Each camper row links directly to its listing — no separate camper URL line.

---

### Scenario A — One-Way

```markdown
### 🗓️ Opción [N]: [DATE] (One-Way)

**[Origin City] ➔ [Destination City]**

#### 🚄 Kayak — Trenes (mejores 2)

| #   | Hora    | Total ([ADULTS] adultos) | Operador | Cambios |
| :-- | :------ | :----------------------- | :------- | :------ |
| 1   | DEP–ARR | €PRICE                   | OPERATOR | 0       |
| 2   | DEP–ARR | €PRICE                   | OPERATOR | 0       |

🔗 [Ver trenes en Kayak](https://www.kayak.es/...)

#### 🚐 Campers en [Destination City]

| #   | Modelo                                                   | Tipo       | Plazas | Camas | €/día | Total | Instant. | Rating   |
| :-- | :------------------------------------------------------- | :--------- | :----: | :---: | :---- | :---- | :------: | :------- |
| 1   | [Nombre del vehículo](https://www.yescapa.es/campers/ID) | Campervan  |   4    |   4   | €115  | €345  |    ✅    | 5.0 (21) |
| 2   | [Nombre del vehículo](https://www.yescapa.es/campers/ID) | CoachBuilt |   6    |   6   | €130  | €390  |    ❌    | 4.8 (7)  |
```

---

### Scenario B — Round-Trip

```markdown
### 🗓️ Opción [N]: [OUT_DATE] → [RET_DATE] ([DAYS] días)

**[Origin City] ➔ [Destination City] ➔ [Origin City]**

**Scout estimate (trenes.com):** ida desde €[OUT_PRICE] · vuelta desde €[RET_PRICE] · total ~€[TOTAL]

#### 🚄 Kayak — Trenes (mejores 2)

| #   | Ida     | Vuelta  | Total ([ADULTS] adultos) | Operador | Cambios |
| :-- | :------ | :------ | :----------------------- | :------- | :------ |
| 1   | DEP–ARR | DEP–ARR | €PRICE                   | OPERATOR | 0       |
| 2   | DEP–ARR | DEP–ARR | €PRICE                   | OPERATOR | 0       |

🔗 [Ver trenes en Kayak](https://www.kayak.es/...)

#### 🚐 Campers en [Destination City] ([OUT_DATE] → [RET_DATE])

| #   | Modelo                                                            | Tipo       | Plazas | Camas | €/día | Total | Instant. | Rating   |
| :-- | :---------------------------------------------------------------- | :--------- | :----: | :---: | :---- | :---- | :------: | :------- |
| 1   | [Roller Team Livingstone 5](https://www.yescapa.es/campers/39398) | Campervan  |   4    |   4   | €115  | €1320 |    ✅    | 5.0 (21) |
| 2   | [Benimar Sport 346](https://www.yescapa.es/campers/55887)         | CoachBuilt |   6    |   6   | €130  | €1444 |    ❌    | 5.0 (14) |

---

### 🗓️ Opción [N+1]: ...
```

> If `camper_scraper` failed for a combo, replace the camper table with:
> `> ⚠️ No se pudieron obtener campers para esta combinación.`

---

### Scenario C — Open-Jaw

```markdown
### 🗓️ Opción [N]: [OUT_DATE] → [RET_DATE] ([DAYS] días)

**[Origin City] ➔ [Dst City] / [Ret Origin City] ➔ [Ret Dst City]**

**Scout estimate (trenes.com):** ida desde €[OUT_PRICE] · vuelta desde €[RET_PRICE] · total ~€[TOTAL]

#### 🚄 Kayak — Trenes

**Ida: [Origin City] ➔ [Dst City] | [OUT_DATE]**
| # | Hora | Total ([ADULTS] adultos) | Operador | Cambios |
| :--- | :--- | :--- | :--- | :--- |
| 1 | DEP–ARR | €PRICE | OPERATOR | 0 |

🔗 [Ver trenes de ida en Kayak](https://www.kayak.es/...)

**Vuelta: [Ret Origin City] ➔ [Ret Dst City] | [RET_DATE]**
| # | Hora | Total ([ADULTS] adultos) | Operador | Cambios |
| :--- | :--- | :--- | :--- | :--- |
| 1 | DEP–ARR | €PRICE | OPERATOR | 0 |

🔗 [Ver trenes de vuelta en Kayak](https://www.kayak.es/...)

#### 🚐 Campers en [Dst City] ([OUT_DATE] → [RET_DATE])

| #   | Modelo                                                   | Tipo      | Plazas | Camas | €/día | Total | Instant. | Rating   |
| :-- | :------------------------------------------------------- | :-------- | :----: | :---: | :---- | :---- | :------: | :------- |
| 1   | [Nombre del vehículo](https://www.yescapa.es/campers/ID) | Campervan |   4    |   4   | €115  | €1320 |    ✅    | 5.0 (21) |
```
