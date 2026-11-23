---
id: smart-fetch
title: Smart Fetch
sidebar_position: 1
description: buy-scout — Smart Fetch
---

# buy-scout — Smart Fetch

## What changed

The old fetch was page 1 only, `sort=standard`, and re-fetched every detail on every run.

The smart fetch is:

```text
newest listings first
  → up to 10 pages (20/page)
  → target 50 new listings
  → stop when a page is mostly already-known
  → details only for new/changed cars
  → coverage ledger remembers which price range is already covered
  → learned page budget from previous runs
```

## Newest-first

AutoScout24 sort values:

```text
sort=age&desc=1
```

The UI label is `age-descending` ("Neueste Angebote zuerst"), but the URL
needs **both** parameters. `sort=age` alone renders as `desc=0` — the
default "Beste Ergebnisse" order — so a refresh re-reads known cards.
Sending `sort=age-descending` as one value returns zero listings.

## Adaptive page loop

Defaults:

```text
maxPages      10
minPages       5
targetNew     50
stop ratio    20% new
```

Example:

```text
page 1: 20/20 new → continue
page 2: 20/20 new → continue
page 3: 20/20 new → 60 new, stop (target 50)
```

Next run after those are known:

```text
page 1: 0/20 new → continue
page 2: 0/20 new → stop (mostly known)
```

It does not fetch page 1 only. It fetches as many pages as needed to find
new listings, then stops when the pages are mostly known.

## Coverage ledger

`fetch_coverage` stores one row per:

```text
source + zip + radius + fuel + transmission
```

with `price_from`, `price_to`, `swept_to`, `peeked_to`, pages, total results and last fetch time. `swept_to` is the cap used by the last full/expand pass; a refresh updates `peeked_to` and the timestamp but **does not** pretend the whole band was swept. Raising the cap beyond `swept_to` therefore triggers an expansion instead of being suppressed by an old `--max` watermark.

Modes:

| Situation | Mode | Behaviour |
|---|---|---|
| No coverage | `full` | Fetch 0 → cap |
| New cap > covered max | `expand` | Fetch `covered_max → new_cap` |
| New cap ≤ covered max | `refresh` | Check up to 6 pages; no full re-scan |
| `--full` | `full` | Ignore coverage |
| `--refresh` | `refresh` | Force a 6-page check |

Examples:

```text
Covered 0–7,000
Set 5,000  → refresh (covered), no full fetch
Set 7,000  → refresh (covered), no full fetch
Set 10,000 → expand 7,000–10,000
Set 5,000  → refresh (covered)
```

Coverage only expands; lowering the budget does not shrink it. The old
higher-price listings stay in SQLite for later and are simply rejected by
the current score.

:::warning Why refresh is not 2 pages
Observed 2026-10-29: pages 1–2 were fully known, pages 3–5 held 38 unseen cards. The root cause was **not** promotion: the URL was missing `desc=1`, so AutoScout24 used the default order. With `sort=age&desc=1`, page 1 was 20/20 new. The refresh window remains 6 pages as a safety margin; details are still skipped for known cards.
:::

## Details cache / skip

For each card:

```text
new            → fetch detail
price changed  → fetch detail
mileage changed→ fetch detail
unchanged      → skip detail, touch last_seen_at
```

This is why a daily run can check 40 known cards without re-downloading
40 detail pages.

## Learned page budget

`fetch_stats` stores an EWMA of new listings per page and new ratio.
Next full run uses:

```text
avg >= 15 new/page → 10 pages
avg >= 8          → 8 pages
otherwise         → 6 pages
```

Refresh runs use up to 6 pages (minimum 5). This is a small learning loop; the
per-page stop is the main adaptive control.

## Fetch now button

The UI header has **Fetch now**:

```text
POST /api/fetch          → starts the smart fetch child process
GET  /api/fetch/status   → running / done / failed + last log lines
```

- Uses the **saved active criteria**, not unsaved form edits.
- One fetch at a time; a second click returns `409`.
- Shows live page progress in the header.
- Reloads the shortlist when the process exits.
- The child runs `npm run fetch:as24`, so it uses the same adaptive/coverage logic as the CLI.

## Commands

```bash
# normal smart run, active criteria
npm run fetch:as24

# force a full re-scan
npm run fetch:as24 -- --full

# only check newest page(s)
npm run fetch:as24 -- --refresh

# explicit overrides (do not save criteria)
npm run fetch:as24 -- --max 7000 --target-new 50 --pages 10

# daily chain: fetch + analysis + eval + report
npm run daily
```

## Budget meaning

`purchaseMaxEur` is the **max car price**. `reserveEur` is money kept for
fees/repairs. `budgetAllInEur = purchaseMaxEur + reserveEur`.

If your total is €7,000:

```text
set reserve = 0
set max car price = 7,000
```

Otherwise a €7,000 car price plus an €800 reserve means an €7,800 all-in
budget.

## Source differences

- **AutoScout24**: supports `pricefrom` / `priceto`, newest sort, pages.
- **AutoUncle**: bucket URL only (`mp-unter-7000-euro`), 25 cards, no
  price-band incremental fetch. It is filtered locally.
- **mobile.de**: email/Firecrawl path; smart coverage will be separate.

## Not yet done

- sold/removed detection (mark stale listings inactive)
- coverage for AutoUncle/mobile.de
- detail refresh for known cards whose description/equipment changed but
  price/mileage did not
- adaptive analysis automatically after fetch (currently the UI button or
  `npm run analyze`)
