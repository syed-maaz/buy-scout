import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  clearUserAction,
  getActiveCriteria,
  getLayaClassification,
  getListingAnalysis,
  getListingResearch,
  getLatestOutcome,
  getPriceChange,
  getPriceHistory,
  getSellerMessage,
  findListing,
  isListingSaved,
  latestListingsForList,
  latestListingsForSelection,
  latestUserActions,
  listCriteriaVersions,
  markListingAvailable,
  markListingUnavailable,
  openDb,
  recordAvailabilityCheck,
  recordListingOutcome,
  recordUserAction,
  saveCriteria,
  toggleSavedListing,
  updateListingDetail,
  upsertListing,
  upsertListingAnalysis,
  upsertListingResearch,
  upsertSellerMessage,
} from "../db/index.js";
import { dedupeListings } from "../core/dedupe.js";
import { evaluateCar } from "../domain/cars/evaluate.js";
import { analyzeListing } from "../intelligence/analyst.js";
import { researchListing } from "../intelligence/research.js";
import { applySavedPreferences } from "../intelligence/learning.js";
import { generateSellerMessage, type MessageLanguage } from "../intelligence/message.js";
import { selectAnalysisCandidates } from "../intelligence/selection.js";
import { AutoScout24Adapter } from "../sources/autoscout24.js";
import { KleinanzeigenAdapter } from "../sources/kleinanzeigen.js";
import { importListingUrl } from "../sources/url-import.js";

const db = openDb(process.env.DB_PATH ?? "./data/buy-scout.db");
const port = Number(process.env.UI_PORT ?? 8124);
const html = readFileSync(fileURLToPath(new URL("./index.html", import.meta.url)), "utf8");
const availabilityAdapters = new Map<string, AutoScout24Adapter | KleinanzeigenAdapter>([
  ["autoscout24", new AutoScout24Adapter()],
  ["kleinanzeigen", new KleinanzeigenAdapter()],
]);

interface FetchJob {
  id: string;
  status: "running" | "done" | "failed";
  startedAt: string;
  finishedAt: string | null;
  exitCode: number | null;
  log: string[];
}

let fetchJob: FetchJob | null = null;

interface AnalysisJob {
  id: string;
  status: "running" | "done" | "failed";
  startedAt: string;
  finishedAt: string | null;
  analyzed: number;
  considered: number;
  criteriaVersion: number;
  minScore: number;
  minConfidence: number;
  maxCards: number;
  error: string | null;
}

let analysisJob: AnalysisJob | null = null;

function startAnalysis(input: {
  minScore?: number;
  minConfidence?: number;
  maxCards?: number;
}): AnalysisJob {
  if (analysisJob?.status === "running") return analysisJob;

  const job: AnalysisJob = {
    id: `analysis-${Date.now()}`,
    status: "running",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    analyzed: 0,
    considered: 0,
    criteriaVersion: 0,
    minScore: 0,
    minConfidence: 0,
    maxCards: 0,
    error: null,
  };
  analysisJob = job;

  void (async () => {
    try {
      const { brief, version } = getActiveCriteria(db);
      const scored = latestListingsForSelection(db).map((listing) => ({
        listing,
        evaluation: evaluateCar(brief, listing),
      }));
      const selection = selectAnalysisCandidates(brief, scored, {
        minScore: Number.isFinite(input.minScore) ? input.minScore : undefined,
        minConfidence: Number.isFinite(input.minConfidence) ? input.minConfidence : undefined,
        maxCards: Number.isFinite(input.maxCards) ? input.maxCards : undefined,
      });
      job.criteriaVersion = version;
      job.considered = selection.considered;
      job.minScore = selection.minScore;
      job.minConfidence = selection.minConfidence;
      job.maxCards = selection.maxCards;

      for (const { listing, evaluation } of selection.items) {
        const analysis = await analyzeListing(listing, evaluation);
        upsertListingAnalysis(db, {
          source: listing.source,
          externalId: listing.externalId,
          model: analysis.model,
          analysisJson: JSON.stringify({ analysis, laya: null }),
          createdAt: new Date().toISOString(),
        });
        job.analyzed += 1;
      }
      job.status = "done";
      job.finishedAt = new Date().toISOString();
    } catch (error) {
      job.status = "failed";
      job.finishedAt = new Date().toISOString();
      job.error = error instanceof Error ? error.message : String(error);
    }
  })();

  return job;
}

