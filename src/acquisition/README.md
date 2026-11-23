# Acquisition Playbook

## Overview

A static, data-driven diagnosis table for blocked or degraded source access. Given an
error and response context, `classifyAccessFailure` maps the failure onto one
`AccessSymptom`, and the playbook returns an ordered list of `AccessStrategy`
recommendations. It is pure lookup: no fetching, no retries, no browser automation is
performed here. The fetch CLI and `core/source-runner.ts` consume it to explain and
record failures instead of silently degrading.

## Interface

- `AccessSymptom` — union of `"http_403" | "cloudflare" | "akamai" | "login_wall" |
  "captcha" | "rate_limited" | "filter_ignored" | "empty_payload" | "js_only" | "unknown"`
  (`playbook.ts:1`).
- `AccessStrategy` — union of 14 strategies: `direct_http`, `json_ld`,
  `playwright_headless`, `playwright_headful`, `cdp_attach`, `firecrawl`,
  `firecrawl_actions`, `jina_reader`, `saved_search_email`, `official_api`, `rss_feed`,
  `manual_url`, `extension_capture`, `local_filter` (`playbook.ts:13`).
- `StrategyRecommendation` — `{ strategy, why, evidence? }` (`playbook.ts:29`).
- `PlaybookEntry` — `{ symptom, label, signals: RegExp[], strategies }` (`playbook.ts:35`).
- `ACCESS_PLAYBOOK: Record<AccessSymptom, PlaybookEntry>` — the exported table backed by
  the module-private `ENTRIES` (`playbook.ts:151`, `playbook.ts:42`).
- `classifyAccessFailure(error: unknown, context?: { status?: number; body?: string }): AccessSymptom`
  (`playbook.ts:153`).
- `recommendStrategies(symptom: AccessSymptom): StrategyRecommendation[]` (`playbook.ts:176`).
- `playbookEntries(): PlaybookEntry[]` (`playbook.ts:180`).
- `formatRecommendations(symptom: AccessSymptom): string` — numbered `strategy — why`
  lines (`playbook.ts:184`).
- No subdirectories.

## Invariants

- Every `AccessSymptom` member has exactly one entry in `ENTRIES`, enforced by the
  `Record<AccessSymptom, PlaybookEntry>` type (`playbook.ts:42`).
- `classifyAccessFailure` is ordered most-specific-first: 429/rate limit, captcha,
  cloudflare, akamai, login wall, filter leak, empty payload, JS-only, then 403
  (`playbook.ts:160`–`playbook.ts:172`).
- Classification is case-insensitive: the haystack is
  `` `${message} ${context.body}`.toLowerCase() `` (`playbook.ts:158`).
- `unknown` is the only fallback and carries an empty `signals` list
  (`playbook.ts:138`–`playbook.ts:149`, `playbook.ts:173`).
- Strategy lists are ordered by intent (cheapest/safest first, "do not build a
  CAPTCHA-solving arms race" last), and `login_wall` never recommends credential replay
  (`playbook.ts:78`–`playbook.ts:86`).
- `recommendStrategies` and `playbookEntries` return the shared table objects by
  reference; callers must treat them as read-only.

## Side Effects

- None. Pure string/regex evaluation; no I/O and no mutable module state beyond the
  frozen-by-convention `ENTRIES` constant.

## Verification

- Run: `npm test`
