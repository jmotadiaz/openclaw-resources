---
name: skyscanner-search
description: Searches for exact flights and final prices for a specific date and route on Skyscanner.
---

# Skyscanner Search Skill

## Instructions

Call the `flight_scraper` tool with the exact parameters given to you.

When the tool returns, output ONLY this JSON and nothing else. No text before. No text after. Stop immediately.

```json
{
  "status": "...",
  "summary": "...",
  "url": "..."
}
```

DO NOT call any other tool. DO NOT write explanations. STOP after the JSON.
