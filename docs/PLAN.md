---
id: plan
title: Plan
sidebar_position: 2
description: buy-scout — Plan
---

# buy-scout — Living Plan

**Last updated:** 2026-10-31
**POC deadline:** 2026-11-15
**First purchase target:** January 2027
**Current milestone:** POC feature-complete (local prototype)

## 1. Product thesis

Build a generic **buy-side search and decision engine**, not a universal scraper.

- **Universal core:** search brief → source adapters → normalised item → family/domain filters → score → shortlist → contact → outcome → memory.
- **Domain packs:** cars first; TVs later. The core must not know what ISOFIX or OLED means.
- **N sources in parallel:** no first/second/third priority. A blocked source is reported, not fatal.
- **Deterministic extraction:** parsers own fields. DeepSeek analyses; it does not extract.
- **Laya classifies:** need profile and listing fit. Rules own vetoes. DeepSeek explains and drafts.

## 2. The loop

```text
FETCH raw → REFINE/normalise → DECIDE/score → LEARN/outcome → memory
```

- **FETCH:** search pages, raw HTML/JSON snapshots, detail pages, filter-integrity checks.
- **REFINE:** canonical listing, dedupe, family features, price median, evidence/confidence.
- **DECIDE:** hard gates → Laya classification → DeepSeek analysis → ranked shortlist → decision record.
- **LEARN:** user outcome is now captured from the detail drawer; priors and recall are not implemented yet.

## 3. POC scope

### In

- Cars only, Wiesloch 69168, 200 km, €7,000 car cap + €800 reserve (v18).
- Family of four (2 children); 5 doors, 5 seats, 2× ISOFIX, boot ≥450 L.
- Sources: AutoScout24 and Kleinanzeigen direct; AutoUncle paginated; mobile.de profile-only page 1; email/manual intake as fallback.
- Raw snapshots + SQLite.
- Detail enrichment: seats, doors, body type, ISOFIX, description, market median, seller/warranty flags.
- Family hard gates + rule score.
- Laya need-characterisation + listing classification.
- DeepSeek analysis for top N only.
- Minimal web UI + daily digest.
- Decision/outcome persistence; WI-style memory schema.
- Claude Code hooks.

### Out

- Auto-purchase, payment, contract signing.
- Auto-send messaging (draft-only in POC).
- Full German-market coverage.
- TV domain pack.
- Multi-user/auth/billing.
- Fine-tuning Laya.
- Universal crawler framework.

## 4. Timeline

| Dates | Milestone | Status |
|---|---|---|
| Oct 28 | Research, architecture, repo, AS24 search + detail + family gates | **done** |
| Oct 29–30 | Interactive UI | **done** |
| Oct 31–Nov 2 | Truth lock, default brief, health, manual intake/reparse | **done** |
| Nov 3–4 | Kleinanzeigen direct search + detail | **done** |
| Nov 5–7 | Decision contract, golden vectors, source truth | next |
| Nov 8–9 | Outcome capture + memory recall | next |
| Nov 10 | Daily digest | next |
| Nov 11–14 | Evaluate 50 real + 20 adversarial; fix | next |
| Nov 15 | POC demo | **feature-complete; final validation pending** |

The dated rows before Nov 5 are complete as features. Remaining validation is human labels, a mobile.de detail path and one recorded live model run.

## 5. Source strategy

All sources are parallel. The `sources` registry decides which adapters are constructed; unimplemented adapters are visibly listed, not hidden.

| Source | Method | Status |
|---|---|---|
| AutoScout24 | HTTP + `__NEXT_DATA__` | working, enabled |
| mobile.de | Browser profile + saved-search email | page 1 with a supplied profile; email import supported |
| AutoUncle | Jina Reader + local Chrome fallback | paginated; enabled |
| Kleinanzeigen | direct search + detail HTML | working, enabled |
| Local dealers | HTTP/Playwright | later |
| 12gebrauchtwagen | HTTP | later |

## 6. Key decisions

- ADR-0001: car-first POC architecture.
- ADR-0002: detail enrichment and family gates.
- AutoUncle works via Jina Reader with a browser fallback. mobile.de page 1 needs a supplied Chrome profile; email is the stable trigger.
- Access blocks are classified and resolved through `docs/ACCESS-PLAYBOOK.md` and `npm run playbook`, with attempts/lessons persisted.
- Criteria are versioned; saving criteria clears stored analyses and scoring happens on read; fetching and analyzing are separate.
- Smart fetch uses newest-first adaptive pages, skips known details, and tracks price coverage per source/search context.
- DeepSeek does **not** extract fields; parsers do.
- Laya is a classifier, not a calculator or history source.
- Rules own all vetoes; hard fail = score 0; unknown family fields = `ask`.
- Raw snapshots are immutable; refined data is derived.
- Memory mirrors Work Intelligence but uses a separate DB.
- AutoUncle is enabled and paginated. mobile.de remains profile-only and disabled by default.
- Heidelberg/Mannheim Umweltzonen were lifted; no blanket diesel veto.

## 7. Open questions

1. Children’s ages, pram, 3-across vs normal 5-seat estate.
2. Dealer + private, or private-only?
3. Max mileage / min first registration (default 2010+, ≤180,000 km).
4. Wire Claude hooks into project settings now or after memory recall?
5. AutoUncle adapter: Playwright primary, Firecrawl fallback — confirm.
