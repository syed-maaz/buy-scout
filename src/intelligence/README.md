# Intelligence Layer

## Overview

Interpretation on top of the rule engine: candidate selection for expensive analysis,
LLM-backed and deterministic listing analysis, variant research with an optional web
search, seller-message drafting, Laya local-model triage, and preference learning from
saved cars. Every model call has a deterministic fallback, so the pipeline produces
prose and questions with no API keys configured.

## Interface

- `selection.ts`: `ScoredListing` (`:4`), `AnalysisSelection` (`:9`),
  `selectAnalysisCandidates(brief, scored, overrides?)` (`:18`).
- `analyst.ts`: `ListingAnalysis` (`:13`), `fallbackAnalysis(listing, evaluation)` (`:36`),
  `analyzeListing(listing, evaluation)` (`:67`). Schema is module-private (`AnalysisSchema`,
  `:5`): `summary`, `contradictions`, `questions`, `negotiation`, `risk_notes`.
- `research.ts`: `ResearchSource` (`:5`), `CommonProblem` (`:10`),
  `ListingResearch` (`:40`), `researchListing(listing, evaluation)` (`:272`).
  Module-private: `ResearchPayloadSchema` (`:18`), `VW_SOURCES` (`:55`),
  `variantProblems` (`:65`), `fallbackResearch` (`:178`), `firecrawlSearch` (`:251`).
- `message.ts`: `MessageLanguage` (`:5`), `SellerMessage` (`:7`),
  `detectAdLanguage(listing)` (`:22`),
  `generateSellerMessage(listing, evaluation, research, requested = "auto")` (`:135`).
- `laya.ts`: `layaEnabled()` (`:7`), `getLaya()` (`:11`), `LayaClassification` (`:25`),
  `classifyListingWithLaya(listing, evaluation)` (`:96`),
  `characteriseNeedWithLaya(brief)` (`:157`).
- `learning.ts`: `SavedPreferenceSuggestion` (`:5`), `SavedLearningResult` (`:13`),
  `savedPreferenceSuggestions(db, brief)` (`:35`),
  `applySavedPreferences(db)` (`:70`).
- No subdirectories.

## Invariants

- **Rules own the verdict; models only annotate.** `analyzeListing` receives the
  `CarEvaluation` and never changes `verdict` or `score`; Laya is explicitly advisory
  ("A confident Laya answer must not remove the buyer's only prose explanation", see
  `src/cli/analyze.ts:55`).
- **Every LLM path degrades to a deterministic result** instead of throwing: missing key,
  network error, non-OK response, unparsable JSON or schema failure all return
  `fallbackAnalysis` / `fallback` (`analyst.ts:111`–`analyst.ts:138`,
  `research.ts:325`–`research.ts:343`).
- **`fallbackAnalysis.model` is the literal `"deterministic-fallback"`** and `source` is
  `"fallback"`; successful calls report `source: "llm"`, the provider and the served model
  (`analyst.ts:56`–`analyst.ts:57`, `analyst.ts:132`–`analyst.ts:133`).
- **Analysis selection excludes rejects first**, then applies score/confidence thresholds,
  sorts by score descending, and caps at `maxCards` clamped to 1–100
  (`selection.ts:26`–`selection.ts:34`).
- **The analysis cap is a safety cap, not top-N**: `considered` reports the eligible
  total and `reason` states both numbers (`selection.ts:38`–`selection.ts:41`).
- **Missing brief settings are defaulted locally** to `{minScore: 60, minConfidence: 0.6,
  maxCards: 30}` rather than read from an undefined field (`selection.ts:23`).
- **Research drops hallucinated sources**: when a web search returned results, only those
  URLs are kept; otherwise the model's `sources` are used only if non-empty, else the
  static knowledge base (`research.ts:336`, `research.ts:244`).
- **`researchBasis` is an explicit provenance enum**: `"web+model"`, `"model_knowledge"`
  or `"rules_only"` (`research.ts:50`).
