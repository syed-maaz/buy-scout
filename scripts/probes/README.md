# Source probes

## Overview

One-off Playwright probes used to check practical access to the external car
sources. They are not part of the pipeline: nothing under `src/` imports them,
no `package.json` script invokes them, and they are not wired into the daily
run. Their purpose is manual evidence gathering about whether a source can be
reached from this environment at all.

Observed outcomes, recorded in the source matrix at
[`docs/SOURCES.md`](../../docs/SOURCES.md):

- `probe-mobile-headless.mjs` — headless Chrome; currently gets
  `Zugriff verweigert`.
- `probe-mobile-headful.mjs` — headful Chrome; consent appears, then access is
  denied in this environment.
- `probe-autouncle.mjs` — Cloudflare `Just a moment…`.

Run from the repo root:

```bash
node scripts/probes/probe-mobile-headless.mjs
```

These results are recorded in `docs/SOURCES.md`. Do not wire them into the
daily run; the production adapters must report blocked/degraded instead.

## Interface

- `probes/probe-mobile-headless.mjs` — top-level-await ESM script, no exports.
  Launches `chromium.launch({ channel: 'chrome', headless: true })`, creates a
  context with `locale: 'de-DE'` and `timezoneId: 'Europe/Berlin'`, then
  `page.goto('https://suchen.mobile.de/auto/wiesloch.html', { waitUntil:
  'domcontentloaded', timeout: 45000 })`.
- `probes/probe-mobile-headless.mjs:6` — `page.waitForTimeout(2500)` before the
  probes are read.
- `probes/probe-mobile-headless.mjs:7-10` — prints `title`, `url`, the count of
  `a[href*="fahrzeuge/details"]`, and the first 700 characters of
  `body` innerText.
- `probes/probe-mobile-headful.mjs` — same target and logging shape, but
  `headless: false`, so a visible Chrome window is opened.
- `probes/probe-mobile-headful.mjs:7-9` — iterates the consent labels
  `['Ablehnen', 'Einverstanden']`, resolves the first via
  `page.getByRole('button', { name: label })`, and clicks at most one of them
  (`break` after the first match), swallowing click errors with `.catch(()=>{})`.
- `probes/probe-mobile-headful.mjs:10` — `page.waitForTimeout(4000)` after the
  consent attempt, then the same title / detail-link / body logging on lines
  11-13.
- `probes/probe-autouncle.mjs:5` — loops the two AutoUncle URLs
  `https://www.autouncle.de/de/gebrauchtwagen` and
  `.../gebrauchtwagen?location=69168&distance=50&price_to=6000`.
- `probes/probe-autouncle.mjs:9-12` — per URL prints `url`, `title`, the first
  300 characters of body innerText with newlines flattened to ` | `, and the
  count of `a[href*="/de/d/"]`.
- Probes are standalone executables run directly with `node`; they export no
  symbols and have no sibling contract subdirectories.

## Invariants

- Each probe is a self-contained ESM module using top-level `await`; it is run
  directly by `node`, never imported, and therefore must stay at
  `<name>.mjs` rather than being converted to a module export.
- Every probe closes its browser (`await browser.close()`) on the success path,
  so a run does not leave a Chrome process behind. A throw before that line
  aborts without cleanup.
- `probes/probe-mobile-headful.mjs` requires a graphical session. Headless
  environments can launch it but the window has nowhere to render.
- A failed navigation or block page is not an error: the probes print whatever
  the page returned and exit `0`. `scripts/probes/probe-autouncle.mjs:13`
  catches per-URL failures and logs `ERR <message>` instead of throwing.
  Callers must read stdout, not the exit code, to judge access.
- Probes are diagnostic only. They must not be imported by adapters under
  `src/`; a blocked or degraded source must be reported as such by the
  production adapter, not silently masked by a probe.

## Side Effects

- Network: live HTTPS requests to `suchen.mobile.de` and `www.autouncle.de`
  from the local machine.
- Process/UI: launches the locally installed Google Chrome through
  `playwright-core` (`channel: 'chrome'`); the headful probe opens a visible
  window.
- Output: writes diagnostic lines to stdout only; no files are created, no
  database or `data/` state is touched.
- Timing: each run blocks for roughly 12–20 seconds of scripted waits plus
  navigation time.

## Verification

- Run: `npm test`
- Manual: `node scripts/probes/probe-mobile-headless.mjs` from the repo root.