function startFetch(): FetchJob {
  if (fetchJob?.status === "running") return fetchJob;

  const job: FetchJob = {
    id: `fetch-${Date.now()}`,
    status: "running",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    exitCode: null,
    log: [],
  };
  fetchJob = job;

  const npmCli = process.env.npm_execpath;
  const command = npmCli ? process.execPath : join(process.cwd(), "node_modules/.bin/tsx");
  const args = npmCli ? [npmCli, "run", "fetch:report"] : ["src/cli/fetch.ts"];

  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, FORCE_COLOR: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const append = (chunk: Buffer) => {
    for (const line of chunk.toString("utf8").split("\n")) {
      if (!line.trim()) continue;
      job.log.push(line);
      if (job.log.length > 120) job.log.shift();
    }
  };

  child.stdout?.on("data", append);
  child.stderr?.on("data", append);
  child.on("error", (error) => {
    job.status = "failed";
    job.finishedAt = new Date().toISOString();
    job.log.push(`spawn error: ${error.message}`);
  });
  child.on("close", (code) => {
    job.status = code === 0 ? "done" : "failed";
    job.exitCode = code;
    job.finishedAt = new Date().toISOString();
  });

  return job;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

const MAX_BODY_BYTES = 64 * 1024;

function httpError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}

async function body(req: IncomingMessage): Promise<unknown> {
  const contentType = String(req.headers["content-type"] ?? "").toLowerCase();
  if (!contentType.includes("application/json")) {
    throw httpError(415, "content-type must be application/json");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw httpError(413, "request body too large");
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function originAllowed(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  return origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;
}

function verdictRank(verdict: string): number {
  return { inspect: 0, ask: 1, watch: 2, reject: 3 }[verdict] ?? 4;
}

function list(url: URL) {
  const { brief, version } = getActiveCriteria(db);
  const actions = latestUserActions(db);
  const q = (url.searchParams.get("q") ?? "").toLowerCase();
  const verdict = url.searchParams.get("verdict") ?? "";
  const source = url.searchParams.get("source") ?? "";
  const make = url.searchParams.get("make") ?? "";
  const model = url.searchParams.get("model") ?? "";
  const maxPrice = Number(url.searchParams.get("maxPrice") ?? "0");
  const maxKm = Number(url.searchParams.get("maxKm") ?? "0");
  const minYear = Number(url.searchParams.get("minYear") ?? "0");
  const sort = url.searchParams.get("sort") ?? "best";
  const includeRejected = url.searchParams.get("includeRejected") === "1";
  const newOnly = url.searchParams.get("newOnly") === "1";
  const includeSkipped = url.searchParams.get("includeSkipped") === "1";
  const includeUnavailable = url.searchParams.get("includeUnavailable") === "1";
  const riskOnly = url.searchParams.get("riskOnly") === "1";
  const savedOnly = url.searchParams.get("savedOnly") === "1";
  const gearbox = url.searchParams.get("gearbox") ?? "";
  const body = url.searchParams.get("body") ?? "";
  const latestRun = db
    .prepare(`SELECT MAX(started_at) AS latest FROM source_runs`)
    .get() as { latest: string | null };
  const latestRunAt = latestRun.latest;

  const allItems = latestListingsForList(db, 1000, { includeUnavailable })
    .map(({ listing, analysisJson, layaJson, saved, hasResearch }) => {
      const evaluation = evaluateCar(brief, listing);
      const action = actions.get(`${listing.source}:${listing.externalId}`) ?? null;
      return {
        listing,
        evaluation,
        action,
        analysis: analysisJson ? JSON.parse(analysisJson) : null,
        laya: layaJson ? JSON.parse(layaJson) : null,
        saved,
        hasResearch,
        isNew: new Date(listing.firstSeenAt).getTime() >= Date.now() - 7 * 24 * 60 * 60 * 1000,
      };
    });
  const deduped = dedupeListings(allItems.map((item) => item.listing));
  const uniqueKeys = new Set(deduped.unique.map((listing) => `${listing.source}:${listing.externalId}`));
  const items = allItems
    .filter((item) => uniqueKeys.has(`${item.listing.source}:${item.listing.externalId}`))
    .filter(({ listing, evaluation, isNew, action, laya, saved }) => {
      // "Show unavailable" should surface retired cards even when they were
      // rejected; otherwise the toggle appears to do nothing for old rejects.
      if (!includeRejected && evaluation.verdict === "reject" && !(includeUnavailable && listing.delistedAt)) return false;
      if (!includeSkipped && action?.action === "skip") return false;
      if (newOnly && !isNew) return false;
      if (riskOnly) {
        const risk = (laya as { risk?: { score?: number } } | null)?.risk?.score ?? 0;
        if (risk < 1.5 && listing.redFlags.length === 0) return false;
      }
      if (savedOnly && !saved) return false;
      if (verdict && evaluation.verdict !== verdict) return false;
      if (source && listing.source !== source) return false;
      if (make && listing.make !== make) return false;
      if (model && listing.model !== model) return false;
      if (gearbox === "automatic" && !/autom/i.test(listing.transmission ?? "")) return false;
      if (gearbox === "manual" && !/schalt|manuell/i.test(listing.transmission ?? "")) return false;
      if (body && !(listing.bodyType ?? "").toLowerCase().includes(body.toLowerCase())) return false;
      if (maxPrice > 0 && (listing.priceEur ?? Infinity) > maxPrice) return false;
      if (maxKm > 0 && (listing.mileageKm ?? Infinity) > maxKm) return false;
      if (minYear > 0 && Number(listing.firstRegistration?.slice(0, 4) ?? 0) < minYear) return false;
      if (q) {
        const haystack = `${listing.title} ${listing.make} ${listing.model} ${listing.city} ${listing.description}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    })
    .sort((a, b) => {
      if (sort === "newest") return b.listing.firstSeenAt.localeCompare(a.listing.firstSeenAt);
      if (sort === "price_asc") return (a.listing.priceEur ?? Infinity) - (b.listing.priceEur ?? Infinity);
      if (sort === "price_desc") return (b.listing.priceEur ?? -Infinity) - (a.listing.priceEur ?? -Infinity);
      if (sort === "mileage") return (a.listing.mileageKm ?? Infinity) - (b.listing.mileageKm ?? Infinity);
      if (sort === "year") return (b.listing.firstRegistration ?? "").localeCompare(a.listing.firstRegistration ?? "");
      const rank = verdictRank(a.evaluation.verdict) - verdictRank(b.evaluation.verdict);
      if (rank !== 0) return rank;
      return b.evaluation.score - a.evaluation.score;
    });

  const facets = {
    makes: [...new Set(allItems.map((item) => item.listing.make).filter(Boolean))].sort(),
    models: [...new Set(
      allItems
        .filter((item) => !make || item.listing.make === make)
        .map((item) => item.listing.model)
        .filter(Boolean),
    )].sort(),
    bodyTypes: [...new Set(allItems.map((item) => item.listing.bodyType).filter(Boolean))].sort(),
  };

  return {
    items,
    facets,
    criteriaVersion: version,
    summary: {
      total: items.length,
      inspect: items.filter((item) => item.evaluation.verdict === "inspect").length,
      ask: items.filter((item) => item.evaluation.verdict === "ask").length,
      watch: items.filter((item) => item.evaluation.verdict === "watch").length,
      reject: items.filter((item) => item.evaluation.verdict === "reject").length,
      rejectedTotal: allItems.filter((item) => item.evaluation.verdict === "reject").length,
      newTotal: items.filter((item) => item.isNew).length,
      latestRunAt,
      skippedTotal: allItems.filter((item) => item.action?.action === "skip").length,
    },
  };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);

  try {
    if (req.method !== "GET" && req.method !== "HEAD" && !originAllowed(req)) {
      json(res, 403, { error: "cross-origin request rejected" });
      return;
    }

    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/listings") {
      json(res, 200, list(url));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/fetch") {
      if (fetchJob?.status === "running") {
        json(res, 409, { error: "A fetch is already running", job: fetchJob });
        return;
      }
      json(res, 202, { job: startFetch() });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/import-url") {
      const input = (await body(req)) as { url?: unknown };
      if (typeof input.url !== "string" || !input.url.trim()) {
        json(res, 400, { error: "url is required" });
        return;
      }
      const result = await importListingUrl(input.url.trim());
      upsertListing(db, result.listing);
      updateListingDetail(db, result.listing);
      const { brief } = getActiveCriteria(db);
      json(res, 200, {
        listing: result.listing,
        evaluation: evaluateCar(brief, result.listing),
        fetchedVia: result.fetchedVia,
        warnings: result.warnings,
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/fetch/status") {
      json(res, 200, {
        job: fetchJob
          ? {
              ...fetchJob,
              log: fetchJob.log.slice(-30),
            }
          : null,
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/criteria") {
      const active = getActiveCriteria(db);
      json(res, 200, { ...active, versions: listCriteriaVersions(db) });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/criteria") {
      if (fetchJob?.status === "running") {
        json(res, 409, { error: "criteria cannot be saved while a fetch is running" });
        return;
      }
      const input = (await body(req)) as { brief?: unknown; name?: string };
      if (!input.brief) {
        json(res, 400, { error: "brief is required" });
        return;
      }
      try {
        const saved = saveCriteria(db, input.brief as never, input.name ?? "Family profile");
        json(res, 200, { ...saved, analysesCleared: true });
      } catch (error) {
        json(res, 400, { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/analyze") {
      if (analysisJob?.status === "running") {
        json(res, 409, { error: "An analysis is already running", job: analysisJob });
        return;
      }
      const input = (await body(req)) as {
        minScore?: number;
        minConfidence?: number;
        maxCards?: number;
      };
      json(res, 202, { job: startAnalysis(input) });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/analyze/status") {
      json(res, 200, { job: analysisJob });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/summary") {
      json(res, 200, { summary: list(url).summary });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/listing") {
      const source = url.searchParams.get("source") ?? "";
      const externalId = url.searchParams.get("externalId") ?? "";
      const listing = findListing(db, source, externalId);
      if (!listing) {
        json(res, 404, { error: "listing not found" });
        return;
      }
      const { brief } = getActiveCriteria(db);
      const evaluation = evaluateCar(brief, listing);
      const action = latestUserActions(db).get(`${source}:${externalId}`) ?? null;
      const analysisRow = getListingAnalysis(db, source, externalId);
      const layaRow = getLayaClassification(db, source, externalId);
      const researchRow = getListingResearch(db, source, externalId);
      json(res, 200, {
        listing,
        evaluation,
        action,
        analysis: analysisRow ? JSON.parse(analysisRow.analysisJson) : null,
        laya: layaRow ? JSON.parse(layaRow.layaJson) : null,
        research: researchRow ? JSON.parse(researchRow.researchJson) : null,
        message: getSellerMessage(db, source, externalId),
        saved: isListingSaved(db, source, externalId),
        outcome: getLatestOutcome(db, source, externalId),
        priceHistory: getPriceHistory(db, source, externalId),
        priceChange: getPriceChange(db, source, externalId),
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/listing/gone") {
      const input = (await body(req)) as { source?: string; externalId?: string };
      if (!input.source || !input.externalId) {
        json(res, 400, { error: "source and externalId are required" });
        return;
      }
      if (!findListing(db, input.source, input.externalId)) {
        json(res, 404, { error: "listing not found" });
        return;
      }
      markListingUnavailable(db, {
        source: input.source,
        externalId: input.externalId,
        reason: "Marked gone or sold by user",
      });
      json(res, 200, { ok: true, listing: findListing(db, input.source, input.externalId) });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/listing/restore") {
      const input = (await body(req)) as { source?: string; externalId?: string };
      if (!input.source || !input.externalId) {
        json(res, 400, { error: "source and externalId are required" });
        return;
      }
      if (!findListing(db, input.source, input.externalId)) {
        json(res, 404, { error: "listing not found" });
        return;
      }
      markListingAvailable(db, { source: input.source, externalId: input.externalId });
      json(res, 200, { ok: true, listing: findListing(db, input.source, input.externalId) });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/availability") {
      const input = (await body(req)) as { source?: string; externalId?: string };
      if (!input.source || !input.externalId) {
        json(res, 400, { error: "source and externalId are required" });
        return;
      }
      const listing = findListing(db, input.source, input.externalId);
      if (!listing) {
        json(res, 404, { error: "listing not found" });
        return;
      }
      const adapter = availabilityAdapters.get(input.source);
      if (!adapter?.checkAvailability) {
        json(res, 400, { error: "availability checks are not supported for this source" });
        return;
      }
      const status = await adapter.checkAvailability({
        source: listing.source,
        externalId: listing.externalId,
        url: listing.url,
        page: 0,
        payload: {},
      });
      if (status === "gone") {
        markListingUnavailable(db, {
          source: listing.source,
          externalId: listing.externalId,
          reason: `${adapter.label} detail page confirmed gone`,
        });
      } else if (status === "available") {
        markListingAvailable(db, { source: listing.source, externalId: listing.externalId });
      } else {
        recordAvailabilityCheck(db, { source: listing.source, externalId: listing.externalId });
      }
      json(res, 200, { status, listing: findListing(db, listing.source, listing.externalId) });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/save") {
      const input = (await body(req)) as { source?: string; externalId?: string; note?: string | null };
      if (!input.source || !input.externalId) {
        json(res, 400, { error: "source and externalId are required" });
        return;
      }
      const saved = toggleSavedListing(db, {
        source: input.source,
        externalId: input.externalId,
        note: input.note ?? null,
      });
      json(res, 200, { saved });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/research") {
      const input = (await body(req)) as { source?: string; externalId?: string };
      if (!input.source || !input.externalId) {
        json(res, 400, { error: "source and externalId are required" });
        return;
      }
      const listing = findListing(db, input.source, input.externalId);
      if (!listing) {
        json(res, 404, { error: "listing not found" });
        return;
      }
      const { brief } = getActiveCriteria(db);
      const evaluation = evaluateCar(brief, listing);
      const research = await researchListing(listing, evaluation);
      upsertListingResearch(db, {
        source: listing.source,
        externalId: listing.externalId,
        model: research.model,
        basis: research.researchBasis,
        researchJson: JSON.stringify(research),
        createdAt: new Date().toISOString(),
      });
      json(res, 200, { research, saved: isListingSaved(db, listing.source, listing.externalId) });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/preferences/learn") {
      if (fetchJob?.status === "running") {
        json(res, 409, { error: "criteria cannot be saved while a fetch is running" });
        return;
      }
      json(res, 200, applySavedPreferences(db));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/message") {
      const input = (await body(req)) as { source?: string; externalId?: string; language?: string };
      if (!input.source || !input.externalId) {
        json(res, 400, { error: "source and externalId are required" });
        return;
      }
      const listing = findListing(db, input.source, input.externalId);
      if (!listing) {
        json(res, 404, { error: "listing not found" });
        return;
      }
      const { brief } = getActiveCriteria(db);
      const evaluation = evaluateCar(brief, listing);
      const researchRow = getListingResearch(db, listing.source, listing.externalId);
      let research = researchRow ? JSON.parse(researchRow.researchJson) : null;
      if (!research) {
        research = await researchListing(listing, evaluation);
        upsertListingResearch(db, {
          source: listing.source,
          externalId: listing.externalId,
          model: research.model,
          basis: research.researchBasis,
          researchJson: JSON.stringify(research),
          createdAt: new Date().toISOString(),
        });
      }
      const requested = (input.language === "de" || input.language === "en" || input.language === "auto")
        ? input.language as MessageLanguage | "auto"
        : "auto";
      const message = generateSellerMessage(listing, evaluation, research, requested);
      upsertSellerMessage(db, {
        source: listing.source,
        externalId: listing.externalId,
        language: message.language,
        detectedLanguage: message.detectedLanguage,
        messageText: message.text,
        createdAt: message.generatedAt,
      });
      json(res, 200, { message });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/outcome") {
      const input = (await body(req)) as {
        source?: string;
        externalId?: string;
        outcome?: string;
        notes?: string | null;
      };
      const allowed = new Set([
        "bought",
        "sold",
        "rejected_after_viewing",
        "too_far",
        "inspection_failed",
        "other",
      ]);
      if (!input.source || !input.externalId || !input.outcome || !allowed.has(input.outcome)) {
        json(res, 400, { error: "source, externalId and a valid outcome are required" });
        return;
      }
      if (!findListing(db, input.source, input.externalId)) {
        json(res, 404, { error: "listing not found" });
        return;
      }
      const outcome = recordListingOutcome(db, {
        source: input.source,
        externalId: input.externalId,
        outcome: input.outcome as never,
        notes: input.notes ?? null,
      });
      if (!outcome) {
        json(res, 409, { error: "no decision exists for this listing; fetch or score it first" });
        return;
      }
      json(res, 200, { outcome });
      return;
    }

    if (req.method === "DELETE" && url.pathname === "/api/action") {
      const input = (await body(req)) as { source?: string; externalId?: string };
      if (!input.source || !input.externalId) {
        json(res, 400, { error: "source and externalId are required" });
        return;
      }
      if (!findListing(db, input.source, input.externalId)) {
        json(res, 404, { error: "listing not found" });
        return;
      }
      clearUserAction(db, input.source, input.externalId);
      json(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/action") {
      const input = (await body(req)) as {
        source?: string;
        externalId?: string;
        action?: string;
        note?: string;
      };
      if (!input.source || !input.externalId || !["inspect", "watch", "skip"].includes(input.action ?? "")) {
        json(res, 400, { error: "source, externalId and action (inspect|watch|skip) are required" });
        return;
      }
      if (!findListing(db, input.source, input.externalId)) {
        json(res, 404, { error: "listing not found" });
        return;
      }
      recordUserAction(db, {
        source: input.source,
        externalId: input.externalId,
        action: input.action as "inspect" | "watch" | "skip",
        note: input.note ?? null,
      });
      json(res, 200, { ok: true });
      return;
    }

    json(res, 404, { error: "not found" });
  } catch (error) {
    const status = (error as { status?: number }).status ?? 500;
    json(res, status, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`buy-scout UI: http://127.0.0.1:${port}`);
  console.log(`DB: ${process.env.DB_PATH ?? "./data/buy-scout.db"}`);
});
