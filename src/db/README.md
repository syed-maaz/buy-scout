# Persistence Layer

## Overview

The only module that talks to SQLite. `index.ts` opens a `node:sqlite` `DatabaseSync`
connection, applies `schema.sql`, performs idempotent column migrations, seeds reference
rows, and exposes typed read/write functions. Everything else in the repository receives
a `Db` handle and calls these functions; no other file issues SQL against the app
database.

`schema.sql` holds the idempotent table/index DDL (WAL journal mode,
`foreign_keys = ON`). It is applied once per database, under `PRAGMA user_version`
and a `BEGIN IMMEDIATE` transaction; read-only opens do not repeat DDL or seed writes.

## Interface

Connection and criteria:

- `Db` — alias of `DatabaseSync` (`index.ts:10`).
- `openDb(path = process.env.DB_PATH ?? "./data/buy-scout.db"): Db` (`index.ts:189`).
- `upsertReplayListing(db, listing, archivedAt)` — replay-safe write; preserves live
  price, `last_seen_at` and delisting state (`index.ts:372`).
- `staleListings(db, cutoff, limit?, sources?)` — SQL-selected availability candidates
  ordered by `COALESCE(availability_checked_at, last_seen_at)` (`index.ts:1164`).
- `latestListingsForList(db, limit?, { includeUnavailable })` — list projection without
  `raw_json`, with analysis/Laya/saved/research markers (`index.ts:1088`).
- `getActiveCriteria(db)` → `{ version, brief: SearchBrief }` (`index.ts:58`).
- `saveCriteria(db, brief, name = "Family profile")` → `{ version }` (`index.ts:71`).
- `listCriteriaVersions(db)` (`index.ts:96`).

Run/raw capture: `startRun` (`:203`), `finishRun` (`:213`), `insertRawPage` (`:247`),
`insertRawListing` (`:278`), `insertRawDetail` (`:395`), `recordAccessAttempt` (`:138`).

Listings: `upsertListing` (`:296`), `updateListingDetail` (`:368`), `touchListing`
(`:904`), `countListings` (`:899`), `listingDbId` (`:967`), `findListing` (`:1026`),
`latestListings` (`:1033`).

Availability: `markListingUnavailable` (`:917`), `markListingAvailable` (`:935`),
`recordAvailabilityCheck` (`:951`), `isListingUnavailable` (`:960`).

Decisions and outcomes: `upsertDecision` (`:420`), `ListingOutcome` (`:452`),
`OutcomeRecord` (`:460`), `recordListingOutcome` (`:471`), `getLatestOutcome` (`:501`).

User state: `recordUserAction` (`:523`), `clearUserAction` (`:533`),
`latestUserActions` (`:537`), `isListingSaved` (`:605`), `toggleSavedListing` (`:609`).

Derived content: `upsertListingAnalysis` (`:555`), `getListingAnalysis` (`:569`),
`upsertLayaClassification` (`:580`), `getLayaClassification` (`:594`),
`getSellerMessage` (`:626`), `upsertSellerMessage` (`:637`), `getListingResearch`
(`:652`), `upsertListingResearch` (`:663`).

History and fetch bookkeeping: `insertMemoryObservation` (`:678`),
`insertPriceObservation` (`:688`), `PricePoint` (`:698`), `PriceChange` (`:703`),
`getPriceHistory` (`:725`), `getPriceChange` (`:751`), `getFetchCoverage` (`:779`),
`upsertFetchCoverage` (`:805`), `getFetchStats` (`:847`), `upsertFetchStats` (`:867`).

Tables created by `schema.sql`: `fetch_coverage`, `fetch_stats`, `criteria_profiles`
(plus the partial unique index `idx_criteria_active`), `sources`, `source_runs`,
`raw_pages`, `raw_listings`, `listings`, `raw_details`, `price_observations`,
`access_attempts`, `user_actions`, `listing_analyses`, `saved_listings`,
`seller_messages`, `listing_research`, `laya_classifications`, `memory_observations`,
`brain_decisions`, `brain_outcomes`, `strategy_priors`, `rule_cards`
(`schema.sql:4`–`schema.sql:277`).

## Invariants

- **One active criteria version at a time.** `saveCriteria` runs
  `UPDATE criteria_profiles SET active = 0` then inserts the new active row inside a
  `BEGIN`/`COMMIT` with `ROLLBACK` on error (`index.ts:79`–`index.ts:93`); the partial
  unique index `idx_criteria_active` enforces it at the schema level (`schema.sql:37`).
- **Saving criteria invalidates analyses**: `DELETE FROM listing_analyses` is part of the
  same transaction, because stale analyses were produced against an older brief
  (`index.ts:87`).
- **`saveCriteria` re-validates through the Zod schema** by round-tripping the brief
  through `parseBriefJson(JSON.stringify(brief))` before persisting (`index.ts:76`).
