# Local API reference

buy-scout exposes a small JSON API for its loopback web UI. It is **not** a public,
authenticated API and it is not intended to be exposed to a network.

```text
Base URL:  http://127.0.0.1:8124
Server:    src/ui/server.ts
Data:      SQLite at data/buy-scout.db (configurable via DB_PATH)
```

The UI is `GET /`. The JSON endpoints live under `/api`.

## Security model

- The server binds to `127.0.0.1` by default.
- Mutating requests (`POST`, `DELETE`) are rejected unless the request passes the local
  origin check.
- There is no user authentication. Do not port-forward or reverse-proxy this server onto
  the public internet.
- API keys, `.env` and the database are never returned by the API.
- The API can spawn fetch/analysis jobs and write decisions. Treat access to port 8124 as
  equivalent to local shell access to the project.

## Conventions

- Request and response bodies are JSON unless noted.
- `content-type: application/json` is required for JSON request bodies.
- Errors use:

```json
{ "error": "human-readable message" }
```

- Successful mutations generally use `200`; a new background job uses `202`.
- Missing or invalid required fields use `400`.
- A missing listing uses `404`.
- A conflicting running job uses `409`.

## Listing identity

Every listing is identified by the pair:

```text
(source, externalId)
```

Example:

```json
{ "source": "autoscout24", "externalId": "df5f385c-bf6a-4236-aa6a-7383295be6cb" }
```

## Normalised listing

The API returns the internal normalised listing. Important fields:

```json
{
  "source": "autoscout24",
  "externalId": "...",
  "url": "https://...",
  "title": "Peugeot 2008 110 Automatik",
  "priceEur": 6999,
  "currency": "EUR",
  "make": "Peugeot",
  "model": "2008",
  "variant": "110 Automatik",
  "firstRegistration": "2016-01",
  "mileageKm": 92000,
  "fuel": "Benzin",
  "transmission": "Automatik",
  "bodyType": "SUV",
  "seats": 5,
  "doors": 4,
  "hasIsofix": true,
  "sellerType": "dealer",
  "city": "Frankfurt",
  "distanceKm": 90,
  "priceLabel": "top-price",
  "priceMedianEur": 9700,
  "damaged": false,
  "commercialOnly": false,
  "huDue": "2027-11",
  "description": "...",
  "equipment": ["..."],
  "redFlags": [],
  "firstSeenAt": "2026-11-23T...",
  "lastSeenAt": "2026-11-23T...",
  "delistedAt": null
}
```

`null` means **unknown**, not zero and not “no”.

## Evaluation

A listing evaluation contains the deterministic rule result:

```json
{
  "verdict": "inspect",
  "hardPass": true,
  "hardFailures": [],
  "unknowns": [],
  "score": 100,
  "confidence": 1,
  "reasons": ["passes hard gates", "strong family fit"],
  "preferenceBoost": 10,
  "components": {
    "family": 1,
    "deal": 1,
    "age": 1,
    "mileage": 1,
    "distance": 1,
    "evidence": 1,
    "preference": 10
  }
}
```

Verdicts:

| Verdict | Meaning |
|---|---|
| `inspect` | passes gates, complete, score >= 65 |
| `ask` | passes gates, but a blocking field is unknown |
| `watch` | passes gates, complete, score < 65 |
| `reject` | hard gate failure; score 0 |

## Read endpoints

### `GET /api/listings`

Returns the projected list, summary, filters and paging data used by the UI.

Query parameters are the UI filters (for example verdict, source, make, model, search,
include-unavailable). See `list()` in `src/ui/server.ts` for the current set.

### `GET /api/summary`

```json
{ "summary": { "worthViewing": 166, "askSeller": 315, "watching": 11 } }
```

The exact fields follow the UI summary projection.

### `GET /api/listing?source=...&externalId=...`

Returns one listing with:

```json
{
  "listing": {},
  "evaluation": {},
  "action": null,
  "analysis": null,
  "laya": null,
  "research": null,
  "message": null,
  "saved": false,
  "outcome": null,
  "priceHistory": [],
  "priceChange": null
}
```

`analysis`, `laya`, `research`, `message` and `outcome` are `null` until generated or
recorded.

### `GET /api/criteria`

Returns the active criteria, its version and all stored versions.

```json
{
  "brief": {},
  "version": 18,
  "versions": []
}
```

## Background jobs

Fetch and analysis are asynchronous.

### `POST /api/fetch`

