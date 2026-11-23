# CLI Entrypoints

## Overview

Thin executable scripts, each mapped to an npm script. Every file follows the same shape:
parse `--flag value` pairs from `process.argv`, open the database, read the active
criteria version, call one core/domain/intelligence function, print a human summary and
(usually) write a JSON or HTML artefact under `./data`. Business logic lives in the
libraries; these files orchestrate and report.

`fetch.ts` is the exception and the heaviest entrypoint: it runs all enabled adapters,
persists raw pages and listings, records access attempts and decisions, runs the
availability sweep and Laya triage, and sets the process exit code.

## Interface

npm script → file and primary exports:

| Script | File | Notable exports |
| --- | --- | --- |
| `fetch:as24` | `fetch.ts` | none (top-level `main()`) |
| `analyze` | `analyze.ts` | none |
| `score` | `score.ts` | none |
| `report` | `report.ts` | none |
| `health` | `health.ts` | none |
| `eval` | `eval.ts` | none |
| `intake` | `intake.ts` | none |
| `reparse` | `reparse.ts` | `REPARSE_SOURCES`, `ReparseSource`, `isReparseSource`, `listingsFromRawHtml`, `ReparseSummary`, `reparseSource` |
| `availability` | `availability.ts` | none |
| `email` | `email.ts` | none |
| `label` / `labels:export` / `labels:score` | `label.ts` | none |
| `playbook` | `playbook.ts` | none |
| `laya:classify` | `laya-classify.ts` | none |

- `reparse.ts`: `REPARSE_SOURCES = ["autoscout24","kleinanzeigen"] as const` (`:19`),
  `ReparseSource` (`:20`), `isReparseSource(value)` (`:22`),
  `listingsFromRawHtml(source, html)` (`:30`), `ReparseSummary` (`:41`),
  `reparseSource(db, source, limit)` (`:55`), `main()` (`:116`), `isDirectRun()` (`:149`).
- Flags used across the folder: `--db`, `--out`, `--limit`, `--top`, `--pages`,
  `--zip`, `--radius`, `--max`, `--delay`, `--raw`, `--source`, `--hours`, `--order`,
  `--min-score`, `--min-confidence`, `--max-cards`, `--min-pages`, `--target-new`,
  `--refresh-pages`, `--availability-limit`, `--availability-hours`, and the boolean
  flags `--full`, `--refresh`, `--no-details`, `--no-availability`, `--no-laya`,
  `--include-rejected`, `--score`.
- No subdirectories.

## Invariants

- **Every script resolves the DB through the same default**:
  `openDb(arg("db", process.env.DB_PATH ?? "./data/buy-scout.db"))`
  (`fetch.ts:128`, `analyze.ts:19`, `score.ts:10`, `report.ts:13`, `health.ts:10`,
  `eval.ts:13`, `intake.ts:12`, `availability.ts:13`, `label.ts:39`,
  `laya-classify.ts:15`, `reparse.ts:117`, `playbook.ts:15`).
- **Every script re-reads the active criteria version** rather than trusting module
  defaults, and prints it (`score.ts:21`, `eval.ts:14`, `report.ts:14`,
  `analyze.ts:76`, `fetch.ts:591`).
- **Exit codes are meaningful**: `health` and `laya-classify` set `process.exitCode = 1`
  on degraded/unavailable state (`health.ts:27`, `laya-classify.ts:13`); `fetch` returns
  0 only when at least one result has `integrity.ok` and a non-empty ref list, else 1;
  a filter-invalid source is marked `degraded` (`fetch.ts:271`–`fetch.ts:285`,
  `fetch.ts:598`–`fetch.ts:599`). `reparse` fails on an unsupported source, zero pages,
  or zero parsed listings.
- **`fetch` refuses to run with zero enabled adapters** and throws instead of reporting a
  silent empty success (`fetch.ts:181`–`fetch.ts:183`).
- **Fetch mode is derived, never guessed**: explicit `--full`/`--refresh` win. Otherwise
  `refresh` is used when a coverage row exists for the same query key; a cap change is a
  new query key, so `coveredMax` is 0 and the mode is `full`. There is no reachable
  `expand` branch while `purchaseMaxEur` is part of the key (`fetch.ts:137`–`fetch.ts:151`).
- **Adaptive page budget**: explicit `--pages` wins; refresh/expand use
  `max(6, refresh-pages)`; otherwise the learned average from `getFetchStats` selects
  10/8/6 pages (`fetch.ts:152`–`fetch.ts:159`).
- **Early-stop is page-based and dual**: stop at or after `minPages` (5) when
  `targetNew` (50) new refs were reached, or when a page is under 20 % new
  (`fetch.ts:207`–`fetch.ts:214`).
- **Invalid filter integrity means no persistence**: a source whose `integrity.ok` is
  false gets a `filter_invalid` run row, a warning, and `continue` before any listing is
  written (`fetch.ts:271`–`fetch.ts:286`).
