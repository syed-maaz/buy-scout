# website/src

## Overview

Source subtree for the buy-scout Docusaurus site. It contains no TypeScript
module at this level; it groups two responsibilities: the landing-page route
under `pages/` and the global theme overrides under `css/`. Everything else the
site renders comes from `website/docs`, a build-time copy of the repository's
canonical `docs/` directory, so this directory owns presentation only — no
buy-scout data, scoring, or fetching logic lives here.

## Interface

- [pages](./pages/README.md) — landing page at route `/`; default export `Home`
  from `index.tsx`, backed by `index.module.css`.
- Local asset (no separate contract, CSS-only): `src/css/custom.css` — global
  stylesheet wired into the site through
  `presets[0][1].theme.customCss: "./src/css/custom.css"` in
  `docusaurus.config.ts`. It defines the Infima overrides
  `--ifm-color-primary` (and the dark/darker/light/lighter/lightest ramp),
  `--ifm-code-font-size: 95%`, plus the global selectors `.hero--primary`
  (page gradient), `.hero__subtitle` (max-width 780px, centred),
  `.feature-card` / `.feature-card h3`, and
  `.docusaurus-mermaid-container` (background, radius, padding).
- Parent contract: [`../README.md`](../README.md) (`website`).

## Invariants

- CSS lives here, not in components: `custom.css` is a single global sheet, so
  every rule in it applies site-wide (docs pages included), and specificity
  conflicts with Infima are resolved by declaration order, not by module
  scoping.
- The `customCss` entry in `docusaurus.config.ts` is the only wiring for
  `css/custom.css`. Renaming or moving the file without updating that path
  breaks the theme on build.
- `src/css` is intentionally not a documented contract directory: it contains
  only `.css`, which the EGM source-code filter excludes. Add a contract here
  (and a child link in this section) only if a `.ts`/`.tsx` module is
  introduced under it.
- Class names in `custom.css` are a public contract for page markup — in
  particular `.hero--primary` and `.feature-card` are consumed by
  `pages/index.tsx`. Renaming a selector silently unstyles the landing page
  because CSS class mismatches do not fail the build.

## Side Effects

- `css/custom.css` mutates global CSS state: it overrides Infima custom
  properties at `:root` and injects page-wide selectors, affecting every route
  including generated docs pages and Mermaid diagram containers.
- No runtime side effects in this subtree: pages are statically rendered, with
  no network, storage, or timer access.

## Verification

- Run: `npm test` from the repository root (buy-scout suite; does not exercise
  the site).
- Run: `npm run docs:build` from the repository root — runs `docs:sync` and then
  `docusaurus build`, the only check that actually compiles these styles and
  routes.
