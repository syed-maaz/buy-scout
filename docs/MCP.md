# MCP design and roadmap

> **Status: design only.** There is no MCP server in this repository yet. This document is
> the public plan so contributors can review the interface before it is built.

## Why MCP

buy-scout is useful from its local UI and CLI, but the long-term goal is a **generic buying
engine** that an agent can operate with the same evidence and safety rules as a human.

MCP (Model Context Protocol) is the intended integration layer. It lets an agent:

- create or update a structured buying brief,
- run a fetch against enabled sources,
- inspect the ranked candidates and the rule evidence,
- request an analysis or research brief,
- record a decision and an outcome,
- compare candidates without scraping the UI.

The MCP server will call the same core services as the CLI and UI. It will **not** expose
SQLite directly and will **not** let the model bypass rule vetoes.

## Principles

1. **Local-first.** The server runs over stdio on the user's machine.
2. **Tools, not tables.** Agents get typed operations, not raw SQL.
3. **Rules stay authoritative.** `evaluate_listing` returns the deterministic result;
   `analyze_listing` can only add prose and questions.
4. **Least privilege.** Read-only tools are separate from write tools.
5. **No credential leakage.** API keys stay in the server environment; they are never
   returned in tool results or written into prompts.
6. **Explicit side effects.** Fetching, saving, hiding and recording outcomes are separate
   tools with clear descriptions.
7. **Generic contracts.** The tool layer is category-neutral; the car pack supplies the
   current evaluation and extraction rules.

## Planned tools

| Tool | Kind | Purpose |
|---|---|---|
| `search_brief` | read/write | Create, read or update the structured buying brief and its version |
| `run_fetch` | write | Fetch matching listings from enabled sources; returns a job or summary |
| `fetch_status` | read | Poll a fetch job |
| `list_candidates` | read | Return the ranked shortlist with verdict, score and reasons |
| `evaluate_listing` | read | Deterministic evaluation for one `(source, externalId)` |
| `get_listing` | read | Full normalised listing, price history and stored analysis |
| `analyze_listing` | write | Generate or refresh the LLM analysis for one listing |
| `research_listing` | write | Generate or refresh deep research for one listing |
| `compare_candidates` | read | Side-by-side comparison of two or more listings |
| `record_action` | write | Save inspect / watch / skip / saved |
| `record_outcome` | write | Record bought / sold / rejected / inspection failed |
| `import_listing_url` | write | Import one listing URL |
| `health` | read | Source registry, database health and active criteria version |

Read-only tools should be exposed by default. Write tools should be opt-in via server
configuration, for example:

```text
BUY_SCOUT_MCP_ALLOW_WRITE=0   # default
BUY_SCOUT_MCP_ALLOW_FETCH=0   # default
```

## Proposed schemas

The exact schemas will be defined with Zod and published in the MCP server package. The
minimum shapes:

```text
search_brief
  category: string
  budget: { purchaseMaxEur, reserveEur, allInEur }
  location: { zip, radiusKm }
  hard: { ...category-specific... }
  preferences: { prioritise: string[] }
  evidence: { requiredFields: string[] }

list_candidates
  filters?: { verdict?, source?, maxDistanceKm?, includeUnavailable? }
  limit?: number
  → { items: [{ listing, evaluation, analysis?, research? }], summary }

evaluate_listing
  source: string
  externalId: string
  → { listing, evaluation }

record_outcome
  source: string
  externalId: string
  outcome: "bought" | "sold" | "rejected_after_viewing" | "too_far" |
           "inspection_failed" | "other"
  notes?: string
```

## Generic category contract

The car pack is the first implementation of a category contract. The planned shape is:

```text
CategoryPack
  id
  label
  briefSchema          validation for hard/soft criteria
  normalise(raw)       source-specific raw → common item
  hardGates(item)      deterministic vetoes
  evidence(item)       fields that must be known before a decision
  score(item)          family/deal/age/mileage/distance components
  explain(item)        rule reasons
  research(item)       optional category-specific brief
```

A second category pack (for example bicycles or laptops) is the proof that the core is
actually generic. Until that exists, “generic” is a design goal, not a claim.

## Transport and runtime

- Transport: stdio, one process per client.
- Runtime: Node.js 24+, same repository, `npm run mcp`.
- Storage: the same local SQLite database, opened through the db layer.
- Authentication: none; local process trust.
- Logging: stderr only; stdout is reserved for protocol messages.
- Network: only the existing source/LLM adapters make outbound requests.

## Safety boundaries

- The MCP server must never return `.env`, API keys or raw database rows.
- The MCP server must never expose an arbitrary SQL query tool.
- `analyze_listing` and `research_listing` must not change a rule verdict.
- `record_outcome` must require an existing decision.
- A source-confirmed `gone` may hide a listing; `unknown` may not.
- Fetching is opt-in and rate-limited by the existing adapters.

## Delivery phases

1. **Design review** — this document, tool schemas, threat model.
2. **Read-only server** — health, criteria, list, get, evaluate, compare.
3. **Analysis tools** — analyze, research, with explicit write opt-in.
4. **Decision tools** — action, save, outcome.
5. **Fetch tools** — run fetch and poll status, opt-in.
6. **Generic pack** — extract the contract and add a second category.
7. **Client examples** — documented examples for Claude/Codex/other MCP clients.

## Non-goals for the first release

- hosted multi-user MCP service
- remote code execution
- unrestricted browser automation
- sending messages to sellers
- bypassing source terms or anti-bot controls
- replacing an inspection or legal advice

## Contributing to the design

Open an issue with the `mcp` label if you want to challenge the tool boundary, the schemas
or the safety model. The design is intentionally public before implementation.
