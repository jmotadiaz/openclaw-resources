---
name: travel-train-scrape
description: Scrape trains via Kayak + delegate camper search
---

## Critical Order

1. **First**: Delegate camper search (non-blocking)
2. **Immediately after**: Run train scraper
3. Do NOT wait for campers before starting trains

## Step 1 — Delegate Camper Search

The `city` for campers is always the **train destination** (where the traveller arrives).

```
sessions_spawn(
  agentId: "camper-orchestrator",
  task: "Use the skill travel-camper. CONTEXT: {
    \"session_id\": \"{session_id}\",
    \"raw_user_query\": \"{raw_user_query}\",
    \"combinations\": [
      { \"city\": \"{destination_city}\", \"date_from\": \"{out_date}\", \"date_to\": \"{ret_date}\" }
    ],
    \"equipment\": [\"ac\", \"shower_int\", \"fridge\"],
    \"types\": [],
    \"seatbelts\": {total_travellers},
    \"beds\": null,
    \"station\": { \"name\": \"{station_name}\", \"latitude\": {lat}, \"longitude\": {lon} },
    \"traveller\": { \"adults\": {adults}, \"children\": {children}, \"budget_max\": {budget} }
  }",
  label: "camper-search"
)
```

> ⚠️ YOU MUST include `agentId: "camper-orchestrator"`.
> 🚫 NEVER add a `runtime` parameter.

### Station coordinates

| City      | Station         | Lat     | Lon     |
| --------- | --------------- | ------- | ------- |
| Madrid    | Atocha          | 40.4065 | -3.6895 |
| Sevilla   | Santa Justa     | 37.3914 | -5.9764 |
| Barcelona | Sants           | 41.3793 | 2.1403  |
| Valencia  | Joaquín Sorolla | 39.4651 | -0.3773 |
| Málaga    | María Zambrano  | 36.7143 | -4.4292 |

## Step 2 — Train Scraper

```
train_scraper(
  session_id: "{session_id}",
  adults: {N},
  children: [],
  combinations: [
    { origin: "{iata_origin}", destination: "{iata_dest}", exact_date: "{out_date}", return_date: "{ret_date}" },
    ...
  ]
)
```

> Use lowercase IATA codes: mad, svq, bcn, vlc, agp.

# Step 3 - Wait for campers finish

Use `sessions_yield` to wait for campers finish

## Step 4 — Mark done

```
train_plan_mark(
  session_id: "{session_id}",
  items: [{ task: "Scraping", status: "done" }]
)
```

The response includes `next_skill` — read that skill file and follow its instructions.
