---
name: travel-train-orchestrator
description: Orchestrates a train travel plan by scouting dates via trenes.com, searching trains via Kayak and campers via Yescapa, and consolidating results. For flights, use travel-flight-orchestrator.
---

## Workflow

### Phase 0 — Session Setup

1. Generate `{session_id}` from timestamp (e.g. `20260313_1325`).
2. Call `plan_init` to initialize the planning state and create the resource directory and `plan.md`.

```
plan_init(
  session_id: "{session_id}",
  transport: "train",
  trip_type: "round-trip",
  routes: [{ origin: "Madrid", destination: "Sevilla" }],
  months: ["2026-07"],
  constraints: {
    min_days: 2,
    max_days: 5,
    adults: 2,
    children: []
  }
)
```

> ⚠️ Cities must be provided in **Spanish** (e.g. "Madrid", "Sevilla", "Barcelona").
> ⚠️ Always use `YYYY-MM` for months and `YYYY-MM-DD` for exact dates.

---

### Phase 1 — Train Date Scouting (parallel) — trenes.com only

1. Call `train_scout` with city names in Spanish:

```
train_scout(
  session_id: "{session_id}",
  routes: [
    { origin_city: "Madrid",  destination_city: "Sevilla", month: "2026-07" },
    { origin_city: "Sevilla", destination_city: "Madrid",  month: "2026-07" }
  ]
)
```

2. Update progress:
```
plan_mark(
  session_id: "{session_id}",
  items: [{ task: "Scout Phase", status: "done" }]
)
```

---

### Phase 2 — Selecting Best Windows

1. Call `find_best_train_date_combinations`:

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

2. Register the resulting combinations in the plan:
```
plan_append_searches(
  session_id: "{session_id}",
  combinations: [
    { description: "Madrid -> Sevilla (2026-07-19) / Sevilla -> Madrid (2026-07-22)" },
    ...
  ]
)
```

3. Update progress:
```
plan_mark(
  session_id: "{session_id}",
  items: [{ task: "Extractor Phase", status: "done" }]
)
```

---

### Phase 3 — Scraping: Trains + Campers (Sequential: Spawn then Scrape)

**CRITICAL ORDER OF EVENTS:**

1. **Delegate Camper Search**: Use `sessions_spawn` with `agentId: "camper-orchestrator"`.
2. **DO NOT wait** for the subagent to finish. Immediately call `train_scraper`.

**Step 1: Camper delegation (non-blocking):**

> ⚠️ YOU MUST EXPLICITLY INCLUDE `agentId: "camper-orchestrator"`.
> ⚠️ The `combinations` in the CONTEXT must use `{ "city", "date_from", "date_to" }` format — NOT the `description` format from plan_append_searches.
> 🚫 NEVER add a `runtime` parameter — it will cause an error. The only valid params are `agentId`, `task`, and `label`.

The `city` for campers is always the **train destination** (where the traveller arrives).

```
sessions_spawn(
  agentId: "camper-orchestrator",
  task: "Use the skill travel-camper. CONTEXT: {
    \"session_id\": \"{session_id}\",
    \"combinations\": [
      { \"city\": \"{destination_city}\", \"date_from\": \"YYYY-MM-DD\", \"date_to\": \"YYYY-MM-DD\" }
    ],
    \"equipment\": [\"ac\", \"shower_int\", \"fridge\"],
    \"types\": [],
    \"seatbelts\": {seatbelts},
    \"beds\": null,
    \"station\": { \"name\": \"{station_name}\", \"latitude\": {lat}, \"longitude\": {lon} },
    \"traveller\": { \"adults\": {adults}, \"children\": {children}, \"budget_max\": {budget_max} }
  }",
  label: "camper-search"
)
```

**Station coordinates reference:**

| City      | Station         | Lat     | Lon     |
| --------- | --------------- | ------- | ------- |
| Madrid    | Atocha          | 40.4065 | -3.6895 |
| Sevilla   | Santa Justa     | 37.3914 | -5.9764 |
| Barcelona | Sants           | 41.3793 | 2.1403  |
| Valencia  | Joaquín Sorolla | 39.4651 | -0.3773 |
| Málaga    | María Zambrano  | 36.7143 | -4.4292 |

**Step 2: Train scraper:**

```
train_scraper(
  session_id: "{session_id}",
  adults:     2,
  children:   [],
  combinations: [
    { origin: "mad", destination: "svq", exact_date: "2026-07-19", return_date: "2026-07-22" },
    ...
  ]
)
```

3. Update progress:
```
plan_mark(
  session_id: "{session_id}",
  items: [
    { task: "Scraping Phase", status: "done" }
  ]
)
```


---

### Phase 4 — Final Report & Delivery

1. **Trigger Report Generation**: Call `report_build`. This automatically reads all results from DB and renders `report.md`.
```
report_build(session_id: "{session_id}")
```

2. **Send Report**: Call `report_send`.
```
report_send(
  session_id: "{session_id}",
  subject: "🚄 Informe de viaje — Madrid → Sevilla"
)
```

3. Update progress:
```
plan_mark(
  session_id: "{session_id}",
  items: [
    { task: "Final Report", status: "done" },
    { task: "Email Report", status: "done" }
  ]
)
```

4. Final reply:
```
✅ Report ready in resource directory.
```

---

## Technical Notes

- The `main` agent has **READ-ONLY** access to the filesystem. NEVER use `write` or `edit` tools on `plan.md` or `report.md`. Use the specialized tools (`plan_init`, `plan_mark`, `plan_append_searches`, `report_build`).
- All state is managed internally by the extension.
