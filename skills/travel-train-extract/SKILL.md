---
name: travel-train-extract
description: Find best date combinations and register search checklist
---

## Instructions

1. Call `find_best_train_date_combinations`:

```
find_best_train_date_combinations(
  session_id: "{session_id}",
  origin_city: "{origin}",
  destination_city: "{destination}",
  months: "{YYYY-MM}",
  min_days: {min_days},
  max_days: {max_days},
  top: 3
)
```

2. Register the resulting combinations:

```
train_plan_append_searches(
  session_id: "{session_id}",
  combinations: [
    { description: "{origin} -> {destination} ({out_date}) / {destination} -> {origin} ({ret_date})" },
    ...
  ]
)
```

3. Mark the phase as done:

```
train_plan_mark(
  session_id: "{session_id}",
  items: [{ task: "Extractor", status: "done" }]
)
```

The response includes `next_skill` — read that skill file and follow its instructions.
