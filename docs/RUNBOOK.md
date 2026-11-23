---
id: runbook
title: Runbook
sidebar_position: 2
description: buy-scout — Runbook
---

# buy-scout — Runbook

## Setup

```bash
cd buy-scout
npm install
cp .env.example .env   # optional; defaults work
```

## Daily fetch + report

```bash
npm run fetch:as24 -- --pages 1 --delay 500
npm run score -- --top 20
npm run health
npm run analyze          # all qualifying cards
npm run analyze -- --top 10   # manual override
npm run eval
npm run report
npm run ui
```

Open the interactive UI at `http://127.0.0.1:8124`.

Email leads:

```bash
mkdir -p data/emails
# put .eml/.html/.txt digests here
npm run email -- --dir data/emails
```

Daily chain:

```bash
npm run daily
```

`--no-details` skips detail enrichment; family fields become unknown and verdicts become `ask`.

## Verify

```bash
npm run typecheck
npm test
```

## Data layout

```text
data/
  buy-scout.db
  report.html
  raw/autoscout24/YYYY-MM-DD/*.html
  raw/autoscout24/YYYY-MM-DD/listings/*.json
  raw/autoscout24/YYYY-MM-DD/details/*.html
  raw/autoscout24/YYYY-MM-DD/details/*.json
```

## Criteria vs filters

- Criteria = budget, radius, seats, doors, year, km, fuel, gearbox, boot. Saving re-scores all stored listings and clears analyses. No fetch.
- View filters = verdict/source/price/km/year/search. Display only. No fetch, no re-score.
- Fetch = `npm run daily`; uses the active criteria.
- Analyze = `npm run analyze          # all qualifying cards
npm run analyze -- --top 10   # manual override` or the UI button; top N only.

See [CRITERIA-FLOW.md](CRITERIA-FLOW.md).

## Fetch now

- Open the UI and click **Fetch now**.
- It uses saved criteria. Save criteria first if you changed values.
- Progress is shown in the header; the shortlist reloads when done.
- It runs the same smart fetch as `npm run fetch:as24`.

## Interactive UI

- `npm run ui`
- Filters: verdict, source, max price, max km, min year, text search.
- Actions: Inspect / Watch / Skip; persisted in `user_actions`.
- Analysis from `npm run analyze` appears on the cards.

## Verdicts

- `inspect`: passes hard gates, complete family evidence, score ≥65.
- `ask`: passes hard gates, but seats/doors/ISOFIX/body missing.
- `watch`: passes hard gates, score &lt;65.
- `reject`: hard failure; score 0.

## Source health

`npm run health` reads the `sources` and `source_runs` tables. Blocked sources are visible; they are not removed.

## Reset

```bash
rm -rf data/buy-scout.db data/raw data/report.html
```

## Notes

- Node 24 `node:sqlite` emits an ExperimentalWarning. Acceptable for POC.
- Do not store seller phone numbers in normalized tables.
- A 200 response is not success. Check `integrity`.

## Adding a source

1. Implement `SourceAdapter`.
2. `search()` returns `RawRef[]` + `RawPage[]`.
3. Optional `fetchDetail()` returns `RawDetail`.
4. Add filter integrity assertions.
5. Register in the parallel runner.
6. Add a fixture test.
