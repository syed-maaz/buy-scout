import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { findListing, getActiveCriteria, latestListings, openDb } from "../db/index.js";
import { evaluateCar } from "../domain/cars/evaluate.js";

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

function csv(value: unknown): string {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted && char === '"' && line[i + 1] === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(cell);
      cell = "";
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells;
}

const db = openDb(arg("db", process.env.DB_PATH ?? "./data/buy-scout.db"));
const { brief } = getActiveCriteria(db);
const out = resolve(arg("out", "./data/labels.csv"));
const limit = Number(arg("limit", "50"));

const allScored = latestListings(db, 500)
  .map((listing) => ({ listing, evaluation: evaluateCar(brief, listing) }))
  .sort((a, b) => b.evaluation.score - a.evaluation.score);
const scored = allScored.filter(({ evaluation }) => evaluation.verdict !== "reject");
const rejected = allScored.filter(({ evaluation }) => evaluation.verdict === "reject");

if (process.argv.includes("--score")) {
  if (!existsSync(out)) {
    console.error(`No labels file at ${out}. Run npm run labels:export first.`);
    process.exitCode = 1;
  } else {
    const lines = readFileSync(out, "utf8").split(/\r?\n/).filter(Boolean);
    const header = lines[0].split(",");
    const index = (name: string) => header.indexOf(name);
    const rows = lines.slice(1).map(parseCsvLine);
    const labeled = rows
      .map((cols) => {
        const source = cols[index("source")] ?? "";
        const externalId = cols[index("external_id")] ?? "";
        const label = (cols[index("label")] ?? "").trim().toLowerCase();
        const listing = findListing(db, source, externalId);
        if (!listing) return null;
        const evaluation = evaluateCar(brief, listing);
        return { label, score: evaluation.score };
      })
      .filter((row): row is { label: string; score: number } => row !== null)
      .filter((row) => row.label === "inspect" || row.label === "good" || row.label === "yes" || row.label === "no" || row.label === "skip");
    const top10 = labeled.sort((a, b) => b.score - a.score).slice(0, 10);
    const hits = top10.filter((row) => ["inspect", "good", "yes"].includes(row.label)).length;
    console.log(`Labeled rows: ${labeled.length}/${rows.length}`);
    console.log(`precision@10: ${hits}/${top10.length} = ${(hits / Math.max(1, top10.length)).toFixed(2)}`);
    console.log("Labels counted as positive: inspect, good, yes.");
  }
} else {
  const rows = scored.concat(rejected).slice(0, limit).map(({ listing }) => [
    listing.source,
    listing.externalId,
    listing.title,
    listing.priceEur ?? "",
    listing.mileageKm ?? "",
    listing.firstRegistration ?? "",
    listing.city ?? "",
    listing.url,
    "",
    "",
  ]);
  const header = ["source", "external_id", "title", "price_eur", "mileage_km", "first_registration", "city", "url", "label", "reason"];
  writeFileSync(out, [header, ...rows].map((row) => row.map(csv).join(",")).join("\n") + "\n", "utf8");
  console.log(`Wrote ${rows.length} candidates to ${out}`);
  console.log("The engine verdict and score are intentionally omitted. Fill label with inspect / skip / no, add a short reason, then run npm run labels:score.");
}
