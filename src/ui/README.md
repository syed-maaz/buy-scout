# Local Web UI

## Overview

A dependency-free `node:http` server plus one self-contained HTML document. `server.ts`
opens the shared SQLite database, serves `index.html` once at startup, and exposes a
small JSON API for shortlist browsing, criteria editing, analysis/research/message
generation, availability checks and user actions. It also owns the only in-process
subprocess: a guarded `npm run fetch:report` job.

`index.html` is a static asset (inline CSS and one inline script) that calls the `/api/*`
routes; it exports no code. Because it is read once at boot, HTML edits require a server
restart.

## Interface

`server.ts` has **no exports** — it starts a server on import. Internal contracts:

- `FetchJob` — `{ id, status: "running" | "done" | "failed", startedAt, finishedAt,
  exitCode, log: string[] }` (`server.ts:50`).
- `startFetch(): FetchJob` (`server.ts:61`), module state `fetchJob` (`server.ts:59`).
- `json(res, status, body)` (`server.ts:108`), `body(req)` (`server.ts:119`),
  `originAllowed(req)` (`server.ts:136`), `httpError(status, message)` (`server.ts:115`),
  `verdictRank(verdict)` (`server.ts:142`), `list(url)` (`server.ts:146`).
- `MAX_BODY_BYTES = 64 * 1024` (`server.ts:113`).

Routes, all bound to `127.0.0.1:${UI_PORT ?? 8124}` (`server.ts:43`, `server.ts:608`):

| Method | Path | Behaviour |
| --- | --- | --- |
| GET | `/` | serves `index.html` (`:267`) |
| GET | `/api/listings` | filtered/sorted shortlist plus facets and summary (`:273`) |
| GET | `/api/summary` | `list(url).summary` only (`:363`) |
| GET | `/api/listing` | one listing with evaluation, analysis, laya, research, message, saved, outcome, price history/change (`:368`) |
| GET | `/api/criteria` | active brief, version and all versions (`:299`) |
| GET | `/api/fetch/status` | current job, log truncated to last 30 lines (`:287`) |
| POST | `/api/fetch` | starts `fetch:report`; 409 if already running (`:278`) |
| POST | `/api/criteria` | validates and saves a new criteria version (`:305`) |
| POST | `/api/analyze` | starts a background analysis job; 202 + job (`:324`) |
| GET | `/api/analyze/status` | current analysis job and progress (`:365`) |
| POST | `/api/availability` | probes one listing at its source (`:398`) |
| POST | `/api/save` | toggles the saved flag (`:436`) |
| POST | `/api/research` | generates and stores variant research (`:451`) |
| POST | `/api/preferences/learn` | applies learned preferences (`:477`) |
| POST | `/api/message` | generates and stores the seller message (`:482`) |
| POST | `/api/outcome` | records a purchase outcome (`:524`) |
| POST | `/api/action` | records `inspect`/`watch`/`skip` (`:576`) |
| DELETE | `/api/action` | clears the user action (`:561`) |
| — | anything else | 404 JSON `{ error: "not found" }` (`:601`) |

## Invariants

- **Binds to loopback only**: `server.listen(port, "127.0.0.1")` (`server.ts:608`).
- **State-changing requests are origin-checked**: any method other than `GET`/`HEAD`
  whose `Origin` header is absent-from-allowlist is rejected with 403; an absent `Origin`
  is allowed so local tooling works (`server.ts:136`–`server.ts:140`, `server.ts:262`–`server.ts:265`).
- **JSON in, JSON out**: a `content-type` without `application/json` yields 415
  (`server.ts:120`–`server.ts:123`).
- **Request bodies are capped at 64 KiB** and rejected with 413 while streaming, before
  parsing (`server.ts:129`).
- **Only one fetch job may exist at a time**: `startFetch` returns the running job
  unchanged, and `POST /api/fetch` answers 409 instead of spawning a second process
  (`server.ts:62`, `server.ts:279`–`server.ts:281`).
- **Criteria cannot change mid-fetch**: `POST /api/criteria` returns 409 while a fetch is
  running (`server.ts:306`–`server.ts:309`).
