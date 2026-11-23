# website/src/pages

## Overview

React page modules for the buy-scout Docusaurus site. Docusaurus maps each
`src/pages/*.tsx` file to a route by filesystem path, so `index.tsx` is the
site landing page at `/`. The page is a static marketing/summary page: it
renders the site title and tagline from `useDocusaurusContext()` and links into
the generated documentation tree. It contains no data fetching, no state, and
no buy-scout application logic.

## Interface

- `index.tsx` — `export default function Home(): ReactNode`, the page component
  for route `/`. It renders `Layout` from `@theme/Layout` with
  `title={siteConfig.title}` and `description={siteConfig.tagline}`, read from
  `useDocusaurusContext().siteConfig`.
- `index.tsx` — internal (non-exported) helper `Feature({ title, children })`,
  which renders one card in a `col col--4` column: `<h3>{title}</h3>` plus
  `<p>{children}</p>` inside `div.feature-card`.
- `index.tsx` — internal call-to-action links rendered with `@docusaurus/Link`:
  `to="/docs/intro"` (button "Read the documentation") and
  `to="/docs/architecture"` (button "Architecture").
- `index.tsx` — six `Feature` instances in two `.row` groups: Smart fetch,
  Explainable decisions, Reusable playbook, Family-car POC, Operator first,
  Designed to generalize.
- `index.module.css` — CSS module defining `.heroBanner`. Exported as the
  `styles` object and imported by `index.tsx`, but no `styles.*` reference
  exists in the current page body.
- Child contracts: none (`src/pages` has no subdirectories).
- Parent contract: [`../README.md`](../README.md) (`website/src`).

## Invariants

- `index.tsx` must keep a **default export** named `Home`; Docusaurus derives the
  route `/` from the filename `index`, so renaming or moving the file changes
  the landing URL.
- The hero and card styling comes from **global** classes, not the CSS module:
  `hero hero--primary`, `hero__title`, `hero__subtitle`, `button`, `row`,
  `col col--4`, and `.feature-card`, with the gradient declared in
  `src/css/custom.css` under `.hero--primary`. Do not assume
  `index.module.css` styles the hero — `.heroBanner` is currently unreferenced
  and removing it changes nothing visually.
- `styles` is imported but unused; the `clsx` helper is what composes the global
  class strings. Keep the class names in sync with `src/css/custom.css` if
  either side is edited.
- Each `.row` holds exactly three `Feature` cards because every card claims
  `col--4` (one third of the 12-column grid). A fourth card in the same row
  wraps to the next line.
- `Layout` must receive `title`/`description`; omitting them drops the page
  `<title>` and meta description that `docusaurus.config.ts` supplies through
  `siteConfig`.
- The two CTA targets must exist as docs in the synced `website/docs` copy
  (`intro`, `architecture` in `sidebars.ts`). `onBrokenLinks: "warn"` in
  `docusaurus.config.ts` means a stale target warns at build time rather than
  failing it.
- Page text is descriptive only; it must not state counts or verdict numbers —
  those are produced by `npm run health` / `npm run eval`, as the Family-car POC
  card itself notes.

## Side Effects

- `None` at runtime: the page performs no network calls, no filesystem or
  `localStorage` access, and no timers; it is statically rendered at build time.
- Build-time effects only: rendering `Home` emits `website/build/index.html`
  through the Docusaurus build, and the `styles` import keeps
  `index.module.css` on the module graph even though no class from it is
  referenced.

## Verification

- Run: `npm test` from the repository root (buy-scout test suite; does not
  exercise this page).
- Run: `npm run docs:build` from the repository root to compile the site and
  catch broken JSX, missing imports, or unresolved CTA targets.
