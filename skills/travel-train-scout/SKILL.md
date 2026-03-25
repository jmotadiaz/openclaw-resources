---
name: travel-train-scout
description: Scout cheapest train dates via trenes.com
---

## Context

You have a `session_id` and plan already initialized. The plan contains routes and months.

## Instructions

1. Call `train_scout` with **both directions** (outbound + return):

```
train_scout(
  session_id: "{session_id}",
  routes: [
    { origin_city: "{origin}", destination_city: "{destination}", month: "{YYYY-MM}" },
    { origin_city: "{destination}", destination_city: "{origin}", month: "{YYYY-MM}" }
  ]
)
```

> If multiple months, include all route+month combinations in a single call.

2. Mark the phase as done:

```
train_plan_mark(
  session_id: "{session_id}",
  items: [{ task: "Scouting", status: "done" }]
)
```

The response includes `next_skill` — read that skill file and follow its instructions.
