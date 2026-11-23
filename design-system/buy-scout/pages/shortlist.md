# Shortlist page overrides

This page overrides the generic `MASTER.md` recommendation. buy-scout is a working
screening dashboard, not a landing page.

## Direction

- **No hero, no scroll-reveal, no parallax.** The first viewport is the shortlist.
- Dark neutral surface (`#0b0f14`), raised cards (`#141a22`), one blue focus ring.
- Status is always **text + shape + color**, never color alone:
  `INSPECT`, `ASK`, `WATCH`, `REJECT`, `NEW`.
- Price is the only green text; it is the primary comparison value.
- **Density:** 7/10. One card per listing, 47 visible cards before "show rejected".
- **Motion:** 2/10. Only 150–200 ms hover/focus transitions; reduced-motion disables all.

## Type and spacing

| Token | Value |
|---|---|
| Body | 15.5 px / 1.55 |
| Card title | 16 px / 1.35, h2 |
| Metadata | 12.5 px |
| Small labels | 11–12 px, never body copy |
| Page gutter | 22 px desktop, 12 px mobile |
| Card radius | 12 px |
| Control height | 40 px desktop, 44 px mobile |

## Layout

- Static masthead: title, live criteria line, stats, fetch state, disclaimer.
- **Sticky toolbar only** for filters. It is 67 px on desktop and static on mobile.
- Criteria editor stays collapsed; saving is deliberate and confirmed.
- Mobile filters scroll horizontally in one row; no page-level horizontal scroll.
- Cards: 168×112 thumbnail (96×72 mobile) → verdict → NEW → score/confidence → title → price/mileage/year → family fields → reasons → actions.
- Toolbar: sort control, active-filter chips, and a mobile two-column filter drawer.
- Actions: click records immediately; toast offers Undo; notes are edited only on demand.

## Accessibility checks

- [x] Contrast ≥ 4.5:1 for normal text; status chips 5.0–7.6:1.
- [x] `h1` then `h2` per card; no skipped levels.
- [x] Skip link to `#list`; `:focus-visible` 2 px outline.
- [x] Action buttons 40 px desktop / 44 px mobile.
- [x] Filters and action buttons have accessible names.
- [x] `aria-live` on stats, fetch status and criteria message.
- [x] `prefers-reduced-motion` disables transitions and smooth scrolling.
- [x] `NEW` is text, not a color-only dot.
- [x] No emoji icons; no icon-only buttons.

## Anti-patterns rejected

- Full-bleed hero or marketing copy above the shortlist.
- Hover-only actions.
- White text on `#1f9d55` / `#b7791f` badges (3.5:1, fails).
- Sticky 400 px header on mobile.
- Truncated one-line fetch status that hides the current step.
