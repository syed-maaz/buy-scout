---
id: workarounds
title: Workarounds
sidebar_position: 4
description: buy-scout — Workarounds
---

# buy-scout — Source Workarounds

Live tests on 2026-10-28. Goal: find a practical path, not a theoretical one.

## mobile.de

| Method | Result | Verdict |
|---|---|---|
| Direct HTTP | `403 Zugriff verweigert` | No |
| Playwright headless | `403 Zugriff verweigert` | No |
| Playwright headful | Consent screen, then access denied | No |
| Jina Reader (`r.jina.ai`) | `403` passed through | No |
| Firecrawl scrape | `200`, full page, but filters ignored (212k results) | Partial |
| Firecrawl with UI actions | Not tested without key; API supports actions | Potential |
| Official Search API | `401`, partner-only | No self-serve |
| Saved-search email (`Suchauftrag`) | Works as a trigger; daily digest | **Recommended** |
| Manual URL / browser capture | Works | Fallback |

**Recommendation:** use the mobile.de saved-search email as the search trigger, then fetch the detail page through Firecrawl (or manual browser). Do not fight the search page filters; they silently reset. If you have a Firecrawl key, test `actions` to set the filters in the browser before scraping.

## AutoUncle

| Method | Result | Verdict |
|---|---|---|
| Direct HTTP | Cloudflare `Just a moment…` | No |
| Playwright headless | Cloudflare challenge | No |
| Jina Reader (`r.jina.ai`) | `200`, full HTML | **Working** |
| Firecrawl scrape | `200`, full page | Fallback |
| Regional + price path | `/in/Baden-Württemberg/mp-unter-6000-euro` returns 30,643 cars | **Working** |

**Recommendation (historical; AutoUncle is now enabled with a browser fallback):** AutoUncle adapter uses Jina Reader HTML. The price path is coarse: `mp-unter-5200-euro` is a 404, `mp-unter-6000-euro` works. Under the old €5,200 template it requested the 6000 bucket and applied the €5,200 hard gate locally; the active v18 cap is €7,000. The region is Baden-Württemberg, so distance is estimated from the ZIP prefix until a geocoder is added.

## Jina Reader operational notes

- Request `X-Return-Format: html`.
- A healthy AutoUncle page is ~1.1 MB; a 6 KB response is an error/block page. Reject `&lt;10 KB`.
- Cache the page; do not poll frequently.
- Jina may rate-limit. Treat it as a low-frequency source, not a real-time crawler.

## Firecrawl operational notes

- Works on both mobile.de and AutoUncle.
- 1 credit/page; JSON extraction costs more.
- Mobile.de filters are ignored on the raw URL; don't trust the result count.
- Best use: unblocker for a known detail URL, or a keyed fallback.

## Source status after this work

| Source | Status |
|---|---|
| AutoScout24 | working (direct HTTP + detail) |
| AutoUncle | working (Jina Reader; 25 cards/page) |
| mobile.de | blocked on search; email + Firecrawl detail next |
| Kleinanzeigen | email after 2026-11-03 |
