---
id: backlog
title: Backlog
sidebar_position: 4
description: buy-scout — Backlog
---

# buy-scout — Backlog

## P0 — finish POC

1. **mobile.de email → detail fetch**
   - Email lead parser exists.
   - Fetch details via Firecrawl (key) or manual URL import.
   - AC-09, AC-10.

2. **Human labels**
   - 50 real listings, inspect/watch/skip + reason.
   - Compute precision@10; tune thresholds.
   - AC-15.

3. **Live Laya/DeepSeek**
   - Laya: download weights once (`LAYA_ENABLED=1`).
   - DeepSeek: set `DEEPSEEK_API_KEY`; compare fallback vs model.
   - AC-11, AC-12.

4. **Auto-fallback executor**
   - Try recommended strategies in order; log winner.
   - Rank by `(source, symptom, strategy)` Beta priors.
   - AC-24, AC-25.

## P1 — after POC

5. Kleinanzeigen email detail path.
6. Real VIN dedupe.
7. PLZ centroid/geocoder distance.
8. Daily digest/Telegram.
9. Productization: auth, billing, deployment.

## P2 — February

10. TV domain pack.
11. Multi-category source registry.
12. Human-in-the-loop messaging.