- **Variant knowledge is bounded**: `variantProblems` returns at most 6 problems and only
  fires on recognised names (Passat, Polo, Golf/Jetta/Touran), on diesel, on automatic,
  above 150,000 km, or before 2012 (`research.ts:71`–`research.ts:175`).
- **`researchListing` always awaits the web search before deciding to call a model**, and
  still returns the web sources when no key is configured (`research.ts:279`–`research.ts:282`).
- **Laya is loaded once**: the module keeps a single `let instance` promise and reuses it,
  so `Laya.load` runs at most once per process (`laya.ts:5`, `laya.ts:12`–`laya.ts:22`).
- **`layaEnabled()` treats anything except `"0"` as enabled**
  (`process.env.LAYA_ENABLED !== "0"`, `laya.ts:8`).
- **Laya defers when unsure**: `deferToDeepSeek` is true if mean confidence < 0.45 or
  action confidence < 0.3, and the provisional calibration is documented as such
  (`laya.ts:129`).
- **Laya failures are non-fatal**: any throw returns `enabled: false` with the error
  message in `reason` (`laya.ts:142`–`laya.ts:153`).
- **Language decision is explicit**: `detectAdLanguage` scores German vs English word
  lists, adds 4 for umlauts, and defaults to `"de"` (`message.ts:22`–`message.ts:28`);
  `generateSellerMessage` prefers the requested language over the detected one
  (`message.ts:142`).
- **Generated messages carry a template model id** `"rules+research-template"` — they are
  not LLM output (`message.ts:150`).
- **Messages never claim verified facts**: the fixed question list asks for VIN, HU/AU,
  service history and owner count rather than asserting them (`message.ts:71`–`message.ts:78`).
- **Learning requires at least 2 saved cars** and otherwise returns `applied: false` with
  an explanatory message (`learning.ts:73`–`learning.ts:81`).
- **A learned preference must dominate**: a value must appear in ≥ 75 % of saved cars
  (`strong`, `learning.ts:60`–`learning.ts:61`) and weight is `min(15, 5 + count * 3)`
  (`learning.ts:56`).
- **Duplicate preferences are never added**: existing `field:value` pairs from the active
  brief are excluded (`learning.ts:48`, `learning.ts:51`).
- **Applying learned preferences writes a new criteria version** through
  `saveCriteria(db, brief, "Family profile")`, which also clears stale analyses
  (`learning.ts:103`).

## Side Effects

- Outbound HTTPS to the DeepSeek chat-completions endpoint
  (`${LLM_BASE_URL}/chat/completions`) with 30 s (analysis) and 60 s (research)
  timeouts (`analyst.ts:94`, `research.ts:311`).
- Outbound HTTPS to `https://api.firecrawl.dev/v1/search` when `FIRECRAWL_API_KEY` is set,
  with a 25 s timeout (`research.ts:255`).
- Dynamic `import("@receptron/laya")` plus `Laya.load` with optional model download and
  cache directory (`LAYA_SUBFOLDER`, `LAYA_REVISION`, `LAYA_CACHE`) (`laya.ts:14`–`laya.ts:19`).
- Reads environment: `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL`,
  `FIRECRAWL_API_KEY`, `LAYA_ENABLED`, `LAYA_SUBFOLDER`, `LAYA_REVISION`, `LAYA_CACHE`
  (`analyst.ts:71`, `analyst.ts:101`, `research.ts:252`, `laya.ts:8`).
- Database reads and writes: `savedPreferenceSuggestions` joins `saved_listings` to
  `listings` (`learning.ts:39`), and `applySavedPreferences` calls `getActiveCriteria`
  and `saveCriteria` (`learning.ts:71`, `learning.ts:103`).
- Wall-clock reads for every `generatedAt` field (`analyst.ts:58`, `research.ts:247`,
  `message.ts:151`).
- No filesystem writes and no logging.

## Verification

- Run: `npm test`
