---
name: travel-train-report
description: Generate and send the final report
---

## Instructions

1. Build the report:

```
report_build(session_id: "{session_id}")
```

The response includes `report_path` with the path to the generated markdown.

2. Send the report by email:

```
report_send(
  session_id: "{session_id}",
  subject: "🚄 Informe de viaje — {origin} → {destination}"
)
```

3. Mark as done:

```
train_plan_mark(
  session_id: "{session_id}",
  items: [
    { task: "Final Report", status: "done" },
    { task: "Email", status: "done" }
  ]
)
```

4. Reply to the user:

```
✅ Report generated and sent. Path: {report_path}
```

The `next_skill` will be `null` — the workflow is complete.
