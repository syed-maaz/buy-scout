# Domain Layer

## Overview

Category-specific decision logic, separated from the generic core. `preferences.ts`
turns ranked preference rules into a bounded score boost, and the `cars/` subtree holds
the car verdict engine. This directory owns one direct module plus the car component;
`core` types flow in, nothing here performs I/O.

## Interface

- `preferences.ts`: `PreferenceMatch` (`:3`), `PreferenceResult` (`:12`),
  `applyPreferences(rules: PreferenceRule[] | undefined, listing: NormalisedListing)`
  (`:42`); module-private `fieldValue` maps each `PreferenceField` to a search string
  (`:17`).
- `cars/` — car-specific evaluation: `evaluateCar`, `CarEvaluation`, `CarVerdict`.
  See [`./cars/README.md`](./cars/README.md).

## Invariants

- **Preferences are tie-breakers, not filters**: unmatched rules never exclude a listing,
  and the total boost is hard-capped at 25 (`preferences.ts:69`–`preferences.ts:70`).
- **Per-rule weight is clamped to 0–25** before it is added
  (`Math.max(0, Math.min(25, rule.weight))`, `preferences.ts:57`).
- **Disabled and empty rules are skipped**: `enabled === false`, `weight <= 0`, or a
  blank `value` never match (`preferences.ts:50`).
- **Matching is case-insensitive substring by default**, exact string comparison only
  when `rule.match === "equals"` (`preferences.ts:51`–`preferences.ts:54`).
- **A rule with no field content cannot match**: an empty haystack is skipped, so
  `null` fields produce no false positives (`preferences.ts:53`).
- **`equipment` and `title` rules search a composite haystack** (description included),
  while `make`/`model`/`variant`/`bodyType`/`fuel`/`transmission`/`sellerType` read a
  single field (`preferences.ts:18`–`preferences.ts:36`).
- **`evidence` is truncated to 160 characters** to keep contract output bounded
  (`preferences.ts:65`).
- **Match order follows rule order**, and duplicates are not merged — one rule, one entry
  (`preferences.ts:49`, `preferences.ts:59`).
- The boost returned here is added verbatim by `evaluateCar` and re-normalised there as
  `boost / 25` for display (`src/domain/cars/evaluate.ts:225`, `src/domain/cars/evaluate.ts:265`).

## Side Effects

- None. `applyPreferences` is a pure function over its arguments: no database, network,
  filesystem, clock or logging.

## Verification

- Run: `npm test`
