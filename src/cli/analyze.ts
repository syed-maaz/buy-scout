import "../core/env.js";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getActiveCriteria, latestListings, openDb, upsertLayaClassification, upsertListingAnalysis } from "../db/index.js";
import { evaluateCar } from "../domain/cars/evaluate.js";
import { analyzeListing } from "../intelligence/analyst.js";
import { llmStatus } from "../intelligence/llm.js";
import { selectAnalysisCandidates } from "../intelligence/selection.js";
import { classifyListingWithLaya, layaEnabled } from "../intelligence/laya.js";

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const db = openDb(arg("db", process.env.DB_PATH ?? "./data/buy-scout.db"));
const { brief, version } = getActiveCriteria(db);
const top = Number(arg("top", "0"));
const includeRejected = hasFlag("include-rejected");
const useLaya = !hasFlag("no-laya") && layaEnabled();

const scored = latestListings(db, 500)
  .map((listing) => ({ listing, evaluation: evaluateCar(brief, listing) }))
  .filter(({ evaluation }) => includeRejected || evaluation.verdict !== "reject")
  .sort((a, b) => {
    if (a.evaluation.hardPass !== b.evaluation.hardPass) return a.evaluation.hardPass ? -1 : 1;
    return b.evaluation.score - a.evaluation.score;
  });

const settings = brief.analysis ?? { minScore: 60, minConfidence: 0.6, maxCards: 30, autoRun: false };
const selection = top > 0
  ? null
  : selectAnalysisCandidates(brief, scored, {
      minScore: Number(arg("min-score", String(settings.minScore))),
      minConfidence: Number(arg("min-confidence", String(settings.minConfidence))),
      maxCards: Number(arg("max-cards", String(settings.maxCards))),
    });
const chosen = selection ? selection.items : scored.slice(0, Math.max(1, top));

const output: Array<Record<string, unknown>> = [];
for (const { listing, evaluation } of chosen) {
  const laya = useLaya ? await classifyListingWithLaya(listing, evaluation) : null;
  if (laya?.enabled) {
    upsertLayaClassification(db, {
      source: listing.source,
      externalId: listing.externalId,
      model: laya.model ?? "laya",
      layaJson: JSON.stringify(laya),
      createdAt: new Date().toISOString(),
    });
  }
  // Laya stays advisory. A confident Laya answer must not remove the buyer's
  // only prose explanation; DeepSeek still runs when configured, with the
  // deterministic fallback when it is not.
  const analysis = await analyzeListing(listing, evaluation);
  const payload = { listing, evaluation, analysis, laya };
  output.push(payload);
  upsertListingAnalysis(db, {
    source: listing.source,
    externalId: listing.externalId,
    model: `${analysis.model}${laya?.enabled ? "+laya" : ""}`,
    analysisJson: JSON.stringify({ analysis, laya }),
    createdAt: new Date().toISOString(),
  });

  console.log(`\n${evaluation.verdict.toUpperCase()} ${evaluation.score.toFixed(1)} | ${listing.title}`);
  console.log(`  ${analysis.summary}`);
  if (analysis.questions.length) console.log(`  Q: ${analysis.questions.slice(0, 4).join(" | ")}`);
  if (laya) console.log(`  Laya: ${laya.reason}`);
}

const out = resolve(arg("out", "./data/analysis.json"));
console.log(`Criteria v${version}`);
console.log(selection ? selection.reason : `Explicit --top ${top}`);
writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), items: output }, null, 2), "utf8");
console.log(`\nWrote ${out}`);
const llm = llmStatus();
console.log(
  `LLM: ${llm.configured ? `${llm.provider} (${llm.model ?? "model"})` : "not configured — deterministic fallback"}; ` +
    `Laya: ${useLaya ? "enabled" : "disabled"}`,
);
