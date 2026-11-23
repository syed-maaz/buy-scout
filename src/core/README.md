# Core Contracts and Primitives

## Overview

The shared vocabulary of the system: the `NormalisedListing` / `SearchBrief` /
`SourceAdapter` type contract, the search brief schema and defaults, German-format
parsing, distance tolerance, filter-integrity assertions, conservative dedupe, health
reporting, manual listing construction and the availability sweep. Nothing here calls a
specific marketplace parser; `core` depends on `db`, `domain` and `acquisition`, and is
depended on by every other layer.

## Interface

Types and defaults:

- `types.ts`: `SourceId` (`:3`), `SellerType` (`:5`), `PreferenceField` (`:7`),
  `AnalysisSettings` (`:18`), `PreferenceRule` (`:29`), `SearchBrief` (`:40`),
  `RawRef` (`:77`), `RawPage` (`:85`), `RawDetail` (`:96`), `FilterIntegrity` (`:107`),
  `SourceSearchResult` (`:115`), `NormalisedListing` (`:124`), `SearchOptions` (`:174`),
  `AvailabilityStatus` (`:185`), `SourceAdapter` (`:187`), `SourceFailure` (`:199`),
  `ParallelFetchResult` (`:206`).
- `brief.ts`: `SearchBriefSchema` (Zod, `:4`), `defaultBrief()` (`:71`),
  `parseBriefJson(json)` (`:146`), `briefToJson(brief)` (`:150`).
- `distance.ts`: `distanceToleranceKm(radiusKm)` (`:5`),
  `withinDistanceLimit(distanceKm, radiusKm)` (`:9`).
- `parse.ts`: `sha256(value)` (`:3`), `parseGermanInt(value)` (`:8`),
  `parseFirstRegistration(value)` (`:18`), `parsePower(value)` (`:29`),
  `parseDistance(value)` (`:39`), `absoluteUrl(base, path)` (`:47`).
- `integrity.ts`: `checkFilterIntegrity(brief, refs, totalResults)` (`:9`).
- `dedupe.ts`: `DuplicateGroup` (`:3`), `DedupeResult` (`:10`),
  `dedupeListings(listings)` (`:35`).
- `health.ts`: `SourceHealth` (`:3`), `HealthReport` (`:12`),
  `checkHealth(db, now = Date.now())` (`:38`).
- `manual.ts`: `ManualListingInput` (`:5`), `buildManualListing(input, now = new Date())`
  (`:36`), `manualInputFromArgs(args)` (`:85`).
- `availability.ts`: `AvailabilitySweepOptions` (`:11`), `AvailabilitySweepResult` (`:28`),
  `sweepAvailability(db, adapters, opts)` (`:42`).
- `source-runner.ts`: `runSources(adapters, brief, opts)` (`:15`).
- No subdirectories.

## Invariants

- **`NormalisedListing` is the only cross-layer listing shape**: every adapter fills the
  same fields, and `null` means "unknown", never zero (`types.ts:124`).
- **Delisting is explicit and separate from visibility**: `delistedAt`/`delistReason` are
  optional, `null` means still active, and `availabilityCheckedAt` is independent of
  `lastSeenAt` (`types.ts:164`–`types.ts:169`).
- **`SourceAdapter` is capability-based**: only `search` is required; `fetchDetail` and
  `checkAvailability` are optional, and callers must test for presence before use
  (`types.ts:193`–`types.ts:196`).
- **The brief is validated, not trusted**: `SearchBriefSchema` enforces a 5-digit ZIP,
  positive budget/radius, `minSeats`/`minDoors` ≥ 2, preference weights 0–25, and
  `maxCards` 1–100; `analysis` and `preferences` have defaults
  (`brief.ts:9`–`brief.ts:61`).
- **`defaultBrief` derives the ceiling**: `budgetAllInEur = purchaseMaxEur + reserveEur`,
  read from `PURCHASE_MAX_EUR`/`RESERVE_EUR` (defaults 7000/800), ZIP from `SEARCH_ZIP`
  (default `69168`), radius from `SEARCH_RADIUS_KM` (default 200) (`brief.ts:72`–`brief.ts:83`).
- **`minDoors` counts side doors**: 4 side doors = a 5-door car, documented inline and
  mirrored in the evaluation gate (`brief.ts:86`).
- **One distance tolerance for the whole system**: `max(5, ceil(radiusKm * 0.05))` km,
  used by source filtering, integrity checks and evaluation alike (`distance.ts:5`,
  `distance.ts:6`).
