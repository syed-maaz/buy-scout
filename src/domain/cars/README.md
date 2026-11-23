# Cars Domain Evaluation

## Overview

Deterministic, rule-based scoring for the car category. `evaluate.ts` is the single
place where a `SearchBrief` and a `NormalisedListing` become a `CarVerdict` plus a
0–100 relative score. It is pure and synchronous: no I/O, no network, no database.
Every consumer (CLI, UI, report, analysis selection) calls the same function, so the
verdict shown in the browser is the verdict used to gate analysis and email drafting.

## Interface

- `CarVerdict` — union of `"inspect" | "ask" | "watch" | "reject"` (`evaluate.ts:5`).
- `CarEvaluation` — result contract: `verdict`, `hardPass`, `hardFailures`, `unknowns`,
  `score`, `confidence`, `reasons`, `preferenceBoost`, `preferenceMatches`, and the
  `components` breakdown `{ family, deal, age, mileage, distance, evidence, preference }`
  (`evaluate.ts:7`).
- `evaluateCar(brief: SearchBrief, listing: NormalisedListing, now = new Date()): CarEvaluation`
  — the only exported function (`evaluate.ts:109`).
- Module-private internals cited by the invariants below: `HARD_RED_FLAGS` (`evaluate.ts:28`),
  `dealComponent` (`evaluate.ts:55`), `familyComponent` (`evaluate.ts:75`),
  `registrationYear` (`evaluate.ts:49`), `clamp01` (`evaluate.ts:45`).
- Depends on `applyPreferences` from `../preferences.ts` and `distanceToleranceKm`
  from `../../core/distance.ts`.
- No subdirectories.

## Invariants

- **Hard gate ordering**: every hard rule is evaluated before scoring; any
  `hardFailures` entry forces `score = 0` and `verdict = "reject"` (`evaluate.ts:225`,
  `evaluate.ts:227`).
- **Price gate**: `priceEur > brief.purchaseMaxEur` fails. A 2010-or-newer car priced
  under 1000 € is also a hard failure as implausible (`evaluate.ts:118`, `evaluate.ts:150`).
- **Distance gate** uses `radiusKm + distanceToleranceKm(radiusKm)`, the same tolerance
  used by source filtering and integrity checks — never a second coefficient
  (`evaluate.ts:121`).
- **Unknowns never reject**: a `null` field is pushed to `unknowns`; family fields
  (`seats`, `doors`, `isofix`, `bodyType`) and required fuel, transmission, damage or
  commercial-only constraints drive verdict `"ask"` instead of a rejection.
- **Verdict ladder**: hard failure → `reject`; family unknowns present → `ask`;
  otherwise `score >= 65` → `inspect`, else `watch` (`evaluate.ts:227`–`evaluate.ts:234`).
- **Score composition is fixed**: weights `0.3 family + 0.25 deal + 0.15 age +
  0.15 mileage + 0.1 distance + 0.05 evidence`, scaled by 100, clamped to 100, then
  added to `preferences.boost` (`evaluate.ts:217`).
- **Confidence is data completeness**, `knownFields / 9`, not model certainty
  (`evaluate.ts:204`, `evaluate.ts:215`).
- **All components and score are rounded to 2 (score 1) decimals** before return; the
  preference component is `clamp01(boost / 25)` (`evaluate.ts:253`–`evaluate.ts:265`).
- **Fuel/transmission matching is substring-based on German strings** (`benzin`,
  `diesel`, `schalt`, `autom`) and is skipped when the field is `null` or the brief
  says `"any"` (`evaluate.ts:165`–`evaluate.ts:183`).

## Side Effects

- None. No database, network, filesystem, clock mutation or logging. The only ambient
  input is the optional `now` argument, used for the `age` component
  (`evaluate.ts:196`).

## Verification

- Run: `npm test`
