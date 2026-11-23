---
id: journal
title: Journal
sidebar_position: 7
description: buy-scout — Journal
---

# buy-scout — Journal

## 2026-10-28 — morning

- Research: AS24 HTTP; mobile.de blocked; Kleinanzeigen Akamai; AutoUncle Cloudflare; Laya/DeepSeek split.
- Built repo, AS24 search, parallel runner, filter integrity, SQLite, CLI, docs.

## 2026-10-28 — afternoon

- AS24 detail enrichment; family gates; score/verdicts; dedupe; decision persistence; source health; static report.
- 14 tests.

## 2026-10-28 — evening

### Workaround tests

- mobile.de: direct 403; Playwright headless/headful denied; Jina 403; Firecrawl 200 but filters ignored; official API 401.
- AutoUncle: Jina Reader 200 HTML; regional + price path works; Firecrawl 200 fallback.
- Implemented AutoUncle Jina adapter: 25 cards/page, price bucket, ZIP distance estimate.
- Parallel run: 20 AS24 + 25 AutoUncle = 45 scored.
- Fixed AutoUncle concatenated year/mileage parsing.
- 17 tests passing.

### Current top

- Peugeot TePee 75.4 ASK
- Fiat Punto 72.6 INSPECT
- Hyundai i20 69.1 INSPECT

### Access playbook

- Added symptom classifier + strategy ladder.
- Added `access_attempts` and seeded `rule_cards` lessons.
- `npm run playbook -- --symptom cloudflare` now returns the known fix.
- Live attempts recorded: autoscout24/direct_http success, autouncle/jina_reader success.
- 23 tests passing.

### POC completion

- Interactive UI (`npm run ui`) with filters and inspect/watch/skip.
- Analysis layer: deterministic fallback + optional DeepSeek; Laya adapter installed.
- Email lead parser (`npm run email`).
- Eval harness: 54 real + 20 adversarial.
- Criteria profiles: versioned in SQLite; criteria vs view filters documented.
- Weighted priority table: boost-only, cap +25; UI editor.
- Threshold analysis: qualifying cards by score + confidence + maxCards.
- Verdict legend + disclaimer in UI/report; `docs/VERDICTS.md`.
- Smart fetch: newest-first, adaptive pages, target 50 new, known-detail skip, coverage ledger, learned page budget.
- Fetch now button: saved criteria, live progress, single-flight; the test count is whatever `npm test` reports.
- POC feature-complete as a local prototype; mobile.de detail, live Laya weights, DeepSeek key, and human labels remain.

### Next

- mobile.de email → detail fetch.
- Human labels / precision@10.
- Auto-fallback executor.