- **A `null` distance never fails a limit** — unknown is not far (`distance.ts:10`).
- **Parsing is German-format aware and total**: `parseGermanInt` strips non-digits, so
  `"165.000 km"` → `165000`; `parseFirstRegistration` accepts `MM-YYYY` / `MM/YYYY`
  only and rejects impossible months; invalid input returns `null` rather than throwing
  (`parse.ts:11`, `parse.ts:20`–`parse.ts:25`).
- **`parseFirstRegistration` always returns the first of the month** as `YYYY-MM-01`
  (`parse.ts:25`).
- **`contentHash` is 16 hex chars of SHA-256**, applied consistently by callers which
  slice `sha256(...)` themselves (`parse.ts:4`, `sources/autoscout24.ts:129`).
- **Integrity checks are conservative and named**: price above `purchaseMaxEur`, distance
  beyond `radiusKm + tolerance`, more than 50,000 total results, and zero parsed refs
  despite a non-zero count all produce explicit `reasons` (`integrity.ts:29`–`integrity.ts:48`).
- **`checkFilterIntegrity` only inspects AutoScout24-shaped payloads**
  (`payload.price.priceRaw`, `payload.location.distanceToSearchLocationInKm`) and simply
  skips refs that lack them (`integrity.ts:4`–`integrity.ts:24`).
- **Dedupe is deliberately conservative**: the key is
  `make|model|YYYY-MM|mileage/5000|price/250`, so distinct cars sharing a model and year
  are not merged; the most complete listing wins and is chosen by field count
  (`dedupe.ts:39`, `dedupe.ts:59`, `dedupe.ts:77`).
- **Dedupe never drops a source id**: DB uniqueness already handles same-source repeats
  (`dedupe.ts:29`–`dedupe.ts:33`).
- **Health thresholds are fixed constants**: a source with no successful run in 72 h is
  stale, and no insert for 7 days raises a warning; `healthy` is `warnings.length === 0`
  (`health.ts:28`, `health.ts:29`, `health.ts:59`, `health.ts:78`, `health.ts:94`).
- **A source is only stale if enabled** (`row.enabled === 1`), so a deliberately disabled
  adapter never degrades the report (`health.ts:59`).
- **Availability writes only on reliable signal**: `"gone"` → `markListingUnavailable`
  with the adapter label as reason, `"available"` → `markListingAvailable`, anything else
  → `recordAvailabilityCheck` only. Unknown never hides a car (`availability.ts:91`–`availability.ts:105`).
- **Sweep candidates require an adapter that implements `checkAvailability`**; others are
  counted as `skipped`, never as `unknown` (`availability.ts:56`, `availability.ts:79`).
- **Default sweep budget**: limit 12, stale after 24 h, 2000 ms spacing, ordered by score
  then oldest (`availability.ts:47`–`availability.ts:49`, `availability.ts:61`–`availability.ts:66`).
- **`runSources` is unordered and fault-isolated**: all enabled adapters run through
  `Promise.allSettled`, a rejection becomes a `SourceFailure` with a classified symptom
  and strategy list, and it never aborts the others (`source-runner.ts:20`–`source-runner.ts:41`).
- **Manual listings get a deterministic id**: `manual-<12 hex of sha256(url or
  title|price)>`, so re-entering the same ad updates instead of duplicating
  (`manual.ts:38`).
- **`manualInputFromArgs` requires `--title` and `--url`** and throws otherwise
  (`manual.ts:92`, `manual.ts:93`).

## Side Effects

- `openDb`/SQLite access in `checkHealth` (`health.ts:38`, two `SELECT`s) and in
  `sweepAvailability` (reads `latestListings`, writes availability state)
  (`availability.ts:53`, `availability.ts:92`–`availability.ts:103`).
- Outbound HTTP through adapter methods invoked by `runSources` and
  `sweepAvailability` — the modules themselves do not fetch (`source-runner.ts:22`,
  `availability.ts:83`).
- Sleeping between availability checks via `setTimeout`, skipped after the last candidate
  (`availability.ts:107`–`availability.ts:109`).
- `checkHealth` reads the clock through the injectable `now = Date.now()`
  (`health.ts:38`).
- `defaultBrief` reads process environment variables (`PURCHASE_MAX_EUR`, `RESERVE_EUR`,
  `SEARCH_ZIP`, `SEARCH_RADIUS_KM`) (`brief.ts:64`–`brief.ts:83`).
- `buildManualListing` reads the clock and JSON-stringifies the listing and its own input
  into `rawJson` (`manual.ts:39`, `manual.ts:81`).
- No logging, no filesystem writes.

## Verification

- Run: `npm test`
