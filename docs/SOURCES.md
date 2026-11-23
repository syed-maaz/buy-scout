---
id: sources
title: Source Matrix
sidebar_position: 2
description: buy-scout — Source Matrix
---

# buy-scout — Source Matrix

All sources run in parallel. No source priority.

| Source | Access | Status | Notes |
|---|---|---|---|
| AutoScout24 | HTTP + `__NEXT_DATA__` | **working** | Search + detail; 20/page; seats/doors/ISOFIX/median |
| AutoUncle | Jina Reader + local Chrome fallback | **working; enabled** | Paginated; 25 cards per page; page budget follows fetch |
| mobile.de | Browser profile + saved-search email | **disabled by default** | Page-1 search works with `BUY_SCOUT_CHROME_PROFILE`; fresh sessions 403; email/URL import supported |
| Kleinanzeigen | Direct HTTP | **working** | direct search + detail; local filters |
| Local dealers | HTTP/Playwright | later | warranty stock |
| 12gebrauchtwagen | HTTP | later | AS24-derived |
| heycar | — | dropped | redirects to drive.co.uk |

The `sources` table is the canonical registry and the adapter switch. AutoScout24, Kleinanzeigen and AutoUncle are enabled and working. mobile.de is disabled by default because fresh sessions fail Akamai; it can be used with a supplied Chrome profile. `npm run health` prints the current rows.

## Filter integrity

- AS24: price, distance, count.
- Kleinanzeigen: local card filtering against the cap and radius, plus a small card-level allowance.
- AutoUncle, when enabled: price bucket and count; distance is estimated from ZIP.
- A 200 response is not success; check integrity and result count.

## Workarounds

See [WORKAROUNDS.md](WORKAROUNDS.md) for the tested access matrix.
