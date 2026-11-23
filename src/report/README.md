# Report Rendering

## Overview

Renders the static HTML shortlist consumed by `npm run report`. `renderReport` is a
pure template function: it takes already-scored `ReportItem`s plus counts, source rows
and the active brief, and returns one self-contained HTML document with inline CSS. It
performs no queries, no writes and no scoring of its own.

## Interface

- `ReportItem` — `{ listing: NormalisedListing; evaluation: CarEvaluation }` (`render.ts:4`).
- `renderReport(args: { items; generatedAt; criteriaVersion; brief; counts; sources }): string`
  (`render.ts:43`). `counts` is `{ listings, decisions, observations }`; each `sources`
  row is `{ id, label, status, note, runs, avgFound }` (`render.ts:48`–`render.ts:49`).
- Module-private helpers: `esc` HTML escaping (`render.ts:9`), `eur`/`km` German-locale
  formatters (`render.ts:18`, `render.ts:22`), `VERDICT_HELP` explanatory copy
  (`render.ts:26`), `badge` (`render.ts:33`).
- No subdirectories.

## Invariants

- **All interpolated values pass through `esc`**, including URLs, titles, source ids and
  failure/unknown strings (`render.ts:56`, `render.ts:67`, `render.ts:92`).
- **Verdict copy is fixed** to the four-verdict contract and must match
  `CarVerdict`: `inspect` = hard-pass and score ≥ 65, `ask` = family fields unknown,
  `watch` = hard-pass but score < 65, `reject` = hard failure with score 0
  (`render.ts:26`–`render.ts:31`).
- **Badge colours map 1:1 to verdicts** through the CSS variables `--good`, `--ask`,
  `--watch`, `--bad` (`render.ts:34`–`render.ts:40`).
- **Detail precedence**: hard failures, else unknowns, else reasons — never all three
  (`render.ts:57`–`render.ts:62`).
- **Missing values render as `—`** (`eur`, `km`, `firstRegistration`, `fuel`,
  `transmission`, `city`) rather than `null` (`render.ts:19`, `render.ts:23`,
  `render.ts:72`–`render.ts:75`).
- **The output is always a complete document**: `<!doctype html>` through `</html>`,
  with the immutable disclaimer bar and the INSPECT/ASK/WATCH/REJECT legend stating
  that score is a relative ranking and confidence is data completeness
  (`render.ts:101`, `render.ts:152`, `render.ts:161`).
- **Empty shortlist is not an error**: it renders a hint to run `npm run fetch:as24`
  (`render.ts:165`).

## Side Effects

- None. No filesystem, network or database access; the caller (`src/cli/report.ts`)
  owns writing the returned string to `./data/report.html`.

## Verification

- Run: `npm test`
