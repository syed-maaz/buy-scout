# Marketplace Source Adapters

## Overview

One adapter per marketplace, each implementing the `SourceAdapter` contract from
`../core/types.ts`. Adapters own everything source-specific: URL construction, HTML or
`__NEXT_DATA__` parsing, normalisation into `NormalisedListing`, filter-integrity
assertions and optional detail-page enrichment. They are the only modules that perform
outbound HTTP `fetch` calls against marketplaces, and they never touch the database.

Adapter classes all declare `enabled = true`, but runtime enablement is decided by the
`sources` table: `src/db/index.ts` seeds AutoScout24 and Kleinanzeigen as enabled and
AutoUncle as `enabled = 0`, status `blocked`, and `src/cli/fetch.ts` builds its adapter
list from those rows. AutoUncle is reached through Jina Reader (`jina_reader`), not by a direct request.

## Interface

- `autoscout24.ts` (`AutoScout24Adapter implements SourceAdapter`, `autoscout24.ts:194`):
  `As24Listing` (`:17`), `buildAs24Url(brief, page, opts)` (`:57`),
  `extractNextData(html)` (`:87`), `normaliseAs24Listing(listing)` (`:105`).
  Adapter members: `search` (`:201`), `checkAvailability` (`:268`), `fetchDetail` (`:289`).
- `autoscout24-detail.ts`: `As24Detail` (`:4`), `extractAs24Detail(html)` (`:45`),
  `stripHtml(html)` (`:58`), `collectEquipment(equipment)` (`:75`),
  `detectRedFlags(text)` (`:88`), `detectCommercialOnly(text)` (`:104`),
  `detectIsofix(equipment, text)` (`:111`), `detectHuDue(text)` (`:118`),
  `mergeAs24Detail(base, detail)` (`:124`).
- `kleinanzeigen.ts` (`KleinanzeigenAdapter implements SourceAdapter`, `kleinanzeigen.ts:235`):
  `KleinanzeigenCard` (`:22`), `parseKleinanzeigenCards(html)` (`:46`),
  `parseKleinanzeigenDetail(html, card)` (`:91`),
  `normaliseKleinanzeigenCard(card)` (`:165`). Adapter members: `search` (`:242`),
  `checkAvailability` (`:299`), `fetchDetail` (`:313`).
- `autouncle.ts` (`AutoUncleAdapter implements SourceAdapter`, `autouncle.ts:277`):
  `AutoUncleCard` (`:17`), `autoUnclePriceCap(brief)` (`:36`),
  `estimateDistanceFromWiesloch(zip)` (`:45`), `buildAutoUncleUrl(brief)` (`:74`),
  `buildJinaUrl(target)` (`:79`), `parseAutoUncleCards(html)` (`:146`),
  `normaliseAutoUncleCard(card)` (`:189`), and `search(brief)` (`:284`).
- No subdirectories.

## Invariants

- **Every adapter sets a stable `id`** matching its `source` on every emitted listing and
  `RawRef`: `"autoscout24"`, `"kleinanzeigen"`, `"autouncle"`
  (`autoscout24.ts:195`, `kleinanzeigen.ts:236`, `autouncle.ts:278`).
- **External-id identity is per source**: AutoScout24 uses the numeric `id`
  (`autoscout24.ts:140`), Kleinanzeigen `data-adid` (`kleinanzeigen.ts:51`), AutoUncle the
  id segment of `/de/d/{id}` (`autouncle.ts:157`). Ids must stay stable across runs or
  the `(source, external_id)` uniqueness breaks.
- **AutoScout24 requires `sort=age` to be paired with `desc=1`**; otherwise the site
  silently serves default "Beste Ergebnisse" order (`autoscout24.ts:79`–`autoscout24.ts:81`).
- **Kleinanzeigen is localised at the source**: `buildKleinanzeigenUrl` sets
  `locationStr=<zip>` and `radius=<radiusKm>`, then filters null prices, dealer/auction
  titles, the price cap and distance beyond `radiusKm + 15` after parsing
  (`kleinanzeigen.ts:213`–`kleinanzeigen.ts:270`).
- **AutoUncle price buckets must round up** (`Math.ceil(purchaseMaxEur / 1000) * 1000`)
  because 5200 returns 404 while 6000 works; the true cap is then enforced locally
  (`autouncle.ts:36`–`autouncle.ts:39`, `autouncle.ts:308`–`autouncle.ts:313`).
- **AutoUncle distances are approximations** from a hardcoded PLZ-prefix table around
  Wiesloch, and return `null` for an unknown or malformed ZIP (`autouncle.ts:45`,
  `autouncle.ts:67`–`autouncle.ts:71`).
- **A short Jina body means blocked**: AutoUncle throws when the payload is under
  10,000 bytes rather than returning zero cards (`autouncle.ts:302`).
- **Availability is tri-state and never optimistic**: HTTP 404/410 or the explicit gone
  shell produces `"gone"`. `"available"` requires a positive detail marker —
  `__NEXT_DATA__` + `listingDetails` for AutoScout24, the ad container for
  Kleinanzeigen. A consent/challenge/error 200, any other non-OK response or a thrown
  error is `"unknown"` and never clears a delisting.
- **`contentHash` is derived from identity-defining fields only** (title/price/mileage/
  first registration, plus description on AutoScout24 detail) and truncated to 16 hex
  characters (`autoscout24.ts:120`, `autoscout24-detail.ts:133`, `kleinanzeigen.ts:113`).
- **`firstSeenAt`/`lastSeenAt` are stamped by the adapter** at normalisation time, and
  detail merges refresh only `lastSeenAt` (`autoscout24-detail.ts:180`).
- **Integrity is reported, not enforced**: `search` returns `FilterIntegrity` in
  `SourceSearchResult`; the fetch CLI decides whether to persist
  (`autoscout24.ts:263`, `kleinanzeigen.ts:296`, `autouncle.ts:343`).
- **Detail HTML parsing throws on missing structure** (no `__NEXT_DATA__`, no
  `pageProps`/`listingDetails`) and callers must tolerate it (`autoscout24.ts:91`,
  `autoscout24-detail.ts:49`, `autoscout24-detail.ts:54`).
- **Pagination stops early on an empty page**, warning only on page 1
  (`autoscout24.ts:232`–`autoscout24.ts:235`, `kleinanzeigen.ts:270`–`kleinanzeigen.ts:273`).
- **AutoScout24 leaves family fields null at card level** (`bodyType`, `seats`, `doors`,
  `hasIsofix`); they are only populated by `mergeAs24Detail` (`autoscout24.ts:154`–`autoscout24.ts:168`).

## Side Effects

- Outbound HTTPS `fetch` to `www.autoscout24.de`, `www.kleinanzeigen.de`,
  `www.autouncle.de` and `r.jina.ai`, with 30 s timeouts (60 s for AutoUncle/Jina) via
  `AbortSignal.timeout` (`autoscout24.ts:220`, `autouncle.ts:294`, `kleinanzeigen.ts:255`).
- Inter-request sleeping between pages via `setTimeout`
  (`autoscout24.ts:254`, `kleinanzeigen.ts:293`).
- Wall-clock reads (`new Date().toISOString()`) for `fetchedAt`, `firstSeenAt`,
  `lastSeenAt`.
- Raw HTML is returned to the caller but never written here; persistence and raw-file
  writes belong to `src/cli/fetch.ts`.
- No database access and no logging.

## Verification

- Run: `npm test`