- **Criteria save failures are 400, not 500**: Zod validation errors are caught and
  surfaced as `{ error: message }` (`server.ts:315`–`server.ts:320`).
- **Analysis is a job, not a held request**: `POST /api/analyze` returns 202 with an
  `AnalysisJob`; `GET /api/analyze/status` reports `running`/`done`/`failed`, progress,
  thresholds and the criteria version. The UI polls instead of waiting for one long HTTP
  request (`server.ts:61`–`server.ts:133`, `server.ts:365`).
- **List reads are projected and deduped**: `/api/listings` uses
  `latestListingsForList`, excludes `raw_json`, joins dependent data in one query, and
  filters through the shared cross-source dedupe before facets and summary.
- **Saved messages reuse existing research**: `/api/message` only calls
  `researchListing` when no stored research exists (`server.ts:496`–`server.ts:507`).
- **Language input is allowlisted**: only `"de"`, `"en"` and `"auto"` survive, anything
  else becomes `"auto"` (`server.ts:508`–`server.ts:510`).
- **Outcome values are allowlisted** to the six `ListingOutcome` members, and a missing
  decision returns 409 rather than a silent success (`server.ts:531`–`server.ts:556`).
- **User actions are allowlisted** to `inspect`/`watch`/`skip` (`server.ts:583`).
- **Unknown listings are 404 for every by-id route** (`server.ts:372`, `server.ts:405`,
  `server.ts:458`, `server.ts:489`, `server.ts:543`, `server.ts:567`).
- **Availability is only supported for adapters in the map**: `autoscout24` and
  `kleinanzeigen`; any other source returns 400 (`server.ts:45`–`server.ts:48`,
  `server.ts:409`–`server.ts:413`).
- **Default sort is verdict-then-score**: `verdictRank` orders `inspect < ask < watch <
  reject`, ties broken by descending score; `newest`, `price_asc`, `price_desc`,
  `mileage` and `year` override it (`server.ts:142`, `server.ts:218`–`server.ts:227`).
- **`includeRejected` is the master filter, but retired rejects stay reachable**: with
  `includeUnavailable=1` a delisted reject is still shown (`server.ts:194`).
- **`riskOnly` means "risky or flagged"**: Laya risk ≥ 1.5 or at least one red flag
  (`server.ts:197`–`server.ts:200`).
- **`isNew` compares `firstSeenAt` against the newest `source_runs.started_at`**, so "new"
  is defined by the latest run, not by a fixed time window (`server.ts:166`–`server.ts:169`,
  `server.ts:187`).
- **Facets come from all items, not the filtered page**: `makes`, `models` (scoped to the
  selected make) and `bodyTypes` are derived from `allItems` (`server.ts:229`–`server.ts:238`).
- **Errors map to their own status**: a thrown object with `status` uses it, everything
  else becomes 500, and the message is returned rather than a stack (`server.ts:602`–`server.ts:605`).

## Side Effects

- Opens the SQLite database at `process.env.DB_PATH ?? "./data/buy-scout.db"` on import
  (`server.ts:42`), inheriting all `openDb` migrations and seeds.
- Reads `./index.html` from disk once at startup and keeps it in memory
  (`server.ts:44`); a missing file is a fatal startup error.
- Binds a listening TCP socket on `127.0.0.1` and logs the URL (`server.ts:608`–`server.ts:611`).
- Spawns a child process for the fetch pipeline: `npm run fetch:report` via
  `process.env.npm_execpath`, else `node_modules/.bin/tsx src/cli/fetch.ts`, with
  `FORCE_COLOR=0`, capturing stdout/stderr into a 120-line ring buffer
  (`server.ts:74`–`server.ts:103`).
- Writes to the database on: criteria save, analysis, availability checks, saved toggles,
  research, learned preferences, seller messages, outcomes and user actions.
- Outbound network traffic through the adapters, DeepSeek and Firecrawl when those routes
  are called.
- Reads `UI_PORT` and `DB_PATH` from the environment (`server.ts:42`–`server.ts:43`).
- No authentication and no TLS; the loopback bind and origin check are the whole
  protection model.

## Verification

- Run: `npm test`
