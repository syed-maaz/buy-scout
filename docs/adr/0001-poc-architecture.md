---
id: adr-0001
title: ADR-0001 — POC Architecture
sidebar_position: 3
description: buy-scout — ADR-0001 — POC Architecture
---

# ADR-0001: Car-first POC architecture

- Status: accepted
- Date: 2026-10-28

## Context

We need a working POC by 2026-11-15 for a used family car in Wiesloch 69168, €6,000 all-in. The long-term product is a generic buy-side search engine (cars now, TVs later). Work Intelligence MCP already has memory/learning patterns we want to reuse.

## Decisions

1. **N sources in parallel, no priority.** `runSources()` uses `Promise.allSettled` over enabled adapters. A blocked source is reported, not fatal.
2. **Raw snapshots are immutable.** Every search page and listing payload is stored before parsing. Re-parsing must not require re-fetching.
3. **Deterministic extraction.** AutoScout24 `__NEXT_DATA__` and later mobile.de JSON-LD/flight payload are parsed by code. DeepSeek does not populate fields.
4. **Filter integrity assertions.** Every run checks observed max price, max distance, total result count, and listing count. Invalid runs are marked `filter_invalid`.
5. **Laya classifies first; DeepSeek analyses second.** Laya characterises the family need and categorises listings against filters. DeepSeek analyses the shortlisted listings, detects contradictions, explains, and drafts German messages. Laya is not a numeric calculator or history source.
6. **Rules own vetoes.** Budget, distance, seats, ISOFIX, HU, VIN, damage, seller type, dedupe are deterministic.
7. **Memory mirrors Work Intelligence.** `memory_observations`, `brain_decisions`, `brain_outcomes`, `strategy_priors`, `rule_cards`; recall later via FTS/MemPalace. Separate DB from WI.
8. **Claude Code hooks.** Session-start loads memory; stop appends a session note. Hooks are scripts first; settings wiring is explicit.
9. **Car-first domain pack.** Generic core contracts now; TV pack later. Do not build a universal scraper.

## Consequences

- More work up front on parsers and provenance, less rework when selectors/prompts change.
- DeepSeek cost stays low because it only sees normalised survivors.
- Laya cannot block the POC; it is a classifier, not the pipeline.
- The source registry can grow without changing the core.
