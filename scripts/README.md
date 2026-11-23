# scripts

## Overview

Grouping directory for manual, out-of-pipeline utilities. It contains exactly one
direct script and one subdirectory of browser-access probes; neither is part of
the daily fetch/analyse/report run, and nothing under `src/` imports from here.

`probe-autouncle-parse.mjs` is an offline HTML parser used after a manual probe
capture: it reads a saved AutoUncle page instead of hitting the network, so
markup can be inspected repeatedly while the live site stays blocked.

The scripts here are throwaway diagnostics. Treat their output as evidence for
`docs/SOURCES.md`, not as a supported interface.

## Subdirectories & Boundaries

- [probes](./probes/README.md): one-off Playwright access probes against
  mobile.de and AutoUncle, plus the recorded blocked/degraded outcomes and the
  commands to re-run them.

## Local Interface

- `scripts/probe-autouncle-parse.mjs` — offline parse script, no exports, run
  with `node scripts/probe-autouncle-parse.mjs`.
- `scripts/probe-autouncle-parse.mjs:2` — `import * as cheerio from 'cheerio'`,
  the same parser and `cheerio.load(html)` call the AutoUncle adapter uses in
  `src/sources/autouncle.ts:147`.
- `scripts/probe-autouncle-parse.mjs:3` — reads a hard-coded absolute capture
  path, `/tmp/au-bw.html`, via `readFileSync(..., 'utf8')`.
- `scripts/probe-autouncle-parse.mjs:4-9` — loads that HTML into `cheerio`,
  prints the count of `article` elements, then for the first five articles
  prints the first `a[href*="/de/d/"]` href and up to 700 characters of
  whitespace-collapsed article text.

## Invariants

- Scripts in this directory are standalone ESM executables driven by top-level
  `await` or plain top-level code; they are run directly with `node` and export
  nothing, so they must not be imported by application code.
- `scripts/probe-autouncle-parse.mjs` depends on a file that is not in the repo:
  without a prior capture at `/tmp/au-bw.html` it throws on line 3 instead of
  degrading. Recreate the capture before running it.
- These scripts never fail a build. `npm test` only runs `tests/*.test.ts`, and
  no `package.json` script references anything in `scripts/`, so breakage here is
  invisible to CI and to `npm run daily`.
- Probe outcomes are recorded as blocked/degraded in the source matrix; they must
  not be used to claim a source is usable. See
  [`docs/SOURCES.md`](../docs/SOURCES.md).

## Side Effects

- Network: none from `scripts/probe-autouncle-parse.mjs`; the child probes make
  live HTTPS requests to `suchen.mobile.de` and `www.autouncle.de`.
- Disk: read-only access to the absolute path `/tmp/au-bw.html`. No file in the
  repository is written and no `data/` state is mutated.
- Process/UI: the child headful probe launches a visible local Chrome window
  through `playwright-core`.
- Output: diagnostic lines on stdout only; no logs or reports are persisted.

## Verification

- Run: `npm test`
- Manual: `node scripts/probe-autouncle-parse.mjs` after capturing
  `/tmp/au-bw.html`; probe commands are listed in
  [probes/README.md](./probes/README.md).
