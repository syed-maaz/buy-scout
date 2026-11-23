# buy-scout: Category Contracts and Exploratory Source Adapters

* **Author:** Syed Muhammad Maaz Bin Muzaffar
* **Status:** Draft
* **Date:** 2026-11-12

--------------------------------------------------------------------------------

## Document Map

This document is the design record for the category-contract and exploratory-adapter work. Read it in this order:

1. [Overview](#overview) and [The Problem](#the-problem) — why the car POC cannot become a general buying engine as it stands.
2. [Goals](#goals) and [Non-Goals](#non-goals) — what this design will and will not change.
3. [Open Questions](#open-questions) — decisions still owned by the project owner.
4. [Critical User Journeys](#critical-user-journeys) — the source proofs A, B1 and B2, plus contract review.
5. [Technical Plan](#technical-plan) — components, data flow, schema and safety boundaries.
6. [Alternatives Considered](#alternatives-considered) — rejected options and why.
7. [Detailed Implementation Plan](#detailed-implementation-plan) — every file to create or modify.

## At a Glance

| Item | Decision |
|---|---|
| First proof | Exploratory engine, not a second category |
| Calibration A | Reproduce the existing AutoScout24 car adapter from stored pages |
| B1 | Autohero, a primary retailer with its own stock |
| B2 | 12gebrauchtwagen, an aggregator requiring duplicate reconciliation |
| Listing storage | Additive `category` and `attrs_json` columns; no table rebuild |
| Adapter identity | `(source, category, offer_mode)` |
| Contract storage | Versioned file, SQLite snapshot plus hash, local vector index |
| Generated artifact | Declarative extraction specification; no generated executable code in version 1 |
| MCP adapter | Optional; default scope is read-only; contact is redacted by default; draft, contact, write and send are opt-in |
| Safety default | Captured pages first, no credentials in the spec generator |
| Car parity | Same stored listings and criteria must produce the same shortlist |

## Terms Used

- **Category contract** — the reviewable definition of what is being bought and how it is compared.
- **Buy brief** — the user's request: category, offer mode, region, sources, hard constraints and priorities.
- **Source adapter** — the code or declarative spec that knows how to fetch and map one source.
- **Declarative spec** — a JSON extraction recipe interpreted by one engine; it cannot execute arbitrary code.
- **Capability** — whether a `(source, category, offer_mode)` tuple has a tested adapter.
- **Quarantine** — the directory where generated candidates live before promotion.
- **Promotion** — the evidence-gated move from candidate to trusted adapter.
- **Promotion scorecard** — the stored evidence used to accept or reject a candidate.
- **Coverage** — the share of required fields successfully extracted from a fixture.
- **Host serialization** — one request at a time to a single host while other hosts may run.
- **Vector index** — a local similarity index over contract text; advisory only.
- **Offer mode** — the commercial form: cash purchase, lease or auction.
- **MCP** — the Model Context Protocol; an optional adapter that exposes selected core operations as tools to a harness.
- **Scope** — the permission set visible to one MCP client; `read`, `draft`, `contact`, `write` and `send` are separate.
- **Contact mode** — whether listing reads expose seller email/phone: `redact` (default), `on_request` or `include`.


## Overview

buy-scout is a local-first buying tool. The current version searches car marketplaces, normalises the listings, applies deterministic family-car rules, and shows a shortlist. It works for cars, but its brief, listing model, database columns, adapter interface and UI filters are all car-shaped.

This design turns the car implementation into the reference pack for a category-agnostic engine. A user states what they want, where they want it, which sources they trust, and what they prioritise. An AI drafts a category contract containing the fields, units, hard filters, scoring priorities and missing-data behaviour. The user reviews that contract. A deterministic capability check then reports which sources can serve the category. Tested adapters perform extraction; sources without one enter an exploratory phase that produces a candidate extraction specification, which must pass fixture replay, field-coverage, integrity and clean-run checks before promotion.

The first proof is not a second category. It is the exploratory engine itself, measured against the existing car domain and two new sources:

- **A — calibration:** reproduce an existing car adapter from stored AutoScout24 pages.
- **B1 — primary source:** add Autohero, a retailer with its own used-car stock.
- **B2 — aggregator:** add 12gebrauchtwagen, which aggregates AutoScout24, mobile.de, heycar, Kleinanzeigen and others, and must reconcile duplicate listings against primary sources.

mobile.de is deferred because it is blocked by anti-bot access; testing it first would measure access failure rather than extraction.

The design remains local. The UI stays bound to `127.0.0.1`. There is no hosted account system, no payment, and no automatic purchase. API keys and per-source configuration stay on the user’s machine and are never committed.

## The Problem

The current car POC cannot answer a basic product question: “Can this engine buy something other than a car without rebuilding the engine?” The answer today is no. `SearchBrief` requires `category: "car"`. `NormalisedListing` and the `listings` table contain car columns. `SourceAdapter.search()` takes a car brief. The evaluator is `evaluateCar`. The UI filters on mileage, year, gearbox and body type.

A second category is therefore not a configuration change. It is a schema, adapter-contract and UI change. If the project builds an AI explorer on top of that foundation, the explorer will generate adapters for a car-shaped core.

The source side has a separate problem. Each marketplace exposes a different access path: API, saved-search email, HTML, JavaScript-rendered page, or a block page. Today that knowledge lives in hand-written adapters, with raw captures and fixture tests. When a user asks for an unsupported site, there is no safe, repeatable way to add it. Letting an LLM write and run code directly on the user’s machine would turn untrusted listing text into a code-execution path.

The proposed solution separates the two problems:

1. **Category contracts** describe what is being bought and how it is compared.
2. **Source adapters** describe how one site is fetched and mapped into that contract.
3. **The exploratory phase** generates and tests candidate adapters for sources that lack one.
4. **Promotion** is evidence-based; a candidate is not trusted because it ran once.

The first implementation proves this loop on cars, where the correct extraction and verdicts are already known. It then tests the loop on one primary retailer and one aggregator, each with separate success evidence.

## Goals

* **G1 — Preserve the car POC.** Adding the category contract and the exploratory path must not change the current car shortlist for the same stored data and criteria.
* **G2 — Make the category contract a reviewable artifact.** A contract is a versioned file or equivalent text artifact containing fields, units, hard filters, scoring priorities, missing-data rules and required fields. It can be diffed and approved before a run.
* **G3 — Give the core a generic listing shape.** A new category must store its own attributes without rebuilding the `listings` table. The car columns remain for the reference pack; category-specific values live beside them.
* **G4 — Report source capability deterministically.** For a `(source, category, offer_mode)` tuple, the engine reports: adapter present, adapter missing, source blocked, or unsupported offer type, with a reason.
* **G5 — Prove calibration A.** The explorer reproduces an existing AutoScout24 car adapter from stored pages and matches its required fields and verdict-relevant values.
* **G6 — Prove B1.** Autohero is fetched as a primary retailer source and produces a scored, normalized car shortlist.
* **G7 — Prove B2.** 12gebrauchtwagen is fetched as an aggregator; its listings are either new or recognized as duplicates of an existing primary listing.
* **G8 — Make every exploratory run replayable.** Record the source, URLs, captured pages, candidate artifact hash, field coverage, token/page cost and outcome. A failed attempt must be diagnosable without repeating the run.
* **G9 — Gate promotion.** A candidate adapter is promoted only after fixture replay, required-field coverage, integrity checks and a defined number of clean runs.
* **G10 — Keep execution local and bounded.** Exploration has explicit page, attempt, time and model-spend budgets. Adapters are serialized per host; cross-host work may run in parallel only when the machine supports it.
* **G11 — Make MCP optional and read-only by default.** The core and CLI must run without MCP. When MCP is enabled, only read tools are visible unless the user grants a separate draft, write or send scope.

## Non-Goals

* A hosted service, user accounts, billing or multi-user operation.
* Automatic purchase, payment, bidding or marketplace account management.
* CAPTCHA solving, stealth patches, credential replay or bypassing access controls.
* Arbitrary user-invented categories in the first implementation. The first reference pack is car; the second category is chosen later.
* Direct mobile.de integration in this design.
* Leasing, subscription and auction offers in the same ranked shortlist as cash purchase listings.
* LLM extraction of listing fields at read time. Parsers and declarative specs own extraction.
* A public adapter registry or automatic sharing in version 1.
* Treating a generated adapter as trusted because it produced non-empty output.
* Replacing the existing SQLite store with a document or vector database as part of this design. Category attributes are added to the existing store first.

## Open Questions

*   **Second category:** Which non-car category is the first fair test? It should not share the car fields, and it should be reachable through a classifieds-style source rather than a single retailer API.
*   **Budget defaults:** What are the default page, token, wall-clock and euro limits for an exploration run? The design requires the fields; it does not set the numbers.
*   **Promotion approver:** Who signs off when the user cannot read the spec? The proposed evidence is a scorecard plus fixture diff, but that process has not been tested.
*   **Vector index:** Which embedding method and similarity threshold should the local index use? Version 1 can use a local table with cosine ranking; the replacement point is the `CategoryIndex` interface.
*   **Duplicate identity:** What match rules should B2 use for the same car across an aggregator and a primary source? The current make/model/year/mileage/price bands are a starting point, not a verified standard.
*   **Authentication:** If an authenticated source is added later, which broker or session model is acceptable? Version 1 ships none.
*   **Car POC lifecycle:** Does the car database become read-only after purchase, or continue as the regression pack?

## Critical User Journeys

### CUJ 1: Calibration A

*   **Given**: Stored AutoScout24 car pages, the approved car contract, and the existing car adapter.
*   **When**: The user runs the explorer for `autoscout24 / car / purchase`.
*   **Then**: A declarative candidate is generated, replayed against the stored pages, and compared with the existing adapter. Required fields and verdict-relevant values match; the candidate is not promoted if coverage is below threshold.

### CUJ 2: B1 primary retailer

*   **Given**: A car brief, the approved car contract, and no Autohero adapter.
*   **When**: The user runs exploration for `autohero / car / purchase`.
*   **Then**: The engine reports the source as missing, captures sample pages, generates a spec, validates it, and produces a candidate scorecard. A promoted spec produces a normalized car listing and a scored shortlist.

### CUJ 3: B2 aggregator and duplicate reconciliation

*   **Given**: An Autohero or AutoScout24 listing already exists, and 12gebrauchtwagen returns the same car through a partner link.
*   **When**: The user runs exploration and fetch for `12gebrauchtwagen / car / purchase`.
*   **Then**: The aggregator listing is extracted, matched against the existing primary listing, and reported as a duplicate group rather than a new inventory row. If the match cannot be established, the listing is marked `ask`, not silently merged.

### CUJ 4: Contract review before fetch

*   **Given**: A user describes a need in plain language and chooses a category, region, sources and priorities.
*   **When**: The AI drafts a contract and the user opens the review screen.
*   **Then**: The user can inspect fields, units, hard filters, weights, required fields and missing-data behavior. No source fetch starts until the contract is approved and a capability report is shown.

## Technical Plan

### Architecture at a glance

The design keeps the existing local modular monolith. It replaces car-only types at the boundaries with category-neutral contracts and keeps the car evaluator as one implementation of a category evaluator.

```text
User brief (category, region, sources, priorities, offer mode)
        |
        v
AI contract proposal  --->  categories/<id>.json  --->  SQLite snapshot + hash
        |                                               |
        |                                               +--> local vector index
        v
Contract review / approval
        |
        v
Capability registry  --->  (source, category, offer_mode) status + reason
        |                         |
        |                         +--> adapter exists: run it
        |                         +--> adapter missing: exploratory job
        |
        v
Fetch / API / browser capture  --->  raw pages + attempt record
        |
        v
Declarative extraction spec  --->  validator / fixture replay / coverage
        |                                      |
        |                                      +--> candidate rejected
        |                                      +--> candidate promoted
        v
Normalised listing: category + common fields + attrs
        |
        v
Category evaluator  --->  shortlist, verdict, reasons
```

### Core boundaries

**1. `CategoryContract`** is a versioned file. It defines:

- category id and display name;
- offer mode (`purchase`, `lease`, `auction`);
- field definitions: name, type, unit, required/optional, allowed values;
- hard filters and their comparison operators;
- scoring priorities and weights;
- missing-data behaviour: reject, ask, or ignore;
- required-field coverage threshold;
- source-specific integrity assertions that the adapter must satisfy.

The contract is stored at `categories/<category>.json`. On approval, the engine writes a snapshot to SQLite with `contract_hash`, `version`, `path` and `approved_at`. The local vector index stores an embedding of the contract for semantic category matching. The hash, not the vector, is the identity of the contract used by a run.

**2. `BuyBrief`** replaces `SearchBrief` at the entry boundary. It contains `category_id`, `offer_mode`, location, source allowlist, hard constraints, priorities and analysis settings. The existing `SearchBrief` remains as the car-specific input adapter, so the current car CLI and UI can keep their current shape during migration.

**3. `NormalisedListing`** keeps the current common fields and gains:

- `category: string`;
- `attrs: Record<string, ScalarValue>`;
- `offerMode: "purchase" | "lease" | "auction"`.

The car fields stay for the car pack. A non-car listing leaves them null and uses `attrs` for its own fields. The database mirrors this with additive `listings.category` and `listings.attrs_json` columns; the car columns remain untouched.

**4. `SourceAdapter` identity** is `(source, category, offer_mode)`. An adapter declares those three values. It implements:

- `search(brief, opts)`;
- `parse(rawPage)` or a declarative spec interpreted by `SpecAdapter`;
- optional `fetchDetail` and `checkAvailability`.

The registry records a capability row per tuple. “Autohero supports car purchase” and “Autohero supports car lease” are different rows, even if they share a fetcher.

**5. `DeclarativeSpec`** is the only generated artifact in version 1. It is JSON with:

- `spec_version`, `source`, `category`, `offer_mode`;
- access method and URL template;
- pagination rules;
- field mappings: selector, attribute, transform, unit;
- required fields and integrity assertions;
- fixture references.

A single interpreter executes specs. The interpreter cannot run arbitrary code, open sockets, read files, or evaluate expressions outside its declared transform set. Specs are validated against captured fixtures before promotion. Generated executable adapters are out of scope for this design.

**6. `CategoryEvaluator`** is an interface. The car evaluator wraps the existing `evaluateCar`; a generic evaluator applies contract hard filters and scoring rules. Verdicts remain `inspect`, `ask`, `watch`, `reject`. The evaluator never fetches and never calls an LLM.

**7. `McpAdapter`** is optional. It imports the core service and exposes selected operations as MCP tools. It contains no search, scoring, exploration or messaging logic. Its default scope is `read`; `draft`, `contact`, `write` and `send` are separate scopes. The tool list is filtered by scope before registration, so a read client never sees a write tool. Contact mode is configured separately: `redact` is the default, `on_request` requires the `contact` scope, and `include` is an explicit trusted-client setting.

### Data flow

1. The user submits a `BuyBrief`.
2. The AI proposes a category contract from the brief. The user reviews the fields, units, filters and weights.
3. On approval, the contract file is written, hashed and imported into SQLite. The vector index is updated from the same file.
4. The capability registry is queried for each `(source, category, offer_mode)`.
5. For supported tuples, the adapter fetches pages and the interpreter or hand-written parser emits normalized listings.
6. For missing adapters, an exploratory job captures sample pages, generates a declarative candidate, and validates it against fixtures and coverage rules.
7. A promoted candidate becomes an adapter entry. A rejected candidate remains in a quarantine directory with its attempt record.
8. The category evaluator scores listings and the shortlist is rendered by the existing local UI.

### Storage changes

Additive only, with `PRAGMA user_version = 5`:

- `listings`: add `category TEXT NOT NULL DEFAULT 'car'` and `attrs_json TEXT`.
- `category_contracts`: `id`, `version`, `path`, `contract_json`, `contract_hash`, `vector_model`, `approved_at`. The JSON snapshot keeps the run reproducible if the file changes later.
- `category_vectors`: `category_id`, `model`, `vector_json`, `contract_hash`, `updated_at`.
- `source_capabilities`: `source`, `category`, `offer_mode`, `adapter_id`, `status`, `reason`, `updated_at`; primary key on the first three columns.
- `exploration_runs`: `id`, `source`, `category`, `offer_mode`, `status`, `started_at`, `finished_at`, `pages`, `tokens`, `spend_eur`, `artifact_hash`, `reason`.
- `adapter_candidates`: `id`, `exploration_run_id`, `source`, `category`, `offer_mode`, `spec_path`, `spec_hash`, `coverage`, `fixture_status`, `integrity_status`, `runs_clean`, `status`, `created_at`.
- `adapter_promotions`: `candidate_id`, `approved_by`, `approved_at`, `adapter_path`, `spec_hash`.

No table is rebuilt. Existing car rows get `category = 'car'` and `attrs_json = '{}'`. Existing indexes remain valid.

### Components and files

The Technical Plan introduces these logical components; the Detailed Implementation Plan will name every file.

- **Category package** — contract schema, import/validation, file writing, hash, vector indexing.
- **Brief adapter** — maps the current car `SearchBrief` to `BuyBrief`; preserves car CLI behavior.
- **Listing projection** — maps common columns plus `attrs_json` into `NormalisedListing`.
- **Capability registry** — CRUD for `(source, category, offer_mode)` rows and a deterministic `capabilities()` read.
- **Spec interpreter** — executes declarative mappings against captured HTML/JSON; no arbitrary code.
- **Spec adapter** — presents a validated spec through the normal `SourceAdapter` interface.
- **Spec validator** — fixture replay, required-field coverage, integrity assertions and duplicate detection.
- **Exploration job** — capture pages, generate a spec, validate, record attempts, enforce budgets.
- **Budget guard** — page, request, token, wall-clock and spend ceilings with typed stop reasons.
- **Promotion gate** — candidate scorecard; promotion writes a versioned adapter entry.
- **Category evaluator** — car wrapper plus generic evaluator.
- **Dedupe/identity** — cross-source duplicate detection used by B2; existing `dedupeListings` becomes a read-path and reconciliation input, not a log line.
- **UI/API** — category selection, contract review, capability display, exploration job status, and car-only filters hidden for non-car categories.
- **MCP adapter** — optional stdio server over the same core; default `read` scope; no business logic.

### API and CLI surface

Planned additions:

- `GET /api/categories`
- `GET /api/categories/:id`
- `POST /api/categories/:id/approve`
- `GET /api/capabilities?category=<id>&offerMode=<mode>`
- `POST /api/explore` → 202 job
- `GET /api/explore/status`
- `POST /api/fetch` accepts `category` and `offerMode`
- CLI `npm run explore -- --source <id> --category <id> --offer-mode purchase`
- CLI `npm run capabilities -- --category <id> --offer-mode purchase`

Planned MCP tools, filtered by scope:

| Scope | Tools |
|---|---|
| `read` (default) | `search_listings`, `get_listing`, `compare_listings`, `get_price_history`, `get_capabilities`, `get_contract`, `get_health` |
| `draft` | `propose_contract`, `draft_seller_message` |
| `contact` | `get_seller_contact` |
| `write` | `approve_contract`, `start_exploration`, `promote_candidate` |
| `send` | `send_seller_message` |

`MCP_SCOPES=read` is the default. A client must be granted `draft`, `contact`, `write` or `send` explicitly; `send` is never bundled with `write`. The server registers only the tools in the active scopes. `MCP_CONTACT_MODE` defaults to `redact`; `on_request` exposes one contact lookup through the `contact` scope, and `include` is only for a trusted local client.

The existing car endpoints remain valid with default `category=car` and `offerMode=purchase`.

### Isolation and safety

- Version 1 generates declarative specs, not executable code. The interpreter has a closed set of transforms.
- MCP defaults to read-only. Write and send tools are hidden until a client/session is granted those scopes. A send call needs a one-time confirmation for that listing and that exact message.
- Seller contact is redacted by default. `on_request` requires the `contact` scope and records the lookup; `include` is an explicit trusted-client setting, not a global default. The harness owns delivery in version 1, so a send outside MCP is outside the MCP audit boundary.
- Generated specs are written to a quarantine directory, never directly to the promoted adapter directory.
- The explorer runs against captured pages first. Live capture is a separate step with a page and request budget.
- The LLM receives page text and the contract, not credentials. Credentials remain outside the spec generator.
- Authentication is not part of version 1. If an authenticated source is added, a broker performs the request outside the spec interpreter.
- Promotion requires a stored scorecard, not a chat approval.

### Migration and rollback

- Migration is additive and runs once under `PRAGMA user_version = 5` and `BEGIN IMMEDIATE`.
- Before migration, the engine writes a database backup and records its path.
- Rollback is “open the previous database copy”; no down migration is promised.
- Car output must be identical before and after migration for the same stored data and criteria. This is the primary regression gate.

### Budgets and observability

Every exploration run records pages, tokens, model spend, wall-clock time, attempts and artifact hash. Defaults are configuration values, not hard-coded constants. A run stops when any budget is exhausted and records which budget stopped it.

`npm run health` reports capability coverage per `(source, category, offer_mode)`, candidates awaiting review, rejected candidates and stale promoted adapters. A promoted adapter that fails validation twice is marked degraded, not silently used.

### Verification strategy

- Car parity: same database copy, same criteria, identical shortlist before and after migration.
- A calibration: fixture replay against a known AutoScout24 car page; field-level comparison with the existing adapter.
- B1: Autohero capture produces required fields and a scored shortlist.
- B2: 12gebrauchtwagen capture produces listings and duplicate groups against existing primary listings.
- Spec validation: a bad selector fails coverage; a missing required field fails promotion.
- Migration: old database opens, all car rows read, new columns default correctly.
- Budgets: an exploration run stops at the declared page/token/spend limit.

## Alternatives Considered

### Alternative A: Hand-write the second category before building the explorer

*   **Pros**: Cheapest experiment, produces a concrete count of core files touched, and gives a real second-category result before investing in generation.
*   **Cons**: Does not test the explorer, which is the chosen first milestone. It delays the learning the user wants from the exploratory loop.
*   **Reason for Rejection**: The owner chose explorer-first. The core-file count remains a later gate before a second category is added; it is not the first proof.

### Alternative B: Ask an LLM to extract fields from every page at fetch time

*   **Pros**: No adapter generation, no selector maintenance, and easy to apply to a new page once a contract exists.
*   **Cons**: Cost scales with every fetch instead of every adapter; output varies between runs; the project’s rule that parsers own extraction is lost; a page change is invisible until the next paid run.
*   **Reason for Rejection**: Rejected as the production path. It may remain a one-off diagnostic probe to decide whether a page is parseable and which fields exist.

### Alternative C: Adopt an existing scraper framework

*   **Pros**: Mature pagination, retries, concurrency and extraction primitives; less custom plumbing.
*   **Cons**: Adds a second runtime and language to a TypeScript modular monolith; the project’s fixture store, integrity checks, SQLite loop and local UI are not provided by the framework.
*   **Reason for Rejection**: The useful idea is the fixture-and-cassette pattern, not the framework. The cost of a second runtime is higher than the code it replaces.

### Alternative D: Generate executable TypeScript adapters in a sandbox

*   **Pros**: Handles JavaScript-heavy pages, multi-step flows and site-specific quirks that a declarative spec cannot express.
*   **Cons**: Turns untrusted page text into executable code; Node has no in-process security boundary; a real sandbox means a separate process or container plus a threat model and maintenance burden.
*   **Reason for Rejection**: Version 1 generates declarative specs instead. Executable adapters are a later decision with their own ADR and isolation test.

### Alternative E: Separate database or table per category

*   **Pros**: Strong isolation; a broken category cannot corrupt another; each category can evolve its schema independently.
*   **Cons**: Duplicates migration, backup and health checks; prevents one cross-category shortlist; makes the common listing identity harder to enforce.
*   **Reason for Rejection**: The owner chose additive columns with JSON attributes. Separate storage is revisited only if category lifecycles diverge enough to justify it.

### Alternative F: Store the contract only in SQLite

*   **Pros**: One runtime source of truth; no file sync or hash mismatch; simpler write path.
*   **Cons**: Contracts cannot be opened in an editor or diffed in a pull request; review is reduced to a database row; rollback is less visible.
*   **Reason for Rejection**: The owner chose a versioned file as the source of truth, with a SQLite snapshot and hash for the run record.

### Alternative G: Use a hosted adapter registry

*   **Pros**: Easier discovery and distribution of community adapters; one place to publish updates.
*   **Cons**: Adds availability, abuse handling, review and hosting to a single-maintainer local-first project; a compromised registry can distribute executable parsers.
*   **Reason for Rejection**: Version 1 keeps adapters in the repository. Sharing is deferred until generated specs have produced adapters worth sharing.

### Alternative H: Treat any non-empty extraction as success

*   **Pros**: Minimal validation code; a source can be added quickly.
*   **Cons**: A parser that extracts only title and price passes and silently degrades the shortlist; field coverage, integrity and duplicate identity are invisible.
*   **Reason for Rejection**: Promotion requires fixture replay, required-field coverage, integrity checks and clean runs. Non-empty output is not evidence.

## Non-Functional Requirements

*   **Security and privacy:** The UI remains bound to `127.0.0.1`. No credentials are sent to the spec generator or embedded in generated specs. Declarative specs cannot execute code or open sockets. Raw captures and exploration artifacts stay in ignored local directories.
*   **Performance:** Exploration has page, request, token, wall-clock and spend budgets. Per-host requests are serialized; cross-host work may run concurrently. The car list path must not load `raw_json` or issue per-listing queries.
*   **Compatibility:** The database migration is additive. The car shortlist must be identical before and after the change for the same stored data and criteria. A database backup is taken before migration.
*   **Observability:** Every exploration run records source, category, offer mode, pages, tokens, spend, artifact hash, validation outcome and stop reason. A failed attempt remains diagnosable.
*   **MCP:** The server is optional. The CLI and UI must work with MCP disabled. Tool registration is scope-filtered; `read` is the default; `contact`, `draft`, `write` and `send` are client-specific grants, not global configuration. Contact mode defaults to `redact`. MCP outputs are compact envelopes; long contracts and run details are resources, not tool payloads.
*   **Model use:** Laya runs locally for triage. DeepSeek or another configured API is used only for contract drafting, deep research and spec generation when the user requests it. Field extraction is never an API call. Model calls are budgeted; no per-page model extraction.
*   **Rollout and rollback:** The new path is behind category/offer selection and an exploration flag. Rollback is restoring the pre-migration database copy; no down migration is promised.

## Additional Resources

*   [concepts_brief.md](../../concepts_brief.md) — predecessor brainstorm with source plan and objections.
*   [docs/ARCHITECTURE.md](../ARCHITECTURE.md) — current fetch, integrity and storage flow.
*   [docs/DATA-MODEL.md](../DATA-MODEL.md) — existing car schema and constraints.
*   [docs/SOURCES-OPERATIONS.md](../SOURCES-OPERATIONS.md) — source access and blocked-source policy.
*   [src/domain/cars/evaluate.ts](../../src/domain/cars/evaluate.ts) — car verdict reference implementation.
*   `src/exploration/spec-schema.ts` — planned declarative spec contract (not created yet).

## Future Improvements

*   Replace the local cosine index with an approximate nearest-neighbor index if the category count grows.
*   Add an isolated executable-adapter path only after a threat model and hostile fixture test.
*   Add an authenticated-source broker with per-source scoped tokens.
*   Add a public adapter registry after promotion has produced adapters worth sharing.
*   Add a guided UI wizard while preserving the one-command fast path.

## Detailed Implementation Plan

This plan is ordered so the car POC keeps working after every step. The migration is additive; no table rebuild is required.

### Phase 1: Category contract and generic brief

#### 1. `categories/car.json` (Create)

*   **Type / Scope**: Category contract data.
*   **Proposed Changes**: Encode the current car rules as a versioned contract: offer mode `purchase`, fields (`priceEur`, `mileageKm`, `firstRegistration`, `fuel`, `transmission`, `bodyType`, `seats`, `doors`, `hasIsofix`, `damaged`, `commercialOnly`, `distanceKm`), units, hard filters, priorities, required fields and missing-data behaviour. Values must mirror the active car profile, not introduce new rules.

#### 2. `src/categories/contract.ts` (Create)

*   **Type / Scope**: TypeScript module and Zod schema.
*   **Proposed Changes**: Define `CategoryContract`, `ContractField`, `HardFilter`, `ScoringRule` and `OfferMode`. Export `parseContract`, `contractHash` and `validateContract`. Reject duplicate field names, unknown units and a scoring weight sum outside the allowed range.

#### 3. `src/categories/repository.ts` (Create)

*   **Type / Scope**: Persistence adapter for contract files and SQLite snapshots.
*   **Proposed Changes**: Read a contract by category id; write a new version; import an approved contract into `category_contracts`; return the file path, version, hash and approval time. Refuse to import a file whose hash does not match the snapshot.

#### 4. `src/categories/vector-index.ts` (Create)

*   **Type / Scope**: Local category embedding index.
*   **Proposed Changes**: Define a `CategoryIndex` interface with `upsert(categoryId, text, contractHash)` and `search(query, limit)`. Version 1 implements a local embedding table and cosine ranking; the interface allows a later replacement without changing callers. The index is advisory: the contract hash, not the similarity score, authorizes a run.

#### 5. `src/categories/README.md` (Create)

*   **Type / Scope**: Package contract.
*   **Proposed Changes**: Document the category module boundary: contract schema, repository, vector index, capability lookup and the rule that contract hashes authorize runs while similarity is advisory.

#### 6. `src/core/buy-brief.ts` (Create)

*   **Type / Scope**: TypeScript module and Zod schema.
*   **Proposed Changes**: Define `BuyBrief`: `categoryId`, `offerMode`, location, source allowlist, hard constraints, priorities and analysis settings. Add conversion functions to and from the existing car `SearchBrief`.

#### 7. `src/core/brief.ts` (Modify)

*   **Type / Scope**: Existing car brief.
*   **Proposed Changes**: Keep `SearchBrief` and its schema for the car pack. Add `toBuyBrief` and `fromBuyBrief` helpers so the old CLI and UI can run through the new boundary without changing their stored format.

#### 8. `src/core/types.ts` (Modify)

*   **Type / Scope**: Shared types.
*   **Proposed Changes**: Add `category`, `attrs` and `offerMode` to `NormalisedListing`; add `BuyBrief`, `CategoryId`, `OfferMode` and `ListingAttrs`. Change `SourceAdapter` to declare `source`, `category` and `offerMode`, and accept `BuyBrief` in `search`. Keep optional detail and availability methods.

### Phase 2: Additive persistence

#### 9. `src/db/schema.sql` (Modify)

*   **Type / Scope**: SQLite DDL.
*   **Proposed Changes**: Add `category TEXT NOT NULL DEFAULT 'car'` and `attrs_json TEXT` to `listings`; add `category_id` and `offer_mode` to `criteria_profiles`; create `category_contracts`, `category_vectors`, `source_capabilities`, `exploration_runs`, `adapter_candidates` and `adapter_promotions`. Add indexes on `(category, offer_mode)`, capability status and candidate status. Do not alter existing car columns or rebuild tables.

#### 10. `src/db/index.ts` (Modify)

*   **Type / Scope**: SQLite boundary and migrations.
*   **Proposed Changes**: Bump `SCHEMA_VERSION` to 5. Add `ensureCategoryColumns`, `ensureBriefColumns` and `ensureCategoryTables`. Backfill existing rows with `category = 'car'`, `attrs_json = '{}'`, `category_id = 'car'` and `offer_mode = 'purchase'`. Update `upsertListing` and `mapListingRow` for the new fields. Add typed reads/writes for contracts, capabilities, exploration runs, candidates and promotions. Add `getActiveBuyBrief(db, category, offerMode)` without breaking `getActiveCriteria`.

#### 11. `src/db/index.ts` — criteria index change (Modify)

*   **Type / Scope**: Constraint migration.
*   **Proposed Changes**: Drop `idx_criteria_active` and create a partial unique index on `(category_id, offer_mode)` where `active = 1`. Existing car rows remain active under `car/purchase`. The migration must run in one immediate transaction and preserve every existing profile.

#### 12. `src/core/listing-projection.ts` (Create)

*   **Type / Scope**: Mapping layer.
*   **Proposed Changes**: Map a database row to `NormalisedListing`: copy common fields, parse `attrs_json`, default `category` to `car`, default `offerMode` to `purchase`, and reject malformed attributes instead of silently coercing them.

### Phase 3: Source adapters and capabilities

#### 13. `src/sources/autoscout24.ts` (Modify)

*   **Type / Scope**: Existing car adapter.
*   **Proposed Changes**: Declare `source = 'autoscout24'`, `category = 'car'`, `offerMode = 'purchase'`; convert `BuyBrief` to the car brief internally. Set `category`/`attrs` on every emitted listing. Preserve existing search, detail and availability behavior.

#### 14. `src/sources/kleinanzeigen.ts` (Modify)

*   **Type / Scope**: Existing car adapter.
*   **Proposed Changes**: Same identity and brief conversion as AutoScout24. Preserve the location, price, year, mileage and local filters. Add the new listing fields.

#### 15. `src/sources/autouncle.ts` (Modify)

*   **Type / Scope**: Existing disabled adapter.
*   **Proposed Changes**: Same identity conversion so the adapter still compiles and the capability registry can represent it; it remains disabled.

#### 16. `src/core/source-runner.ts` (Modify)

*   **Type / Scope**: Parallel fetch runner.
*   **Proposed Changes**: Filter by `enabled`, `category` and `offerMode` before starting. Preserve `Promise.allSettled`. Add a serial-per-host scheduling policy; cross-host work may run concurrently. Return capability/failure details per adapter.

#### 17. `src/categories/capabilities.ts` (Create)

*   **Type / Scope**: Capability registry.
*   **Proposed Changes**: Read `source_capabilities` for a `(source, category, offer_mode)` tuple. Return `supported`, `missing`, `blocked` or `unsupported-offer` with a reason. Seed rows only for tested adapters; never infer support from a source name.

#### 18. `src/cli/capabilities.ts` (Create)

*   **Type / Scope**: CLI entrypoint.
*   **Proposed Changes**: Print the capability table for one category and offer mode, or all categories. Exit 1 if the requested tuple has no supported source. Add `npm run capabilities`.

### Phase 4: Declarative exploration

#### 19. `src/exploration/spec-schema.ts` (Create)

*   **Type / Scope**: Declarative extraction contract.
*   **Proposed Changes**: Define the JSON spec schema: version, source, category, offer mode, access method, URL template, pagination, field selectors, attribute/transform names, units, required fields and integrity assertions. Reject unknown transforms and scripts.

#### 20. `src/exploration/README.md` (Create)

*   **Type / Scope**: Package contract.
*   **Proposed Changes**: Document the exploration boundary: capture, generation, validation, budget enforcement, quarantine and promotion. State that no generated executable code is allowed in version 1.

#### 21. `src/exploration/interpreter.ts` (Create)

*   **Type / Scope**: Spec execution engine.
*   **Proposed Changes**: Apply a validated spec to captured HTML or JSON. Support a closed set of operations: CSS selector, attribute read, text read, regex capture, trim, number parse, date parse and constant. Do not use `eval`, `Function`, shell access, filesystem access or arbitrary network calls.

#### 22. `src/exploration/spec-adapter.ts` (Create)

*   **Type / Scope**: `SourceAdapter` implementation.
*   **Proposed Changes**: Wrap a validated spec and the interpreter behind the normal `SourceAdapter` interface. Declare the `(source, category, offer_mode)` tuple, implement `search` over captured pages and expose parsed listings. The adapter does not fetch pages itself; the capture/job layer owns network access and budgets.

#### 23. `src/exploration/capture.ts` (Create)

*   **Type / Scope**: Page capture for unknown sources.
*   **Proposed Changes**: Capture search and detail pages through HTTP or Playwright. Enforce one host per job, a page cap, a request delay and a wall-clock limit. Store raw HTML and JSON under `data/exploration/<run>/...` and record hashes. Do not attach credentials in version 1.

#### 24. `src/exploration/generator.ts` (Create)

*   **Type / Scope**: AI-assisted spec generation.
*   **Proposed Changes**: Send the contract and captured page text to the configured model; require a spec matching `spec-schema`; reject free-form code. The prompt must omit credentials and must not instruct the model to execute anything. Failure returns a typed generation error, not a partial spec.

#### 25. `src/exploration/validator.ts` (Create)

*   **Type / Scope**: Spec validation and scorecard.
*   **Proposed Changes**: Replay fixtures, compare required-field coverage, check types/units, run source integrity assertions, and detect duplicate listings. Produce a scorecard with pass/fail per criterion. The validator never promotes.

#### 26. `src/exploration/promotion.ts` (Create)

*   **Type / Scope**: Promotion gate.
*   **Proposed Changes**: Require fixture replay, coverage at or above the contract threshold, integrity pass and two consecutive clean live runs. Write `adapter_candidates` and `adapter_promotions`; move an accepted spec from quarantine to `adapters/<source>/<category>/<offer>/spec.json`. A rejected spec stays quarantined with its scorecard.

#### 27. `src/exploration/jobs.ts` (Create)

*   **Type / Scope**: Exploration job lifecycle.
*   **Proposed Changes**: Create an `exploration_runs` row, capture pages, generate and validate a spec, enforce page/token/time/spend budgets, and finish with a reason. Expose status for the CLI and UI. A failed attempt is stored, not deleted.

#### 28. `src/exploration/budget.ts` (Create)

*   **Type / Scope**: Budget configuration and stop conditions.
*   **Proposed Changes**: Define page, request, token, wall-clock and model-spend budgets. Validate configured values, expose the active limits to capture/generation, and return a typed stop reason when a limit is reached. No budget is silently disabled.

#### 29. `src/cli/explore.ts` (Create)

*   **Type / Scope**: CLI entrypoint.
*   **Proposed Changes**: Run one exploration job for a source, category and offer mode. Require a budget preset; print the candidate path and scorecard. Add `npm run explore`.

#### 30. `src/cli/promote.ts` (Create)

*   **Type / Scope**: Promotion CLI.
*   **Proposed Changes**: Inspect a candidate scorecard and promote it only when the gate passes. Print the promoted path and hash. Add `npm run promote`.

#### 31. `adapters/README.md` (Create)

*   **Type / Scope**: Adapter directory contract.
*   **Proposed Changes**: Explain the `(source, category, offer_mode)` path convention, the quarantine directory and the promotion requirement. List no adapter as supported until it has a scorecard.

#### 32. `adapters/_candidates/.gitignore` (Create)

*   **Type / Scope**: Quarantine boundary.
*   **Proposed Changes**: Ignore generated candidates and raw exploration pages. Promoted specs are committed; candidates are not.

#### 33. `adapters/autohero/car/purchase/spec.json` (Create after B1 promotion)

*   **Type / Scope**: Promoted declarative adapter.
*   **Proposed Changes**: Store the validated Autohero extraction spec only after the B1 scorecard passes. The file is the runtime input for the Autohero capability row; it is not created during the initial scaffold.

#### 34. `adapters/12gebrauchtwagen/car/purchase/spec.json` (Create after B2 promotion)

*   **Type / Scope**: Promoted declarative adapter.
*   **Proposed Changes**: Store the validated 12gebrauchtwagen extraction spec only after the B2 scorecard passes, including duplicate-reconciliation expectations. A failed B2 leaves no promoted file.

### Phase 5: Car integration and B1/B2

#### 35. `src/cli/fetch.ts` (Modify)

*   **Type / Scope**: Fetch orchestration.
*   **Proposed Changes**: Accept `--category` and `--offer-mode`; default to `car/purchase`. Build a `BuyBrief`, query capabilities, and select adapters by tuple. Preserve the current car output and integrity rules. Record category/offer in `source_runs` and decisions.

#### 36. `src/cli/score.ts`, `src/cli/report.ts`, `src/cli/analyze.ts`, `src/cli/eval.ts` (Modify)

*   **Type / Scope**: Car-facing commands.
*   **Proposed Changes**: Resolve the active buy brief for the requested category/offer; use the category evaluator registry. The car path must call the existing `evaluateCar` unchanged. Non-car output is not required until the second category.

#### 37. `src/domain/categories/registry.ts` (Create)

*   **Type / Scope**: Evaluator registry.
*   **Proposed Changes**: Map category id to `CategoryEvaluator`; register the car evaluator under `car/purchase`. Fail explicitly for an unregistered category rather than falling through to car rules.

#### 38. `src/domain/categories/generic.ts` (Create)

*   **Type / Scope**: Contract-driven evaluator.
*   **Proposed Changes**: Apply contract hard filters, missing-data rules and weights to `attrs`. Return the same verdict shape as the car evaluator. No model calls.

#### 39. `src/domain/cars/evaluate.ts` (Modify)

*   **Type / Scope**: Existing car evaluator.
*   **Proposed Changes**: Keep the arithmetic and verdict logic. Export a thin `carEvaluator` wrapper that accepts `BuyBrief` and maps it to `SearchBrief`; do not rewrite the car rules.

#### 40. `src/cli/reparse.ts` (Modify)

*   **Type / Scope**: Raw-page replay.
*   **Proposed Changes**: Resolve category and offer mode from the stored source or spec; use the listing projection; preserve replay safety from the current implementation.

### Phase 6: UI and API

#### 41. `src/ui/server.ts` (Modify)

*   **Type / Scope**: Local HTTP API.
*   **Proposed Changes**: Add category/contract/capability/exploration routes. Existing listing/filter routes accept `category` and `offerMode`; car-only filters are hidden or rejected for non-car categories. Exploration runs use a background job like analysis; do not hold the HTTP request open.

#### 42. `src/ui/index.html` (Modify)

*   **Type / Scope**: Local UI.
*   **Proposed Changes**: Add a category selector and contract review panel. Show capability rows before fetching: supported, missing, blocked, unsupported offer. Keep the current car layout for `car/purchase`; do not render car filters for other categories.

#### 43. `src/ui/README.md` (Modify)

*   **Type / Scope**: UI contract.
*   **Proposed Changes**: Document the new routes, the category selector and the rule that car filters are not universal.

### Phase 6b: Optional MCP adapter

#### 44. `src/mcp/scopes.ts` (Create)

*   **Type / Scope**: Permission and tool-filtering module.
*   **Proposed Changes**: Define `read`, `draft`, `contact`, `write` and `send` scopes. Default to `read`. Parse an explicit client/session grant, reject unknown scopes, and return only the tools visible to that scope. `send` is never implied by `write`; contact mode defaults to redact.

#### 45. `src/mcp/tools.ts` (Create)

*   **Type / Scope**: Tool handlers.
*   **Proposed Changes**: Provide compact handlers that call the same core service as the CLI: search, listing, compare, history, capabilities, contract read, draft message, seller contact lookup, approve contract, start exploration, promote candidate and send message. No handler reimplements scoring, fetching or validation. Write handlers require a one-time confirmation token; the send handler also requires the `send` scope; contact lookup requires `contact` and a non-redacted mode.

#### 46. `src/mcp/server.ts` (Create)

*   **Type / Scope**: MCP adapter.
*   **Proposed Changes**: Start a local stdio MCP server, register only the tools in the active scope, and expose no network listener. The server is optional: if it is not started, the CLI and UI behave normally. Tool descriptions stay short and outputs stay compact.

#### 47. `src/mcp/README.md` (Create)

*   **Type / Scope**: Package contract.
*   **Proposed Changes**: Document the five scopes, the read-only default, contact redaction, the confirmation requirement for writes and sends, and the rule that MCP contains no business logic.

#### 48. `docs/MCP.md` (Create)

*   **Type / Scope**: Operator documentation.
*   **Proposed Changes**: Explain how to connect a harness, set `MCP_SCOPES=read`, grant `draft`/`write`/`send` per client, and confirm a write. Include the full tool list and the no-default-send rule.

### Phase 7: Tests, fixtures and docs

#### 49. `tests/fixtures/categories/car.json` (Create)

*   **Type / Scope**: Test fixture.
*   **Proposed Changes**: Copy of the approved car contract used by parity and schema tests.

#### 50. `tests/fixtures/autohero/car-purchase.html` (Create)

*   **Type / Scope**: Captured fixture.
*   **Proposed Changes**: One search page and one detail page for B1. Include price, title, mileage, registration, fuel, transmission and location. No live network in tests.

#### 51. `tests/fixtures/12gebrauchtwagen/car-purchase.html` (Create)

*   **Type / Scope**: Captured fixture.
*   **Proposed Changes**: One aggregator result page showing a partner listing and enough data to test duplicate reconciliation.

#### 52. `tests/category-contract.test.ts` (Create)

*   **Type / Scope**: Unit tests.
*   **Proposed Changes**: Schema validation, duplicate fields, unknown units, weight bounds, hash stability and file/SQLite mismatch rejection.

#### 53. `tests/buy-brief.test.ts` (Create)

*   **Type / Scope**: Unit tests.
*   **Proposed Changes**: Car brief round-trip; category/offer defaults; rejection of an unregistered category.

#### 54. `tests/migration-v5.test.ts` (Create)

*   **Type / Scope**: Migration tests.
*   **Proposed Changes**: Open a copy of the real car database; assert `category='car'`, `attrs_json='{}'`, existing criteria remain active, and all existing listings are readable. Run the migration twice.

#### 55. `tests/car-parity.test.ts` (Create)

*   **Type / Scope**: Regression test.
*   **Proposed Changes**: Score the same stored car listings before and after the change; assert identical verdicts, scores, reasons and shortlist order.

#### 56. `tests/spec-interpreter.test.ts` (Create)

*   **Type / Scope**: Unit tests.
*   **Proposed Changes**: Selectors, attributes, regex capture, number/date transforms, missing fields and rejection of unknown transform names.

#### 57. `tests/spec-validator.test.ts` (Create)

*   **Type / Scope**: Unit tests.
*   **Proposed Changes**: Required-field coverage, type mismatch, unit mismatch, integrity failure, duplicate detection and scorecard output.

#### 58. `tests/exploration-job.test.ts` (Create)

*   **Type / Scope**: Integration tests.
*   **Proposed Changes**: Fake capture and generator; assert budget stop, attempt record, candidate quarantine and failed-run persistence.

#### 59. `tests/exploration-budget.test.ts` (Create)

*   **Type / Scope**: Unit test.
*   **Proposed Changes**: Assert that each budget stops a run, records the reason and does not continue with partial work. Cover zero, negative and malformed limits.

#### 60. `tests/promotion.test.ts` (Create)

*   **Type / Scope**: Promotion tests.
*   **Proposed Changes**: Candidate is rejected on low coverage, integrity failure or fewer than two clean runs; promoted on all criteria. Assert the promoted path and hash.

#### 61. `tests/capabilities.test.ts` (Create)

*   **Type / Scope**: Registry tests.
*   **Proposed Changes**: Exact tuple matching; blocked source; missing adapter; unsupported offer mode; no source-name inference.

#### 62. `tests/autohero.test.ts` and `tests/12gebrauchtwagen.test.ts` (Create)

*   **Type / Scope**: Source fixture tests.
*   **Proposed Changes**: Parse B1 and B2 fixtures through the declarative interpreter; assert required fields, coverage and normalized output. B2 also asserts duplicate grouping against an existing primary listing.

#### 63. `tests/ui-category-api.test.ts` (Create)

*   **Type / Scope**: API tests.
*   **Proposed Changes**: Category list, contract read, capability read and exploration job status. Assert car filters are not applied to non-car categories.

#### 64. `tests/mcp-contact.test.ts` (Create)

*   **Type / Scope**: Unit test.
*   **Proposed Changes**: Assert redacted contact in default reads; `on_request` requires the `contact` scope; `include` requires an explicit trusted-client setting; contact lookup is recorded.

#### 65. `tests/mcp-read-default.test.ts` (Create)

*   **Type / Scope**: Unit test.
*   **Proposed Changes**: Assert that the default scope exposes only read tools; `propose_contract` and `draft_seller_message` require `draft`; writes require `write`; `send` is not visible under `write`; unknown scopes are rejected.

#### 66. `tests/mcp-parity.test.ts` (Create)

*   **Type / Scope**: Integration test.
*   **Proposed Changes**: Call the same core operation through the CLI service and the MCP handler for search, listing and capabilities; assert identical compact output. Assert the MCP adapter is not required for the CLI.

#### 67. `package.json` (Modify)

*   **Type / Scope**: Scripts and dependencies.
*   **Proposed Changes**: Add `capabilities`, `explore`, `promote` and `mcp` scripts. Add the MCP SDK as an optional dependency; the CLI and UI must run without it. The vector index uses the local table and cosine ranking.

#### 68. `docs/ARCHITECTURE.md`, `docs/DATA-MODEL.md`, `docs/UI.md`, `docs/OPERATIONS.md`, `docs/SOURCES-OPERATIONS.md` (Modify)

*   **Type / Scope**: Design and operations documentation.
*   **Proposed Changes**: Document category contracts, tuple identity, additive schema, exploration lifecycle, promotion gate, budgets, and the car-only filter boundary. Keep the current car behavior documented as the reference pack.

#### 69. `README.md` and `src/*/README.md` (Modify)

*   **Type / Scope**: Repository contracts.
*   **Proposed Changes**: Update the root blueprint and affected package contracts for the new modules and tuple identity. Do not claim a category is supported before its capability row is promoted.

### Verification Plan

*   **Compilation**: `npm run typecheck`.
*   **Unit tests**: `npm test`; all new tests above.
*   **Car parity**: `tests/car-parity.test.ts` against a copy of the current database.
*   **Migration**: `tests/migration-v5.test.ts` opens a copy of `data/buy-scout.db`; the real database is backed up before the first run.
*   **A calibration**: fixture replay produces the same required fields as the existing AutoScout24 adapter; a diff report is stored.
*   **B1**: Autohero fixture produces a valid car listing and a scored shortlist; no live network in CI.
*   **B2**: 12gebrauchtwagen fixture extracts a listing and identifies a duplicate against a primary source.
*   **Safety**: a spec containing an unknown transform or executable expression is rejected before validation.
*   **Budgets**: an exploration job stops at the configured page, token, time or spend limit and records the reason.
*   **Manual**: `npm run capabilities -- --category car --offer-mode purchase`; `npm run explore -- --source autohero --category car --offer-mode purchase`; `npm run ui`.
