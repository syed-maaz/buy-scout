# buy-scout Blueprint

## System Overview

A buy-side search, normalisation, shortlist and decision engine. Car-first POC for
Wiesloch 69168, the configured all-in budget and a family of four.

The product thesis is a generic core with a car domain pack: search brief → source
adapters → normalised item → family/domain filters → score → shortlist → contact →
outcome → memory. N sources run in parallel; a blocked source is reported, never fatal.
Parsers own extraction, DeepSeek analyses rather than extracts, Laya is advisory and
rules own every veto.

### Principles

- **N sources run in parallel.** No first/second/third priority. `runSources()` uses
  `Promise.allSettled`; one blocked source never holds back the rest.
- **FETCH → PROCESS → ANALYZE → PROPOSE.** Raw snapshots are immutable; normalized
  listings are derived; decisions reference both.
- **Deterministic extraction.** Parsers own fields. DeepSeek does **not** extract; it
  analyses normalised listings.
- **Laya is advisory triage; DeepSeek is analysis-only.** Laya is on by default for CLI
  `fetch`, `analyze`, `daily` and `laya:classify`, and classifies family fit/risk/action/
  deal; it loads local weights on first use. It never changes a rule verdict and never
  suppresses the explanation. `--no-laya` disables it per run, `LAYA_ENABLED=0` globally.
  The UI's **Fetch now** runs `fetch:report` with `--no-laya`, and the UI analysis endpoint
  does not call Laya.
- **Rules own all vetoes.** Budget, distance, seats, doors, ISOFIX presence, year,
  mileage, damage, seller type and red flags are deterministic. HU/VIN are pre-purchase
  checks, not implemented gates.
- **Filter integrity is a first-class check.** A 200 response with 774k cars is a failed
  run, not a success.
- **Memory is local.** Observations, decisions, outcomes, priors and rule cards live in
  the same SQLite database; recall is not wired yet.
- **The public snapshot excludes local state.** `.claude/`, `MEMORY.md`, `reviews/`,
  `data/` and `.env` are deliberately ignored. The published tree is source, tests,
  public documentation and configuration examples only.

### Status

| Source | Status |
|---|---|
| AutoScout24 | working: search + detail enrichment + family gates |
| Kleinanzeigen | working: direct search + detail HTML |
| AutoUncle | working: Jina Reader with local Chrome fallback; paginated |
| mobile.de | page-1 search works only with a supplied Chrome profile; saved-search email import supported; source disabled by default |
| Kleinanzeigen | working: direct search + detail HTML; URL import for listings outside the paged index |

Current state is generated, not copied: run `npm run health`, `npm run eval`, and
`npm test`. The active criteria are v18 (€7,000 car cap + €800 reserve, 200 km).

Laya runs locally. The analysis provider is optional and OpenAI-compatible:
`LLM_PROVIDER`, `LLM_BASE_URL`, `LLM_MODEL` and `LLM_API_KEY` select DeepSeek, OpenAI,
OpenRouter, Ollama or a custom endpoint. Without a usable provider the analysis path
returns the deterministic German fallback and labels it as such. Legacy `DEEPSEEK_*`
variables still work. `.env` is loaded at
startup for the UI and the main CLIs; shell exports take precedence.

> The `sources` table is the switch. Only enabled adapters are constructed. Direct
> Kleinanzeigen access is experimental: its terms require written consent for crawlers,
> so the saved-search email is the compliant route.

### Quickstart

