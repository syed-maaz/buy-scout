# buy-scout

**A local-first buying engine for turning a search brief into a ranked, explained shortlist.**

buy-scout is currently a working prototype for the **German used-car market**: it searches
several marketplaces, normalises the listings into one model, applies deterministic family
and budget rules, ranks the result, and adds an optional LLM/AI analysis layer. It runs on
your own machine. Listings, decisions and credentials stay local.

> **Status:** early public prototype. The car domain works; the generic engine and MCP
> server are the next major milestones. See [Roadmap](#roadmap) and [docs/MCP.md](./docs/MCP.md).
>
> **License:** MIT. **Language:** English | [Deutsch](./README.de.md)

---

## Goal

The long-term goal is a **generic search and buying engine for anything**, not only cars.

You describe what you want in a structured brief:

```text
category        car, bicycle, laptop, apartment, camera, ...
budget          purchase price + reserve
location        postcode + radius
hard criteria   must-haves and exclusions
preferences     what should rank higher
evidence        which fields must be known before a decision
```

The engine then:

1. fetches matching listings from multiple sources,
2. normalises them into one comparable shape,
3. applies deterministic filters and hard vetoes,
4. scores and ranks the remaining candidates,
5. asks for missing evidence instead of guessing,
6. adds an LLM-written analysis and research brief,
7. records the decision and the final outcome,
8. learns from the outcome for the next search.

The car pack is the first complete domain because buying a family car is a real,
high-stakes decision with messy marketplace data. The core is deliberately separated from
the car rules so other categories can be added later.

**Automation is the destination:** a scheduled run should fetch, evaluate, explain and
surface the best options without a human rebuilding the search every day. The current
build already has the batch pieces; scheduling and the MCP interface are the next steps.

---

## What works today

| Area | State |
|---|---|
| AutoScout24 | search, detail enrichment, family fields |
| Kleinanzeigen | search, detail HTML, URL import |
| AutoUncle | Jina Reader with local Chrome fallback, pagination |
| mobile.de | profile-backed page-1 search; saved-search email import; disabled by default |
| Normalisation | one listing model across sources, dedupe, price history |
| Rules | budget, distance, seats, doors, ISOFIX, year, mileage, damage, seller type, red flags |
| Verdicts | `inspect`, `ask`, `watch`, `reject` |
| UI | loopback web UI, criteria editor, filters, analysis, research, decisions, outcomes |
| CLI | fetch, score, analyse, research, health, report, eval, import, labels |
| Local AI | Laya for advisory triage |
| Remote AI | optional OpenAI-compatible LLM (`LLM_*`) for analysis and research |
| Storage | SQLite (WAL), raw snapshots, price history, decisions, outcomes |
| MCP | **design only**, not implemented |

---

## How it works

```text
Search brief
    │
    ▼
Source adapters (parallel, isolated failures)
    │  AutoScout24 · Kleinanzeigen · AutoUncle · mobile.de
    ▼
Raw snapshots + normalised listings + dedupe
    │
    ▼
Deterministic evaluation
    │  hard gates → unknown fields → score → verdict
    ├── reject   hard veto, score 0
    ├── ask      a blocking field is unknown
    ├── watch    passes gates, but score < 65
    └── inspect  passes gates, complete, score >= 65
    │
    ▼
Shortlist + optional Laya triage + optional LLM analysis / research
    │
    ▼
Human decision → saved / contact / inspect / skip / gone
    │
    ▼
Outcome + local learning
```

### Non-negotiable design rules

- **Parsers extract; models explain.** The LLM never invents listing fields.
- **Rules own every veto.** An LLM cannot change a hard gate or the rule verdict.
- **Unknown is not a “no”.** A missing blocking field produces `ask`, never a silent reject.
- **A source failure never kills the run.** Sources run in parallel and fail independently.
- **Raw data is immutable.** Normalised listings are derived and can be rebuilt.
- **Everything local by default.** SQLite, snapshots and credentials stay on the machine.
- **No hidden scraping tricks.** Access methods and source limitations are documented.

The full architecture is in [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md). The exact
verdict logic is in [docs/VERDICTS.md](./docs/VERDICTS.md).

---

## Local API

The UI is a loopback HTTP server at `http://127.0.0.1:8124`. It exposes a small JSON API
used by the browser; it is **not** an authenticated public API.

```bash
npm run ui
# http://127.0.0.1:8124
```

Core read endpoints:

```text
GET  /api/listings
GET  /api/listing?source=...&externalId=...
GET  /api/summary
GET  /api/criteria
```

Core actions:

```text
POST /api/fetch                 start a fetch job
GET  /api/fetch/status          poll the fetch job
POST /api/analyze               start an LLM analysis job
GET  /api/analyze/status        poll the analysis job
POST /api/research              deep research for one listing
POST /api/message               draft a seller message
POST /api/action                inspect | watch | skip
POST /api/save                  toggle saved
POST /api/outcome               record bought / rejected / inspection failed / ...
POST /api/listing/gone          mark gone or sold
POST /api/listing/restore       restore an unavailable listing
POST /api/availability          check the source detail page
POST /api/import-url            import one listing URL
POST /api/criteria              save a new criteria version
POST /api/preferences/learn     derive preference rules from saved decisions
```

Every endpoint, request body, response shape and status code is documented in
**[docs/API.md](./docs/API.md)**.

Security note: the server binds to `127.0.0.1` and rejects cross-origin mutations. Do not
expose it directly to the internet.

---

## AI layer

buy-scout separates three things:

1. **Rules** decide the verdict and score.
2. **Laya** is a small local model used for advisory triage.
3. **The LLM** writes analysis and research prose, and never changes the verdict.

The remote LLM is OpenAI-compatible and optional:

```dotenv
LLM_BASE_URL=https://api.deepseek.com
LLM_MODEL=deepseek-v4.1-flash
LLM_API_KEY=...
LLM_LANGUAGE=en
```

A missing or failing LLM configuration falls back to a deterministic local brief. Laya
works without an API key. See [docs/ANALYSIS.md](./docs/ANALYSIS.md) for the exact request
shape, timeout and fallback rules.

---

## MCP

MCP is the planned integration layer for agents and editors. It is **not implemented yet**;
the design is in **[docs/MCP.md](./docs/MCP.md)**.

The planned server will expose the engine as tools rather than exposing SQLite directly:

```text
search_brief          create / update a structured buying brief
run_fetch             fetch matching listings from enabled sources
list_candidates       ranked shortlist with rule evidence
evaluate_listing      deterministic evaluation for one listing
analyze_listing       optional LLM analysis for one listing
research_listing      optional deep research for one listing
record_action         inspect / watch / skip / save
record_outcome        bought / sold / rejected / inspection failed
compare_candidates    side-by-side comparison
```

The MCP server will be local-first (stdio), reuse the same core services as the CLI/UI,
and keep credentials outside the model context.

---

## Roadmap

### Now — car POC, local-first

- stabilise German source adapters and availability checks
- improve listing extraction and family-field completeness
- make the UI and reports fully bilingual (English/German)
- harden tests and evaluation fixtures

### Next — generic engine + MCP

- extract the category contract from the car pack
- add a second category pack to prove the abstraction
- add the MCP server and tool schemas
- add scheduled runs and notifications
- add pluggable scoring profiles and evidence requirements
- add importers for saved searches, email alerts and CSV/JSON

### Later — production-grade buying engine

- multi-user and hosted mode
- source plugin SDK
- price/availability history and market trends
- human feedback loop and learned ranking
- mobile-friendly UI
- public API with authentication and rate limits

The roadmap is intentionally explicit: the current repository is an early prototype, not a
finished product. See [docs/ROADMAP.md](./docs/ROADMAP.md) for the detailed work list.

---

## Quick start

Requirements: Node.js 24+, npm, macOS/Linux. A local Chrome profile is only needed for
mobile.de.

```bash
git clone https://github.com/syed-maaz/buy-scout.git
cd buy-scout
npm install
cp .env.example .env       # edit locally; never commit .env
npm run typecheck
npm test
npm run ui                 # http://127.0.0.1:8124
```

Useful commands:

```bash
npm run fetch:as24 -- --pages 1 --delay 500
npm run score -- --top 20
npm run analyze
npm run analyze -- --top 10
npm run eval
npm run health
npm run report
npm run import:url -- --url "https://www.kleinanzeigen.de/s-anzeige/..."
npm run import:leads -- --dir ./data/emails
```

The default example brief is a German family-car search: **€7,000 car budget, €800
reserve, 200 km radius**. It is a starting point, not a hard-coded product limit.

Data is written to:

```text
data/
  buy-scout.db
  raw/<source>/<date>/*.html|*.json
```

`data/` and `.env` are ignored by Git.

---

## Contributing

This is currently a **solo-maintained project**. I am building it in public and I welcome
contributions, bug reports and corrections. There is no team and no guaranteed response
time, but useful issues and focused pull requests are very welcome.

Good ways to help:

- report a source that no longer parses, with a redacted HTML sample
- add fixtures for a new listing layout
- improve German/English wording
- add a category pack (bicycle, laptop, apartment, …)
- review the MCP design
- improve tests, docs or accessibility

Before opening a PR:

```bash
npm run typecheck
npm test
```

Please do not commit `.env`, database files, raw listing dumps, API keys, personal data or
scraped content that you do not have permission to redistribute. For source-access issues,
open an issue rather than adding a bypass.

There is no CLA. By contributing, you agree that your contribution is licensed under the
repository's MIT license.

---

## Privacy and safety

- All runtime data is local by default.
- No analytics, tracking or telemetry is built in.
- `.env`, `data/`, local memory and internal review notes are excluded from the public tree.
- The LLM sees only the normalised listing and rule result, not your API keys.
- A listing is hidden only when the source confirms it is gone, or when you mark it gone.
- This tool does not replace an inspection, HU/AU report, VIN check or legal advice.

---

## License

MIT © 2026 Syed Muhammad Maaz Bin Muzaffar. See [LICENSE](./LICENSE).

---

## Deutsch

Die vollständige deutsche Beschreibung steht in **[README.de.md](./README.de.md)**.

Kurzfassung: **buy-scout** ist eine lokale Such- und Kaufentscheidungs-Engine. Aktuell ist
sie auf den **deutschen Gebrauchtwagenmarkt** spezialisiert: Sie durchsucht mehrere
Plattformen, normalisiert die Inserate, prüft harte Kriterien, sortiert die Kandidaten,
markiert fehlende Angaben als Rückfrage und ergänzt eine optionale KI-Analyse. Das Ziel ist
eine **generische Engine für beliebige Produkte und Kategorien**: Kriterien eingeben,
Quellen automatisch durchsuchen, Kandidaten bewerten und Entscheidungen dokumentieren.

Die Regeln behalten immer das letzte Wort. Die KI erklärt nur. Alles läuft lokal; Daten und
Zugangsdaten bleiben auf dem eigenen Rechner. Das Projekt ist **Open Source unter MIT** und
wird derzeit allein entwickelt. Beiträge, Fehlerberichte und Korrekturen sind willkommen.
