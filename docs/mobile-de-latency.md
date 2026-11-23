---
title: "mobile.de & fetch latency"
description: "Why mobile.de search is blocked, the saved-search email path, and a latency budget for showing results to the client."
---

# mobile.de and fetch latency

## Status

| Path | State | Why |
|---|---|---|
| mobile.de search page | **Blocked** | 403 for direct HTTP, Playwright and Jina; Firecrawl returns 200 but silently ignores the filters (212k results) |
| mobile.de official API | **Blocked** | Partner-only; `401` without credentials |
| mobile.de saved-search email | **Not implemented** | Parser exists, ingestion into `listings` does not |
| mobile.de detail page | **Not implemented** | Firecrawl is the intended route; no parser yet |
| Kleinanzeigen | **Planned** | Saved-search email after 2026-11-03; no adapter |

There is **no mobile.de adapter** in `src/sources/`. The `sources` row is bookkeeping only.

## What “work on mobile.de” actually means

Do **not** build a search-page scraper. The supported path is:

```text
mobile.de saved search ("Suchauftrag")
  → email digest
  → extract listing URLs (already works: src/ingest/email.ts)
  → dedupe by mobile.de listing id
  → fetch each detail page through Firecrawl
  → normalise into the same listing shape as AutoScout24
  → evaluate / UI / memory
```

The search filters are applied **inside mobile.de** when the saved search is created. That is the only place where they are reliable.

## Latency budget

These are targets, not current measurements. The only live measurement today is AutoScout24.

| Stage | Target p50 | Target p95 | Notes |
|---|---:|---:|---|
| Email delivery | 2 min | 30 min | Platform-controlled; a daily digest is not real-time |
| Email parse / dedupe | 100 ms | 500 ms | Local; `npm run email` |
| Detail fetch (Firecrawl) | 1.5 s | 4 s | Per listing; concurrency 4 |
| Detail parse / normalise | 50 ms | 150 ms | Code, no LLM extraction |
| Score + persist | 20 ms | 80 ms | SQLite local |
| First listing visible | **< 5 s** after email ingest | < 10 s | Stream partial results |
| 20-lead batch | **10–20 s** | 40 s | Four detail workers |
| Full daily job, AS24 + mobile.de | 2–4 min | 6 min | AutoScout24 detail fetch dominates |

### Current AutoScout24 measurement

The 08:26 run started at `08:26:26` and the last insert was at `08:28:36` — about **130 seconds** for 5 search pages, 100 new listings and their detail fetches. Search pages are fast; **detail fetches dominate**. That is why the UI must show partial progress, not wait for the whole job.

## Client experience rules

1. **POST /api/fetch returns immediately** with a job id. The browser must never hold an HTTP request open for the whole crawl.
2. **Poll every 1.5 s** and re-render listings as rows land. The UI now does this while a fetch is running.
3. **Show per-source state**: `searching`, `details 34/100`, `done`, `blocked`. A blocked mobile.de must not look like a failed AutoScout24 run.
4. **First result, not last**: insert and score each listing as soon as it is normalised; do not batch all inserts until the end.
5. **Budget every network call**: search page 30 s, detail 20 s, Firecrawl 30 s. A timeout is a warning, not a fatal run.
6. **Concurrency 4** for detail fetches. Higher risks 429/403; lower makes the client wait.
7. **Cache details by listing id + content hash**. A re-opened card must not pay the network again.
8. **Show freshness**: `NEW` badge and `New only` filter; `last_seen_at` for stale cars.

## Work breakdown

| Priority | Item | Effort | Acceptance |
|---|---|---|---|
| P0 | IMAP/Gmail saved-search poll every 5 min → `data/email-leads.json` | S | New mobile.de URLs appear without manual export |
| P0 | Dedupe leads by mobile.de `id` | S | Re-running does not duplicate rows |
| P0 | Firecrawl detail fetch + parser | M | One real mobile.de detail becomes a `NormalisedListing` |
| P0 | Register `MobileDeEmailAdapter` only when leads exist | S | Health shows `working` or `no leads`, never a silent zero |
| P1 | Detail concurrency 4 + 30 s timeout | S | 20 leads under 40 s p95 |
| P1 | Per-source progress in `/api/fetch/status` | S | UI shows `mobile.de 7/20` |
| P1 | Coverage model for email leads | M | Do not reuse AutoScout24 price-band ledger |
| P2 | Kleinanzeigen email path | M | Same adapter shape; separate parser |
| P2 | Stale/sold detection | M | Source-confirmed 404/410/gone pages are retired; full email-lead coverage still needed |

## What not to do

- Do not scrape mobile.de search pages. Filters are ignored or blocked, and the result is an unbounded 212k-result list.
- Do not use Playwright headless against mobile.de from this environment; it is blocked.
- Do not let a blocked mobile.de make the daily run fail. Partial success is the contract.
- Do not add mobile.de to the AutoScout24 coverage ledger. Email leads are event-driven, not price-band sweeps.

## Instrumentation

Emit one JSON line per stage:

```json
{"source":"mobile_de","stage":"detail","listingId":"123","ms":1840,"status":"ok"}
{"source":"mobile_de","stage":"batch","leads":20,"ok":19,"failed":1,"ms":14300}
```

Then the UI can show a real p50/p95 instead of guessing. The same fields belong in `source_runs` and `access_attempts`.