Starts the saved criteria fetch pipeline.

```json
{ "job": { "status": "running", "id": "fetch-..." } }
```

Returns `202`. If a fetch is already running, returns `409`.

### `GET /api/fetch/status`

```json
{
  "job": {
    "id": "fetch-...",
    "status": "running|done|error",
    "log": ["...last 30 lines..."]
  }
}
```

### `POST /api/analyze`

Starts analysis for qualifying cards.

```json
{
  "minScore": 60,
  "minConfidence": 0.6,
  "maxCards": 30
}
```

All fields are optional. Returns `202` and a job. A second analysis returns `409` while one
is running.

### `GET /api/analyze/status`

```json
{
  "job": {
    "status": "running|done|error",
    "analyzed": 1,
    "considered": 823,
    "maxCards": 1,
    "error": null
  }
}
```

The analysis job writes to `listing_analyses`. The stored `model` field distinguishes an
LLM result from `deterministic-fallback`.

## Single-listing actions

### `POST /api/research`

```json
{ "source": "autoscout24", "externalId": "..." }
```

Runs deep research synchronously. It can take 30–60 seconds with an LLM. The result is
stored and returned:

```json
{
  "research": {
    "summary": "...",
    "goodPoints": [],
    "badPoints": [],
    "commonProblems": [],
    "inspectionChecklist": [],
    "sellerQuestions": [],
    "negotiation": [],
    "recalls": [],
    "sources": [],
    "researchBasis": "web+model|model_knowledge|web+rules",
    "provider": "llm",
    "model": "...",
    "generatedAt": "..."
  },
  "saved": false
}
```

### `POST /api/message`

```json
{ "source": "...", "externalId": "...", "language": "auto|de|en" }
```

Generates a seller-message draft. `auto` follows the language of the listing. This is the
one place where German output is intentional even when `LLM_LANGUAGE=en`, because the
message is written to a German seller.

### `POST /api/action`

```json
{ "source": "...", "externalId": "...", "action": "inspect|watch|skip", "note": "optional" }
```

Records the latest user action.

### `DELETE /api/action`

Same identity fields; clears the latest action.

### `POST /api/save`

```json
{ "source": "...", "externalId": "...", "note": "optional" }
```

Toggles the saved flag.

### `POST /api/outcome`

```json
{
  "source": "...",
  "externalId": "...",
  "outcome": "bought|sold|rejected_after_viewing|too_far|inspection_failed|other",
  "notes": "optional"
}
```

Requires an existing decision for the listing; otherwise `409`.

### `POST /api/listing/gone`

Marks a listing as gone/sold by the user. It disappears from the active list but can be
restored under “Show unavailable”.

```json
{ "source": "...", "externalId": "..." }
```

### `POST /api/listing/restore`

Restores a user-marked or source-confirmed unavailable listing.

### `POST /api/availability`

Checks the source detail page when the adapter supports it.

```json
{ "status": "available|gone|unknown", "listing": {} }
```

Only a source-confirmed `gone` retires the listing; `unknown` never hides it.

## Criteria and import

### `POST /api/criteria`

```json
{ "brief": { "category": "car", "...": "..." }, "name": "Family profile" }
```

Validates and saves a new criteria version. Saving re-scores listings on read and clears
stored analyses. It never fetches. Returns `409` if a fetch is running.

### `POST /api/import-url`

```json
{ "url": "https://www.kleinanzeigen.de/s-anzeige/..." }
```

Imports one listing URL, writes it, evaluates it and returns:

```json
{
  "listing": {},
  "evaluation": {},
  "fetchedVia": "...",
  "warnings": []
}
```

### `POST /api/preferences/learn`

Derives preference rules from saved decisions. Returns the updated preferences.

## CLI equivalents

The CLI uses the same core services and is the preferred path for automation:

```bash
npm run fetch:as24
npm run score
npm run analyze
npm run health
npm run report
npm run eval
npm run import:url -- --url ...
npm run import:leads -- --dir ./data/emails
```

See [OPERATIONS.md](./OPERATIONS.md) for commands and environment variables.

## What the API is not

- It is not a multi-user API.
- It has no authentication or rate limiting.
- It does not expose raw SQLite access.
- It does not guarantee that an external source is available or legally usable.
- It does not send messages to sellers; it only drafts them.

## MCP

The planned MCP server will provide a typed tool interface over the same services rather
than exposing this loopback HTTP API to agents. See [MCP.md](./MCP.md).