- **Local price/distance gates run before every upsert**, with the shared
  `distanceToleranceKm`, and skipped rows are counted, not stored
  (`fetch.ts:343`–`fetch.ts:355`).
- **Detail fetch is conditional**: it runs only when the card is new or its price/mileage
  changed, or when an existing row still lacks `seats`/`doors`/`hasIsofix`
  (`fetch.ts:296`–`fetch.ts:305`).
- **Unchanged known listings are touched, not rewritten**, and still get a price
  observation (`fetch.ts:307`–`fetch.ts:317`).
- **Failed detail fetches degrade to the card** while preserving the previously known
  fields (`fetch.ts:324`–`fetch.ts:337`).
- **Every run is recorded twice on failure and success**: `startRun` then `finishRun` for
  results (`fetch.ts:226`, `fetch.ts:426`) and a `-failed` run id for failures
  (`fetch.ts:445`–`fetch.ts:457`), plus `recordAccessAttempt` and `sources.status`
  updates (`fetch.ts:229`, `fetch.ts:239`, `fetch.ts:458`, `fetch.ts:463`).
- **Byte-for-byte raw capture**: search HTML is written as
  `{rawDir}/{source}/{YYYY-MM-DD}/{runId}-p{page}.html` and detail HTML/JSON under
  `.../details/{externalId}.html|.json` before the DB rows are inserted
  (`fetch.ts:252`, `fetch.ts:103`–`fetch.ts:109`).
- **Fetch stats use exponential smoothing** `0.7 * previous + 0.3 * current` and only for
  `autoscout24` (`fetch.ts:396`–`fetch.ts:404`).
- **Coverage only advances on a successful integrity check**, and `sweptTo` only grows in
  `full`/`expand` mode (`fetch.ts:409`–`fetch.ts:423`).
- **Decisions are idempotent per listing per day**:
  `decisionId = sha256(source:externalId:YYYY-MM-DD)[0..32]`, and the evidence JSON
  embeds `criteriaVersion`, `criteriaOverridden`, the effective brief when CLI overrides
  changed it, `briefHash`, score, components, failures, unknowns and the listing snapshot
  (`fetch.ts:542`–`fetch.ts:569`).
- **`reparse` is the only CLI with a pure, directly exported core**: `listingsFromRawHtml`
  performs no DB or FS access, and `isDirectRun()` guards `main()` so importing the module
  in tests does not execute it (`reparse.ts:26`–`reparse.ts:39`, `reparse.ts:149`–`reparse.ts:155`).
- **`reparse` skips unreadable pages instead of aborting**, counting `skippedPages` and
  warning per page (`reparse.ts:99`–`reparse.ts:104`).
- **`reparse` is a replay, not a sighting**: it uses `upsertReplayListing`, preserves
  `last_seen_at`, `delisted_at` and the live price, skips confirmed-gone rows, and records
  a price observation only when the archived price differs. `ReparseSummary` includes
  `skippedDelisted` (`reparse.ts:60`–`reparse.ts:113`).
- **`label` deliberately withholds truth**: the exported CSV omits the engine verdict and
  score so human labels are independent (`label.ts:93`); `--score` counts only
  `inspect`/`good`/`yes` as positive for precision@10 (`label.ts:72`–`label.ts:75`).
- **`analyze` persists Laya but never lets it replace DeepSeek**: the stored model string
  is `"<model>+laya"` and the payload keeps both records (`analyze.ts:61`–`analyze.ts:66`).

## Side Effects

- Writes JSON/HTML/CSV artefacts: `./data/analysis.json` (`analyze.ts:75`),
  `./data/eval.json` (`eval.ts:76`), `./data/report.html` (`report.ts:47`),
  `./data/email-leads.json` (`email.ts:12`), `./data/labels.csv` (`label.ts:41`),
  and the whole `./data/raw/**` tree (`fetch.ts:163`, `fetch.ts:246`–`fetch.ts:253`).
- Creates directories recursively during fetch (`mkdirSync(..., { recursive: true })`,
  `fetch.ts:249`, `fetch.ts:104`).
- Opens and mutates the SQLite database: run rows, raw pages/listings/details, listings,
  price observations, fetch coverage/stats, decisions, memory observations, Laya
  classifications, seller messages (UI) and availability flags.
- Outbound network traffic via the adapters, DeepSeek, Firecrawl and Jina, invoked from
  `fetch.ts`, `availability.ts`, `analyze.ts` and `laya-classify.ts`.
- Console output on stdout/stderr is part of the contract (progress, integrity warnings,
  ranked shortlists, failure playbooks) and is what `src/ui/server.ts` captures.
- Reads environment: `DB_PATH`, `RAW_DIR`, `FETCH_*`, `AVAILABILITY_*`,
  `LLM_*` and `LAYA_*`.
- `email.ts` reads a directory of `.eml`/`.html`/`.txt` files and falls back to exit code
  1 when the directory is unreadable (`email.ts:16`–`email.ts:23`).

## Verification

- Run: `npm test`
