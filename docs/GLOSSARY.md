---
id: glossary
title: Glossary
sidebar_label: Glossary
sidebar_position: 99
description: The vocabulary buy-scout uses — criteria, verdicts, score, confidence, coverage, adapters, Laya, DeepSeek and the terms that are easy to confuse.
keywords:
  - glossary
  - criteria
  - verdict
  - confidence
  - coverage
  - source adapter
---

The vocabulary used by the code and the docs. Verified against criteria profile **v18** and the current SQLite schema. Where a term has a precise implementation, the last column names the page that owns it.

## Terms

| Term | What it means here | Owner |
|---|---|---|
| Access playbook | Symptom-to-strategy ladder plus persisted evidence: `classifyAccessFailure()` names the block, `recommendStrategies()` returns the fallback order, every try is written to `access_attempts`, confirmed fixes become `rule_cards` lessons (`npm run playbook`). | [Sources & access](./SOURCES-OPERATIONS.md) |
| Analysis | Per-listing explanatory text — summary, contradictions, seller questions, negotiation points, risk notes — stored in `listing_analyses`. It explains a verdict; it never produces one. | [Analysis](./ANALYSIS.md) |
| Analysis invalidation | Deleting every stored analysis when criteria are saved, because reasoning produced under the old rules may no longer be true. Triggered only by `saveCriteria()`; fetching and view filtering do not invalidate anything. | [Criteria & filters](./CRITERIA.md) |
| Analysis selection | See *Qualify*. Implemented by `selectAnalysisCandidates()` and exposed in the UI as "Analyze qualifying cards". | [Analysis](./ANALYSIS.md) |
| Brief (SearchBrief) | The Zod-validated shape of a criteria profile: category, budget, location, hard gates, soft fields, analysis settings, priority weights. | [Criteria & filters](./CRITERIA.md) |
| Confidence | Evidence coverage from 0 to 1: present tracked fields divided by nine (price, mileage, first registration, fuel, transmission, seats, doors, ISOFIX, body type). A cheap car with missing family data has low confidence. | [Verdicts & scoring](./VERDICTS.md) |
| Coverage | The `fetch_coverage` ledger: one row per source and query key (ZIP, radius, fuel, gearbox) holding the covered price band, pages, total results and last fetch. It chooses full, expand or refresh mode and only ever grows. | [Sources & access](./SOURCES-OPERATIONS.md) |
| Criteria (criteria profile) | Versioned decision rules in `criteria_profiles`. The active row drives fetch, score, analyze, eval, report and UI. Saving writes a new version, re-scores every stored listing and clears analyses. It never fetches. | [Criteria & filters](./CRITERIA.md) |
| Criteria version | Monotonic integer with exactly one active row (partial unique index). Currently **v18**. | [Criteria & filters](./CRITERIA.md) |
| Dedupe | Conservative cross-source duplicate key: make + model + first-registration month + 5,000 km mileage bucket + €250 price bucket. No VIN matching yet. | [Data model](./DATA-MODEL.md) |
| DeepSeek | The LLM used only for analysis text after a listing qualifies; it never extracts listing fields. With no `LLM_API_KEY`, the deterministic German fallback is used instead. | [Analysis](./ANALYSIS.md) |
| Derived | Anything recomputed from raw data plus code plus criteria: `listings`, scores, verdicts, analyses. Safe to rebuild; not the source of truth. | [Data model](./DATA-MODEL.md) |
| Family-critical unknown | One of seats, doors, ISOFIX or body type missing from a listing. Any of these turns a gate-passing listing into ASK instead of INSPECT. | [Verdicts & scoring](./VERDICTS.md) |
| Filter integrity | Post-fetch assertions on observed max price, max distance, total result count and parsed listing count. A run that fails them is marked `filter_invalid` and is not trusted as a successful fetch. | [Sources & access](./SOURCES-OPERATIONS.md) |
| Hard gate | A deterministic veto in `evaluateCar()`: price above `purchaseMaxEur`, distance beyond the radius plus the shared tolerance `max(5 km, ceil(5% of radius))`, damaged, commercial or export-only, fewer than 5 seats, fewer than 4 doors, ISOFIX explicitly false, first registration before 2010, mileage above 180,000 km, fuel or gearbox mismatch when configured, or a hard red flag. A hard failure forces `reject` and score 0. | [Verdicts & scoring](./VERDICTS.md) |
| Hard pass | No hard failures. Not the same as INSPECT: WATCH also passes. Counts are generated; run `npm run eval` for the current split. | [Verdicts & scoring](./VERDICTS.md) |
| INSPECT | No hard failure, no family-critical unknown, score 65 or higher. A screening label meaning "worth a viewing". | [Verdicts & scoring](./VERDICTS.md) |
| ASK | No hard failure, but at least one family-critical field is unknown. Ask the seller before booking; ASK outranks INSPECT. | [Verdicts & scoring](./VERDICTS.md) |
| WATCH | No hard failure, no family-critical unknown, score below 65. Keep watching for a price drop or a better car. | [Verdicts & scoring](./VERDICTS.md) |
| REJECT | At least one hard failure; score 0. A bad fit for this brief, not necessarily a bad car. | [Verdicts & scoring](./VERDICTS.md) |
| Laya | `@receptron/laya`, a local classifier. It labels family fit, risk, next action and deal; on by default for CLI `fetch`/`analyze`/`daily`, disabled with `--no-laya` or `LAYA_ENABLED=0`. Advisory only: it never feeds the score or verdict; UI paths skip it. | [Analysis](./ANALYSIS.md) |
| Priority weight (soft preference) | A row in `criteria.preferences` (field, match, value, weight from 0 to 25) that adds points to the score, total capped at +25. It never filters and can never rescue a hard failure. | [Criteria & filters](./CRITERIA.md) |
| Qualify | A listing qualifies for analysis when it is not rejected, its score is at least `analysis.minScore` (60) and its confidence at least `analysis.minConfidence` (0.6); `maxCards` (30) caps the batch. The UI calls these "qualifying cards". | [Analysis](./ANALYSIS.md) |
| Raw | Immutable fetched artefacts: HTML and JSON under `data/raw/**`, plus `raw_pages`, `raw_listings` and `raw_details` rows that point at them. Re-parsing must never require re-fetching. | [Data model](./DATA-MODEL.md) |
| Reserve | `reserveEur` (€800): money kept back for fees, tyres and first repairs. Not a price filter. `budgetAllInEur = purchaseMaxEur + reserveEur`, so €7,000 + €800 = €7,800 all-in; only `purchaseMaxEur` gates a listing. | [Criteria & filters](./CRITERIA.md) |
| Score | Ranking fit from 0 to 100: 30% family, 25% deal, 15% age, 15% mileage, 10% distance, 5% evidence, plus at most +25 priority boost. Forced to 0 on a hard failure. A ranking, not a probability or a quality grade. | [Verdicts & scoring](./VERDICTS.md) |
| Shortlist | The non-rejected listings the UI shows by default, ordered by verdict, then score. | [Web UI](./UI.md) |
| Skip | A user action in `user_actions` meaning "I have decided against this car". Distinct from the engine verdict REJECT. | [Web UI](./UI.md) |
| Smart fetch | Newest-first fetch (`sort=age&desc=1`), adaptive 5 to 10 pages, target 50 new listings, stop when a page is mostly known, details only for new or changed cards, coverage ledger and learned page budget. Currently AutoScout24-only. | [Sources & access](./SOURCES-OPERATIONS.md) |
| Soft brief fields | `brief.soft` values: minimum boot litres, three-across, maximum length, prioritise list. Advisory: stored and passed to Laya, but they do not gate or score today. | [Criteria & filters](./CRITERIA.md) |
| Source adapter | A per-source implementation of `SourceAdapter`: `search()` returns raw refs and pages, optional `fetchDetail()` returns a raw detail. Registered in the parallel runner. Today: `autoscout24` and `kleinanzeigen` enabled, `autouncle` written but disabled; no mobile.de adapter. | [Architecture](./ARCHITECTURE.md) |
| User action | Inspect, watch or skip recorded in `user_actions` — your decisions, not the machine's. They survive criteria changes. | [Web UI](./UI.md) |
| Verdict | Exactly one of INSPECT, ASK, WATCH, REJECT per listing, with fixed precedence: hard failure, then family unknown, then score 65 or higher, else WATCH. | [Verdicts & scoring](./VERDICTS.md) |
| View filter | Display-only narrowing in the UI: verdict, source, max price, max km, min year, text search. It writes nothing, fetches nothing and starts no analysis; the API re-evaluates stored rows with the active criteria on read, but nothing is persisted. | [Web UI](./UI.md) |

## Do not confuse these

:::warning Criteria are not view filters
Criteria change verdicts, re-score every stored listing and invalidate analyses. View filters only change what you see and write nothing. Saving criteria never fetches. See [Criteria & filters](./CRITERIA.md).
:::

:::warning Score is not confidence
Score ranks fit. Confidence measures how complete the evidence is. A high score with low confidence is exactly the ASK case.
:::

:::warning Raw is not derived
Raw snapshots are immutable evidence. `listings`, scores and analyses are derived and may be rebuilt from raw data, code and the active criteria.
:::

:::note Verdict is not an action
INSPECT does not mean you inspected the car, and Skip is not REJECT. The verdict is the engine's screening label; inspect, watch and skip are your decisions.
:::

## Numbers used above

- Active profile **v18**: €7,000 car cap, €800 reserve, €7,800 all-in, 200 km radius.
- Analysis defaults: minimum score 60, minimum confidence 0.6, at most 30 cards.
- INSPECT threshold: score 65.
- Corpus: generated; run `npm run eval` for the current count and `npm test` for the current suite.

If any of these drift, update this page and the owning page in the same commit as the criteria change.
