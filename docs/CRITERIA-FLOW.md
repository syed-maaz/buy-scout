---
id: criteria-flow
title: Criteria & Priorities
sidebar_position: 1
description: buy-scout — Criteria & Priorities
---

# buy-scout — Criteria & Filter Flow

There are **three different things** in the UI, and they behave differently:

| Layer | What it is | Changes score/verdict? | Fetches? | Re-analyzes? |
|---|---|---|---|---|
| **Criteria profile** | Budget, radius, seats, doors, year, km, fuel, gearbox, boot | **Yes** | No | Invalidates analyses |
| **View filters** | Verdict, source, max price, max km, min year, search text | No — display only | No | No |
| **Refresh sources** | Run the fetchers | Uses active criteria | **Yes** | Only when you run Analyze |

## What “Reserve” means

`reserveEur` is **not a filter**. It is money kept back for:

- registration / transfer fees
- insurance and plates
- tyres, brakes, battery
- first repairs and service
- a small buffer for surprises

The only price gate is **`purchaseMaxEur`** (max car price). The all-in budget is:

```text
budgetAllInEur = purchaseMaxEur + reserveEur
```

Example: the active v18 profile is a €7,000 car cap + €800 reserve = **€7,800 all-in**. A €7,100 car is rejected by the €7,000 price gate even though it is under €7,800 all-in — you cannot spend the reserve on the purchase.

## The rule

> **Criteria = decision rules.**  
> **View filters = what you want to look at.**  
> **Fetch = get new listings.**  
> **Analyze = explain the current shortlist.**

## What happens when you save criteria

Example: change the purchase cap from €7,000 to €6,800.

```text
POST /api/criteria
  → validate the new profile
  → transaction:
       deactivate old profile
       insert new version (vN+1)
       DELETE old listing_analyses
  → all stored listings are re-evaluated on the next read
  → UI shows criteria vN+1
```

- **No network fetch.**
- **No source is contacted.**
- Every stored listing is re-scored against the new rules.
- Old AI/fallback analyses are cleared because their questions/reasons may no longer apply.
- User actions (inspect/watch/skip) are **not** cleared; they are your decisions, not the machine's.

## What happens when you change a view filter

Example: select `Inspect` or type `Kia`.

```text
GET /api/listings?verdict=inspect&q=Kia
  → read stored listings
  → evaluate with the active criteria
  → filter/sort for display
```

- **No fetch.**
- **No analysis.**
- **No criteria change.**
- This is just looking at the same data through a narrower window.

## What happens when you fetch new listings

```bash
npm run fetch:as24
# or: npm run daily
```

- Reads the **active criteria profile** from SQLite.
- Runs all enabled sources in parallel.
- New listings are normalized and scored against the active criteria.
- Existing listings are updated with fresh price/mileage/detail data.
- Old analyses remain until criteria change; new listings have no analysis until you run Analyze.

## What happens when you analyze

Analysis is **threshold-based**, not a fixed top 10:

```text
analyze all non-rejected listings where
  score       >= analysis.minScore
  confidence  >= analysis.minConfidence
  count       <= analysis.maxCards   (safety cap)
```

```bash
npm run analyze
# or click “Analyze qualifying cards” in the UI
```

- Reads the active criteria.
- Selects every card that clears **score + confidence**, not an arbitrary top N.
- `maxCards` is only a safety cap; it does not change the threshold.
- Calls DeepSeek if `LLM_API_KEY` is set; otherwise uses the deterministic German fallback.
- Stores the analysis keyed by listing.
- The UI shows summary + questions on the card.
- The criteria panel exposes **Analysis min score**, **Analysis min confidence**, and **Analysis max cards**.
- “Analyze qualifying after save” runs the same selection immediately after saving criteria.

`--top N` still exists as a manual override, but it is not the default.

## Score vs confidence

- **Score** = weighted family/deal/age/mileage/distance/evidence plus priority boost, capped at 100.
- **Confidence** = how much evidence the listing actually contains (0–1). A cheap listing with no seats/doors/ISOFIX has low confidence even if the price is good.
- A card qualifies only if **both** clear their thresholds.

## Why analyses are cleared on criteria change

An analysis answers questions like “is this a good family car at a €7,000 cap?”  
If you change the budget, year, or km cap, that answer may be wrong.  
So the POC **invalidates** all analyses on criteria save and asks you to re-run the top N. This is safer than silently showing stale reasoning.

## Priority weights (boost, never filter)

Preferences are a **weighted ranking table** in the active criteria profile:

| Field | Examples |
|---|---|
| `make` | Samsung, Kia, Toyota |
| `model` | Ceed, Corolla |
| `variant` | GT-Line, M Sport |
| `title` | “7-Sitzer”, “Bose” |
| `equipment` | Bose, AHK, Panorama |
| `bodyType` | Kombi, Van |
| `fuel` | Diesel, Benzin |
| `transmission` | Automatik |
| `sellerType` | dealer, private |

Each rule has `label`, `field`, `match` (`contains` / `equals`), `value`, and `weight` (0–25).

- A match adds points to the score: `score = min(100, rawScore + boost)`.
- Total boost is capped at **25** so preferences do not overwhelm the family/deal/age/mileage components.
- Non-matching listings are **not removed**. They stay visible, just lower.
- A preference cannot rescue a hard fail; hard gates still produce `reject` and score `0`.
- UI shows `Priority: Bose (+10)` so you can see why a car moved up.

Examples:

```text
Cars:   equipment contains "Bose"      weight 10
        make equals "Kia"              weight 8
TVs:    make equals "Samsung"          weight 15
        make equals "Huawei"           weight 0   (visible, not preferred)
```

The UI section **Priority weights** is the editor; the active criteria profile stores the table.

## Versioning

- `criteria_profiles` stores every version:
  - `version`, `name`, `criteria_json`, `active`, `created_at`.
- Only one row can be active (partial unique index).
- `getActiveCriteria()` is used by fetch, score, analyze, eval, report, and UI.
- `saveCriteria()` increments the version and clears `listing_analyses`.

## Exact answers to the example

**“I set it to €6,800. Does it just filter or also analyze?”**  
It **re-scores** every stored listing against the €6,800 profile. It does **not** fetch and does **not** automatically run DeepSeek. Old analyses are cleared. Click **Analyze qualifying cards** (or run `npm run analyze`) to refresh them.

**“If I update it now, will it fetch all latest information?”**  
No. Saving criteria is a local re-score. Fetching is a separate action. Use `npm run daily` or the fetch command; it will use the active €6,800 criteria.

**“If I update the filter, will it analyze again?”**  
View filters never analyze. Criteria changes invalidate analyses. Saving criteria can auto-run the threshold selection if **Analyze qualifying after save** is checked; otherwise click **Analyze qualifying cards**.

**“Can I update filters on the go?”**  
Yes. View filters are instant and do not mutate data. Criteria are versioned; every save creates a new profile.

**“Why did it analyze 9 cards, not 10?”**  
Because 9 cards cleared score + confidence. The old “top 10” was arbitrary; now the threshold decides, with `maxCards` only as a safety cap.
