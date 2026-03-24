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
[ ] Email Report
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
[ ] Search 2 🚄: Madrid ➔ Sevilla (Out: 2026-07-03) + Sevilla ➔ Madrid (Ret: 2026-07-06)
[ ] Search 3 🚄: Madrid ➔ Sevilla (Out: 2026-07-05) + Sevilla ➔ Madrid (Ret: 2026-07-08)
```

**Open-jaw example:**

```
Search Checklist:
[ ] Search 1a 🚄: Madrid ➔ Sevilla (Out: 2026-07-19)
[ ] Search 1b 🚄: Sevilla ➔ Barcelona (Out: 2026-07-22)
[ ] Search 2a 🚄: Madrid ➔ Sevilla (Out: 2026-07-03)
[ ] Search 2b 🚄: Sevilla ➔ Barcelona (Out: 2026-07-06)
```

**One-way example:**

```
Search Checklist:
[ ] Search 1 🚄: Madrid ➔ Sevilla (Out: 2026-07-19)
```

**🛑 Do not advance to Phase 3 until the Search Checklist is written in `plan.md`.**

---

### Phase 3 — Scraping: Trains + Campers (Sequential: Spawn then Scrape)

**CRITICAL ORDER OF EVENTS:**

1. You MUST call `sessions_spawn` tool to delegate the camper search first. **DO NOT read the camper skill directly. YOU MUST DELEGATE.**
2. **DO NOT yield or wait for the subagent's answer.**
3. Immediately call `train_scraper` in the next message.

Since `sessions_spawn` is non-blocking, it will return an acceptance status immediately while the subagent works in the background during your train scraping.

**Step 1: Camper delegation (non-blocking):**

> ⚠️ **DO NOT READ THE `travel-camper-orchestrator` SKILL YOURSELF. YOU MUST USE THE `sessions_spawn` TOOL!**
> ⚠️ YOU MUST EXPLICITLY INCLUDE `agentId: "camper-orchestrator"` IN THE TOOL CALL JSON, OTHERWISE IT WILL FAIL. DO NOT OMIT THIS PARAMETER!

```
sessions_spawn(
  agentId: "camper-orchestrator",
  task: "Use the skill travel-camper. CONTEXT: [CONTEXT]",
  label: "camper-search"
)
```

The [CONTEXT] in the `task` string must be a strictly formatted, stringified JSON object containing:

- `session_id`: same as the current session
- `combinations`: array of target cities and dates: `[{ "city": "...", "date_from": "YYYY-MM-DD", "date_to": "YYYY-MM-DD" }]`
- `equipment`, `types`, `seatbelts`, `beds`: camper preferences from the user
- `station`: `{ "name": "...", "latitude": 0.0, "longitude": 0.0 }` (from Coordinates table)
- `traveller`: `{ "adults": 2, "children": [], "budget_max": 2000 }`

**Step 2: Train scraper:**

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

After `train_scraper` completes, mark train checkboxes in `plan.md`.

**🛑 Do not advance to Phase 4 until all Train Search Checklist checkboxes are `[x]` or `[!] FAILED`.**

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

#### 4b — Insert camper results

Si el subagente `camper-orchestrator` aún no ha terminado, haz yield y espera su evento de finalización.

Una vez recibido el evento, llama a `camper_fetch`:

```
camper_fetch(
  session_id: "{session_id}",
  namespace: "results"
)
```

- `status: "success"` → extrae `data.markdown` e insértalo en `report.md` debajo de la sección de trenes de cada opción de fecha.
- `status: "not_found"` → anota `⚠️ Campers no disponibles` en el report y continúa.

**No uses el resultado del evento de auto-announce** — puede estar truncado por el proxy LLM.

#### 4c — Write the Report

Write the full report to `report.md` using the `write` tool, then mark `[x] Final Report` in `plan.md`.

#### 4d — Send the Report by Email

Call `send_report_email` with the report path and a descriptive subject:

```
send_report_email(
  file_path: "/home/openclaw/.openclaw/workspace/resources/{session_id}/report.md",
  subject:   "🚄 Informe de viaje — {Origin} → {Destination} ({months})"
)
```

- On success (`status: "success"`): mark `[x] Email Report` in `plan.md`.
- On failure (`status: "error"`): mark `[!] Email Report FAILED: {message}` in `plan.md`. **Do not retry** — proceed to the final reply regardless.

Then reply:

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

| #   | Modelo                                                   | Tipo       | Camas | €/día | Total |
| :-- | :------------------------------------------------------- | :--------- | :---: | :---- | :---- |
| 1   | [Nombre del vehículo](https://www.yescapa.es/campers/ID) | Campervan  |   4   | €115  | €345  |
| 2   | [Nombre del vehículo](https://www.yescapa.es/campers/ID) | CoachBuilt |   6   | €130  | €390  |
```

---

### Scenario B — Round-Trip

````markdown
### 🗓️ Opción [N]: [OUT_DATE] → [RET_DATE] ([DAYS] días)

**[Origin City] ➔ [Destination City] ➔ [Origin City]**

#### 🚄 Kayak — Trenes (mejores 2)

| #   | Ida     | Vuelta  | Total ([ADULTS] adultos) | Operador | Cambios |
| :-- | :------ | :------ | :----------------------- | :------- | :------ |
| 1   | DEP–ARR | DEP–ARR | €PRICE                   | OPERATOR | 0       |
| 2   | DEP–ARR | DEP–ARR | €PRICE                   | OPERATOR | 0       |

🔗 [Ver trenes en Kayak](https://www.kayak.es/...)

#### 🚐 Campers en [Destination City] ([OUT_DATE] → [RET_DATE])

| #   | Modelo                                                            | Tipo       | Camas | €/día | Total |
| :-- | :---------------------------------------------------------------- | :--------- | :---: | :---- | :---- |
| 1   | [Roller Team Livingstone 5](https://www.yescapa.es/campers/39398) | Campervan  |   4   | €115  | €1320 |
| 2   | [Benimar Sport 346](https://www.yescapa.es/campers/55887)         | CoachBuilt |   6   | €130  | €1444 |

---

### Scenario C — Open-Jaw

```markdown
### 🗓️ Opción [N]: [OUT_DATE] → [RET_DATE] ([DAYS] días)

**[Origin City] ➔ [Dst City] / [Ret Origin City] ➔ [Ret Dst City]**

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

| #   | Modelo                                                   | Tipo      | Camas | €/día | Total |
| :-- | :------------------------------------------------------- | :-------- | :---: | :---- | :---- |
| 1   | [Nombre del vehículo](https://www.yescapa.es/campers/ID) | Campervan |   4   | €115  | €1320 |
```
````