```bash
npm install
cp .env.example .env      # optional local config; never commit .env
npm run typecheck
npm test
npm run fetch:as24 -- --pages 1 --delay 500
npm run fetch:as24 -- --source mobile_de --pages 1   # requires BUY_SCOUT_CHROME_PROFILE
npm run import:url -- --url "https://www.kleinanzeigen.de/s-anzeige/..."
npm run import:leads -- --dir ./data/emails
npm run score -- --top 20
npm run analyze          # all qualifying cards (score + confidence)
npm run labels:export    # 50-car label CSV
npm run labels:score     # precision@10 once labelled
npm run analyze -- --top 10   # optional manual override
npm run eval
npm run health
npm run playbook -- --symptom cloudflare
npm run report
npm run reparse -- --limit 5   # rebuild from stored AutoScout24 pages
npm run intake -- --title "VW Passat" --url https://... --price 6500 --mileage 150000 --year 2013 --seats 5 --doors 5 --isofix yes --body Kombi --zip 69168
npm run ui          # http://127.0.0.1:8124
```

`--no-details` skips detail enrichment (faster, but family fields become unknown and
verdicts become `ask`).

Data lands in:

```text
data/
  buy-scout.db
  raw/autoscout24/YYYY-MM-DD/*.html
  raw/autoscout24/YYYY-MM-DD/listings/*.json
```

Useful flags:

```bash
npm run fetch:as24 -- --max 7000 --zip 69168 --radius 200
```

## Subdirectories & System Boundaries

- [src](./src/README.md) — engine source tree: CLI/UI entrypoints over core, domain,
  sources, intelligence, report and db; db is the only SQL boundary.
- [website](./website/README.md) — Docusaurus documentation site and landing page;
  presentation only, no domain logic.
- [scripts](./scripts/README.md) — manual, out-of-pipeline probes and an offline
  AutoUncle parser; never invoked by the daily run.

`tests/`, `docs/` and `data/` are not source-contract directories:
`tests/` is consumed by `npm test`, `docs/` is the canonical prose set, and `data/` is
generated runtime state. The `design-system/` tree is a design artifact, not application
source. Internal review notes, agent state and the private memory file are excluded from
the public snapshot.

## Global Invariants

- **Rules decide, models annotate.** `evaluateCar` owns the verdict; DeepSeek and Laya
  may add prose and questions, never a different verdict or score.
- **`null` means unknown, never zero.** Unknown never hides or rejects a car; it produces
  verdict `ask` instead.
- **One distance tolerance** (`max(5, ceil(radius * 0.05))` km) is shared by source
  filtering, integrity checks and evaluation.
- **Listing identity is `(source, external_id)`**, and only `src/db` enforces it.
- **A source failure must never stop the pipeline.** Only a source-confirmed 404/410 or
  explicit gone page retires a listing; unknown never hides a car.
- **Criteria changes invalidate derived analyses**, enforced transactionally in
  `saveCriteria`.
- **Fetch and analysis are separate.** Saving criteria re-scores on read and clears cached
  analyses; it never fetches. A fetch never changes the active criteria version.

## Global Side Effects

- A single SQLite database (default `./data/buy-scout.db`) with WAL journaling and
  foreign keys enabled.
- The `./data/raw/**` tree of byte-exact search and detail captures, plus JSON/HTML/CSV
  artifacts written by the CLI.
- Outbound HTTPS to AutoScout24, Kleinanzeigen, AutoUncle (Jina Reader or local Chrome),
  mobile.de (only with a supplied browser profile), the DeepSeek chat-completions API
  when configured, and the Firecrawl search API when configured.
- A loopback HTTP listener on `127.0.0.1:8124` (override with `UI_PORT`) that can spawn
  the fetch pipeline as a child process.
- The Docusaurus build writes `website/build/` and `website/.docusaurus/`; `docs:sync`
  deletes and recreates `website/docs`.

## System Verification

- Run: `npm test` (the repository test suite; currently `tsx --test tests/*.test.ts`).
- Run: `npm run typecheck` for the TypeScript build.
- Run: `npm run docs:build` for the documentation site.
- Run: `npm run health` for current source/database state; it prints the active criteria
  version and exits non-zero when the database is not healthy.

## License

MIT © 2026 Syed Muhammad Maaz Bin Muzaffar. See [LICENSE](./LICENSE).
