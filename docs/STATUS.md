---
id: status
title: Status
sidebar_position: 1
description: buy-scout — Status
---

# buy-scout — Status

**Snapshot:** generated state; run `npm run health` and `npm run eval` for current values
**Milestone:** POC feature-complete (local prototype)
**Overall:** usable for daily shortlisting; source access and labels remain the main external dependencies.

## Working

- Repo at `buy-scout`; Work Intelligence untouched.
- TypeScript strict; test count is reported by `npm test`; typecheck passing.
- AutoScout24: newest-first adaptive multi-page search + detail + family fields.
- Kleinanzeigen: direct search + detail, plus URL import for listings outside the paged index.
- AutoUncle: Jina Reader with local Chrome fallback; paginated; enabled in the source registry.
- mobile.de: page-1 browser-profile search adapter; saved-search email import; disabled by default.
- Parallel runner; no source priority.
- Filter integrity; raw snapshots; SQLite.
- Smart fetch coverage ledger (`fetch_coverage`) + learned page budget (`fetch_stats`).
- Family hard gates, score, verdicts.
- Dedupe, decision persistence, user actions, purchase outcomes (detail drawer), and source-confirmed delisting (404/410/gone pages).
- Interactive UI (`npm run ui`): criteria editor, view filters, search, inspect/watch/skip, analyze button, Fetch now with live progress.
- Analysis (`npm run analyze`): threshold-based qualifying cards + deterministic fallback + optional DeepSeek.
- Email lead parser (`npm run email`): extracts AS24/mobile.de/Kleinanzeigen links.
- Eval (`npm run eval`): current corpus plus 20 adversarial cases.
- Criteria profiles versioned in SQLite (active v18: €7,000 car cap + €800 reserve, 200 km); saving clears analyses and scoring happens on read.
- Priority weights boost matching makes/models/gearbox (VW, Passat, automatic) without filtering others; cap +25.
- Access playbook (`npm run playbook`): symptom → strategy, attempts, lessons.
- Static report (`npm run report`).
- Public docs and source; local agent state, private memory and internal reviews are excluded from the public snapshot.

## Credential-/network-dependent

- **mobile.de search**: page 1 works only with a supplied Chrome profile; fresh sessions hit Akamai 403. Saved-search email import is supported. Multi-page is not stable.
- **Laya**: on by default for CLI `fetch`, `analyze`, `daily` and `laya:classify`; loads local weights on first use; `--no-laya` or `LAYA_ENABLED=0` disables. UI Fetch now runs `fetch:report` with `--no-laya`, and the UI analysis endpoint does not call Laya.
- **LLM/DeepSeek**: one OpenAI-compatible `LLM_*` endpoint; the deterministic fallback is used when it is not configured. Laya local classification is verified.
- **Human labels**: precision@10 needs 50 labels; harness exists.

## Measured state

```text
Run: npm run health
Run: npm run eval
Run: npm test
```

Do not copy these values into prose; they are generated.

## Next 3 tasks

1. mobile.de email → detail fetch via Firecrawl.
2. Human labels → precision@10 report.
3. Auto-fallback executor from the playbook (rank strategies by attempt history).
