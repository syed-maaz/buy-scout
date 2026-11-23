import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getActiveCriteria, latestListings, openDb } from "../db/index.js";
import { dedupeListings } from "../core/dedupe.js";
import { evaluateCar } from "../domain/cars/evaluate.js";
import { renderReport } from "../report/render.js";

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

const db = openDb(arg("db", process.env.DB_PATH ?? "./data/buy-scout.db"));
const { brief, version } = getActiveCriteria(db);
const scored = latestListings(db, 500)
  .map((listing) => ({ listing, evaluation: evaluateCar(brief, listing) }))
  .sort((a, b) => {
    if (a.evaluation.hardPass !== b.evaluation.hardPass) return a.evaluation.hardPass ? -1 : 1;
    return b.evaluation.score - a.evaluation.score;
  });
const deduped = dedupeListings(scored.map((item) => item.listing));
const uniqueKeys = new Set(deduped.unique.map((listing) => `${listing.source}:${listing.externalId}`));
const items = scored.filter((item) => uniqueKeys.has(`${item.listing.source}:${item.listing.externalId}`));

const counts = db
  .prepare(
    `SELECT
       (SELECT COUNT(*) FROM listings) AS listings,
       (SELECT COUNT(*) FROM brain_decisions) AS decisions,
       (SELECT COUNT(*) FROM memory_observations) AS observations`,
  )
  .get() as { listings: number; decisions: number; observations: number };

const sources = db
  .prepare(
    `SELECT s.id, s.label, s.status, s.note,
            COUNT(r.id) AS runs,
            ROUND(AVG(r.found), 1) AS avg_found
       FROM sources s
       LEFT JOIN source_runs r ON r.source = s.id
      GROUP BY s.id
      ORDER BY s.id`,
  )
  .all()
  .map((row) => {
    const r = row as { id: string; label: string; status: string; note: string; runs: number; avg_found: number | null };
    return { id: r.id, label: r.label, status: r.status, note: r.note, runs: r.runs, avgFound: r.avg_found };
  });

const out = resolve(arg("out", "./data/report.html"));
writeFileSync(
  out,
  renderReport({ items, generatedAt: new Date().toISOString(), counts, sources, criteriaVersion: version, brief }),
  "utf8",
);
console.log(`wrote ${out}`);