- **`getActiveCriteria` self-heals**: when no active row exists it seeds and recurses
  rather than throwing (`index.ts:64`–`index.ts:67`).
- **Listing identity is `(source, external_id)`** — `UNIQUE` in `listings`
  (`schema.sql:134`); `upsertListing` conflates on that pair and deliberately omits the
  detail-only columns from the insert list (`index.ts:306`, `index.ts:298`).
- **A re-sighting clears the delisting**: both `upsertListing` and `touchListing` reset
  `delisted_at`/`delist_reason` to `NULL` (`index.ts:330`, `index.ts:908`).
- **`markListingUnavailable` is idempotent**: `delisted_at = COALESCE(delisted_at, ?)`
  keeps the first delisting time so the UI can show how long a car has been gone
  (`index.ts:925`).
- **Tri-state listing ids**: `listingDbId` returns `null` when the row is absent, never
  `0` or `-1` (`index.ts:967`).
- **Booleans are stored as `INTEGER` and mapped back through explicit `null` checks**, so
  `null` (unknown) never collapses into `false` (`index.ts:358`, `index.ts:380`–`index.ts:384`,
  `index.ts:1002`–`index.ts:1006`).
- **JSON columns are stringified on write and parsed on read**: `equipment_json`,
  `red_flags_json`, `analysis_json`, `laya_json`, `research_json`, `criteria_json`,
  `evidence_json`, `metadata_json` (`index.ts:387`, `index.ts:1009`).
- **`getPriceHistory` returns oldest → newest** by selecting newest-first then reversing;
  `limit` is truncated and `0` yields `[]` (`index.ts:731`, `index.ts:743`).
- **`getPriceChange` is safe with 0 or 1 observations**: `latest`/`previous`/`deltaEur`
  are `null` instead of throwing, and `observationCount` is a separate unbounded `COUNT(*)`
  (`index.ts:762`, `index.ts:772`, `index.ts:776`).
- **`upsertFetchCoverage` only grows the price ceiling**: `price_to = MAX(existing,
  excluded)` while `swept_to`/`peeked_to`/`mode` are overwritten (`index.ts:826`).
- **`latestListings` hides delisted cars by default**; `includeUnavailable` is the only
  way to see them, and ordering is `last_seen_at DESC, first_seen_at DESC`.
  `latestListingsForList` adds the list-page joins without `raw_json`; `staleListings`
  uses the availability schedule in SQL.
- **Outcome lookup is by real listing columns**: `brain_outcomes.source` /
  `external_id`, with an index. A missing decision returns `null` from
  `recordListingOutcome` instead of inventing one. The denormalised
  `brain_decisions.outcome` is derived from the newest outcome by `created_at`/`id`.
- **`user_actions.action` is constrained** to `('inspect','watch','skip')` by a `CHECK`
  in the schema (`schema.sql:177`) and validated again by the UI before insert.
- **Migrations are versioned and re-entrant**: `ensureListingColumns`,
  `ensureFetchCoverageColumns`, `ensureSellerMessageColumns` and
  `ensureOutcomeColumns` inspect `PRAGMA table_info`, add only missing columns, and run
  behind `PRAGMA user_version` inside one immediate transaction.
- **Seed writes are non-destructive**: `sources` upserts refresh only `label` and
  `updated_at`, so operator status/enabled changes survive restarts (`index.ts:23`–
  `index.ts:25`); `rule_cards` uses `INSERT OR IGNORE` (`index.ts:132`); criteria are
  seeded only when the table is empty (`index.ts:50`).
- **Foreign keys are enforced**: `price_observations.listing_id` and
  `brain_outcomes.decision_id` are declared `REFERENCES` while `PRAGMA foreign_keys = ON`
  is set in the schema header (`schema.sql:2`, `schema.sql:154`, `schema.sql:252`).

## Side Effects

- Creates the database file and any missing parent directories on `openDb`
  (`mkdirSync(dirname(absolute), { recursive: true })`, `index.ts:191`) and opens a
  writeable SQLite handle (`index.ts:192`).
- Reads `schema.sql` from disk relative to the module URL when a migration is needed.
- Executes DDL/DML once per schema version: column migrations, `seedSources`,
  `seedAccessLessons`, `seedCriteria`; sets `PRAGMA user_version`.
- Mutates persistent state: criteria versions and analysis deletion, listings, raw
  capture rows, price observations, user actions, saved flags, seller messages, research,
  Laya classifications, memory observations, decisions and outcomes.
- Reads `process.env.DB_PATH` as the default path (`index.ts:189`).
- Uses explicit transactions (`BEGIN`/`COMMIT`/`ROLLBACK`) in `saveCriteria` and
  `recordListingOutcome` (`index.ts:79`, `index.ts:486`).
- `upsertFetchStats` stamps its own `updated_at` from the wall clock rather than accepting
  one (`index.ts:895`).
- No network access.

## Verification

- Run: `npm test`
