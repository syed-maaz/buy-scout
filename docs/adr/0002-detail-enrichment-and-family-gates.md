---
id: adr-0002
title: ADR-0002 — Detail Enrichment & Family Gates
sidebar_position: 4
description: buy-scout — ADR-0002 — Detail Enrichment & Family Gates
---

# ADR-0002: Detail enrichment and family gates

- Status: accepted
- Date: 2026-10-28

## Context

The AutoScout24 search payload has price, mileage, first registration, fuel, gearbox, power, seller type, and distance — but not seats, doors, body type, ISOFIX, equipment, description, or the market median. Those are required for a family-car decision.

## Decision

1. **Fetch the detail page** for each listing and parse `listingDetails` from `__NEXT_DATA__`.
2. **Merge detail into the normalized listing** deterministically:
   - seats, doors, body type
   - ISOFIX presence from equipment/description
   - equipment list
   - description text
   - market median (`prices.public.median`)
   - warranty flag
   - CarFax URL
   - commercial/export-only detection
   - red flags (Unfallschaden, Bastler, Motorschaden, Getriebeschaden, ohne TÜV, nicht fahrbereit)
3. **Hard gates run on known fields only.** Unknown family fields produce `verdict=ask`, not a silent pass.
4. **Hard failure = score 0** and `verdict=reject`.
5. **Verdicts:** `inspect` (pass + score ≥65), `ask` (pass but missing family evidence), `watch` (pass but low score), `reject` (hard fail).
6. **No LLM extraction.** DeepSeek is not used to fill any of these fields.

## Consequences

- One extra HTTP request per listing; throttle and cache.
- Detail failures degrade the listing to `ask`, never crash the run.
- Family gates are explainable and testable.
- The score is a POC v1; safety/cost/reliability dossiers are still missing.
