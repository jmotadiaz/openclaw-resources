---
name: travel-train-init
description: Initialize a train travel plan
---

## Instructions

Generate a `session_id` from the current timestamp (format: `YYYYMMDD_HHMM`, e.g. `20260713_1325`).

Call `train_plan_init` with the user's requirements:

```
train_plan_init(
  session_id: "{session_id}",
  transport: "train",
  trip_type: "round-trip", // or "one-way"
  routes: [{ origin: "{origin_city}", destination: "{destination_city}" }],
  months: ["{YYYY-MM}"],
  constraints: {
    min_days: {min},
    max_days: {max},
    adults: {N},
    children: []
  }
)
```

> Cities must be in **Spanish** (e.g. "Madrid", "Sevilla", "Barcelona").

The response includes `next_skill` — read that skill file and follow its instructions.
