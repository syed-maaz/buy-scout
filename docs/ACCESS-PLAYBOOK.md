---
id: access-playbook
title: Access Playbook
sidebar_position: 5
description: buy-scout — Access Playbook
---

# buy-scout — Access Playbook

This is the reusable answer to: **“This site is blocked. What did we do last time?”**

It is not a checklist in chat. It is code, data, and approved lessons:

1. A source adapter fails.
2. `classifyAccessFailure()` maps the symptom: `http_403`, `cloudflare`, `akamai`, `login_wall`, `captcha`, `rate_limited`, `filter_ignored`, `empty_payload`, `js_only`, `unknown`.
3. `recommendStrategies()` returns an ordered fallback ladder.
4. `npm run fetch` prints the recommendations and records the attempt in `access_attempts`.
5. A failure is written to `memory_observations` as `access_failure`.
6. A confirmed fix is stored as a `rule_cards` lesson, scoped to the source or to `access:generic`.
7. The next adapter/session can query the same playbook instead of rediscovering the block.

## Commands

```bash
npm run playbook
npm run playbook -- --symptom cloudflare
npm run playbook -- --symptom filter_ignored
```

## Symptom → strategy ladder

| Symptom | Signals | First moves | Confirmed example |
|---|---|---|---|
| `http_403` | 403, access denied, Zugriff verweigert | Playwright headless → headful persistent → Firecrawl → Jina → email | mobile.de direct 403 |
| `cloudflare` | Just a moment, cf_chl, Sicherheitsüberprüfung | **Jina Reader HTML** → Firecrawl → headful → manual | AutoUncle works via Jina |
| `akamai` | `_abck`, `bm_sz`, Akamai | headful persistent → CDP attach → Firecrawl → email | Kleinanzeigen |
| `login_wall` | sign in, login, anmelden | CDP attach to user session → extension capture → manual | never store credentials |
| `captcha` | captcha, robot, are you human | official API → email → manual | do not solve CAPTCHAs |
| `rate_limited` | 429, too many requests | backoff/cache → email | lower frequency |
| `filter_ignored` | implausibly broad, price/radius leak | assert filters → Firecrawl actions → UI-driven Playwright → local filter → email | mobile.de 212k unfiltered |
| `empty_payload` | body too small, zero cards | Playwright wait-for-content → Jina → Firecrawl | Jina 6 KB error page |
| `js_only` | no listing nodes, app shell | Playwright → Firecrawl → JSON-LD | SPA search pages |
| `unknown` | anything else | direct HTTP → Playwright → Firecrawl → manual | baseline first |

## Approved lessons (seeded in `rule_cards`)

- `access:autouncle` — Cloudflare challenge → **Jina Reader HTML** (`X-Return-Format: html`) works.
- `access:autouncle` — price bucket must be rounded up: `mp-unter-5200-euro` is a 404, `mp-unter-6000-euro` works. Historical cap was €5,200; the active v18 cap is €7,000 and is applied locally. The source is disabled until a recovery path is verified.
- `access:mobile_de` — 403 / Playwright blocked → **saved-search email** is the trigger; Firecrawl for detail; search filters are silently ignored.
- `access:generic` — hand-built filter URLs may reset → assert max price/radius/count and filter locally.

## Design rules

- Prefer **platform-initiated** paths (saved-search email, RSS, official API) over fighting bot protection.
- A 200 response is not success: assert price, radius, count, and listing nodes.
- Cache and back off; do not poll a reader/hosted fetcher aggressively.
- Do not build CAPTCHA-solving, credential replay, or stealth arms races.
- Record **success and failure** per source/method; future ranking should use those counts.
- Keep the raw snapshot, the symptom, and the chosen strategy together for audit.

## Future extension

Add Beta priors per `(source, symptom, strategy)` from `access_attempts` so the recommender ranks the strategy that worked last time for that source — the same learning pattern as Work Intelligence’s skill priors.
