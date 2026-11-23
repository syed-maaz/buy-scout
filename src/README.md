# buy-scout `src/` Subtree

## Overview

Source tree of the buy-scout buy-side search engine. The dependency direction is
one-way: `cli` and `ui` are entrypoints, they call `core`, `domain`, `sources`,
`intelligence`, `report` and `db`; `db` is the only module that issues SQL; `core` holds
the shared `NormalisedListing` / `SearchBrief` / `SourceAdapter` contract that every
other layer speaks.

Request path for a shortlist: adapters in `sources/` fetch marketplace HTML →
`core/integrity.ts` asserts the filters were honoured → `db/index.ts` upserts listings →
`domain/cars/evaluate.ts` assigns a verdict and score → `intelligence/` annotates or
drafts prose → `report/` or `ui/` renders it. Access failures short-circuit into
`acquisition/playbook.ts` for a diagnosis instead of a silent empty result.

`src/memory/` exists but is empty; it contains no source files and therefore no contract.

## Subdirectories & Boundaries

- Acquisition: [`./acquisition/README.md`](./acquisition/README.md) — access-failure
  symptom classification and the strategy playbook (pure lookup, no fetching).
- CLI: [`./cli/README.md`](./cli/README.md) — thirteen npm-script entrypoints that
  orchestrate fetch, score, report, eval, intake, reparse, availability, email, labels and
  Laya classification.
- Core: [`./core/README.md`](./core/README.md) — the shared type contract, brief schema
  and defaults, German parsers, distance tolerance, filter integrity, dedupe, health,
  manual listings, availability sweep and the concurrent source runner.
- DB: [`./db/README.md`](./db/README.md) — the sole SQLite boundary: schema DDL, additive
  migrations, seeds and every typed read/write.
- Domain: [`./domain/README.md`](./domain/README.md) — preference boosting plus the
  `cars/` verdict engine ([`./domain/cars/README.md`](./domain/cars/README.md)).
- Ingest: [`./ingest/README.md`](./ingest/README.md) — extracts listing leads from
  notification emails.
- Intelligence: [`./intelligence/README.md`](./intelligence/README.md) — candidate
  selection, LLM analysis with deterministic fallback, variant research, seller messages,
  Laya triage and preference learning.
- Report: [`./report/README.md`](./report/README.md) — static HTML shortlist renderer.
- Sources: [`./sources/README.md`](./sources/README.md) — AutoScout24, Kleinanzeigen and
  AutoUncle adapters plus AutoScout24 detail enrichment.
- UI: [`./ui/README.md`](./ui/README.md) — loopback HTTP server and JSON API over the same
  database and rule engine.

## Global Invariants

- **Rules decide, language models annotate.** `evaluateCar` owns the verdict; DeepSeek and
  Laya may add prose and questions, never a different verdict.
- **`null` means unknown, never zero**, and unknown never hides or rejects a car; it
  produces verdict `ask` instead.
- **One distance tolerance** (`max(5, ceil(radius * 0.05))` km) is shared by source
  filtering, integrity checks and evaluation.
- **Listing identity is `(source, external_id)`**, and only `db` enforces it.
- **A source failure must never stop the pipeline**, and a source-confirmed delisting is
  the only thing that retires a listing.
- **Criteria changes invalidate derived analyses**, enforced transactionally in
  `saveCriteria`.

## Global Side Effects

- A single SQLite database (default `./data/buy-scout.db`) with WAL journaling and foreign
  keys enabled.
- The `./data/raw/**` tree of byte-exact search and detail captures, plus JSON/HTML/CSV
  artefacts written by the CLI.
- Outbound HTTPS to AutoScout24, Kleinanzeigen, AutoUncle via Jina Reader, the DeepSeek
  chat-completions API and the Firecrawl search API.
- A loopback HTTP listener on `127.0.0.1:8124` (override with `UI_PORT`) that can spawn
  the fetch pipeline as a child process.

## Verification

- Run: `npm test`
