---
id: acceptance
title: Acceptance Criteria
sidebar_position: 4
description: buy-scout — Acceptance Criteria
---

# buy-scout — POC Acceptance Criteria (ACs)

**POC target:** 2026-11-15
**Status legend:** `[x]` verified, `[~]` partial, `[ ]` not started.

| ID | Criterion | Verification | Status |
|---|---|---|---|
| AC-01 | Repo separate from Work Intelligence; docs | `README.md`, `docs/` | `[x]` |
| AC-02 | AS24 search + detail | CLI, DB | `[x]` |
| AC-03 | N sources concurrent, no priority | 2 active adapters | `[~]` |
| AC-04 | Raw HTML/JSON snapshots | `data/raw/` | `[x]` |
| AC-05 | Filter integrity | CLI, tests | `[x]` |
| AC-06 | Detail enrichment | DB, tests | `[x]` |
| AC-07 | Family hard gates | tests | `[x]` |
| AC-08 | Rule score + verdicts | tests, CLI | `[x]` |
| AC-09 | 3 sources active | health | `[~]` 2/3 |
| AC-10 | Kleinanzeigen/mobile.de email path | `npm run email` | `[~]` leads only |
| AC-11 | Laya classification | adapter installed; weights not run | `[~]` |
| AC-12 | DeepSeek analysis for top N | client + fallback | `[~]` no key |
| AC-13 | Decision + user action persistence | `brain_decisions`, `user_actions` | `[x]` |
| AC-14 | Interactive UI | `npm run ui` | `[x]` |
| AC-15 | Eval: 50 real + 20 adversarial | `npm run eval` | `[~]` current corpus; labels pending |
| AC-16 | Typecheck + tests | Current test suite | `[x]` |
| AC-17 | No auto-messaging/payment | review | `[x]` |
| AC-18 | Runbook + status docs | docs | `[x]` |
| AC-19 | Hard fail = 0; unknown = ask | tests | `[x]` |
| AC-20 | Cross-source dedupe | tests | `[x]` |
| AC-21 | Source health | `npm run health` | `[x]` |
| AC-22 | Static report | `data/report.html` | `[x]` |
| AC-23 | Workaround matrix | `docs/WORKAROUNDS.md` | `[x]` |
| AC-24 | Access playbook | `npm run playbook` | `[x]` |
| AC-25 | Attempts + lessons persisted | `access_attempts`, `rule_cards` | `[x]` |
| AC-26 | Email lead parser | `npm run email` | `[x]` |
| AC-27 | Analysis fallback | `npm run analyze` | `[x]` |
| AC-28 | Eval harness | `npm run eval` | `[x]` |
| AC-29 | Versioned criteria profiles | `criteria_profiles`; tests | `[x]` |
| AC-30 | Criteria editor in UI | `npm run ui` | `[x]` |
| AC-31 | Weighted priorities (boost, never filter) | tests + UI | `[x]` |
| AC-32 | Threshold analysis, not fixed top 10 | selection tests + UI | `[x]` |
| AC-33 | Verdict legend + disclaimer | UI, report, `docs/VERDICTS.md` | `[x]` |
| AC-34 | Newest-first adaptive multi-page fetch | `npm run fetch:as24` | `[x]` |
| AC-35 | Coverage ledger + detail skip | `fetch_coverage`, `fetch_stats` | `[x]` |
| AC-36 | Fetch now button | UI + `/api/fetch` | `[x]` |
