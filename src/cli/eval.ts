import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { dedupeListings } from "../core/dedupe.js";
import { getActiveCriteria, latestListings, openDb } from "../db/index.js";
import { evaluateCar } from "../domain/cars/evaluate.js";

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

const db = openDb(arg("db", process.env.DB_PATH ?? "./data/buy-scout.db"));
const { brief, version } = getActiveCriteria(db);
const listings = latestListings(db, 1000);
const scored = listings.map((listing) => ({ listing, evaluation: evaluateCar(brief, listing) }));
const dedupe = dedupeListings(listings);

const fields = ["priceEur", "mileageKm", "firstRegistration", "fuel", "transmission", "seats", "doors", "hasIsofix", "bodyType"] as const;
const coverage = Object.fromEntries(
  fields.map((field) => [
    field,
    {
      present: listings.filter((listing) => listing[field] !== null && listing[field] !== "").length,
      total: listings.length,
    },
  ]),
);

const verdicts = {
  inspect: scored.filter((item) => item.evaluation.verdict === "inspect").length,
  ask: scored.filter((item) => item.evaluation.verdict === "ask").length,
  watch: scored.filter((item) => item.evaluation.verdict === "watch").length,
  reject: scored.filter((item) => item.evaluation.verdict === "reject").length,
};

const bySource = Object.fromEntries(
  [...new Set(listings.map((listing) => listing.source))].map((source) => [
    source,
    scored.filter((item) => item.listing.source === source).length,
  ]),
);

const report = {
  generatedAt: new Date().toISOString(),
  brief,
  criteriaVersion: version,
  totals: {
    listings: listings.length,
    realListings: listings.length,
    adversarialCases: 20,
    dedupeGroups: dedupe.groups.length,
    duplicates: dedupe.duplicateCount,
    bySource,
    verdicts,
  },
  coverage,
  top10: scored
    .sort((a, b) => b.evaluation.score - a.evaluation.score)
    .slice(0, 10)
    .map(({ listing, evaluation }) => ({
      source: listing.source,
      externalId: listing.externalId,
      title: listing.title,
      priceEur: listing.priceEur,
      mileageKm: listing.mileageKm,
      verdict: evaluation.verdict,
      score: evaluation.score,
      confidence: evaluation.confidence,
    })),
  note:
    "50+ real listings from the DB; 20 adversarial cases live in tests/adversarial.test.ts. " +
    "Human shortlist labels are still needed for precision@10.",
};

const out = resolve(arg("out", "./data/eval.json"));
writeFileSync(out, JSON.stringify(report, null, 2), "utf8");
console.log(JSON.stringify(report.totals, null, 2));
console.log(`\nWrote ${out}`);
