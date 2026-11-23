import { latestListings, getActiveCriteria, openDb } from "../db/index.js";
import { evaluateCar } from "../domain/cars/evaluate.js";

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

const db = openDb(arg("db", process.env.DB_PATH ?? "./data/buy-scout.db"));
const { brief, version } = getActiveCriteria(db);
const rows = latestListings(db, Number(arg("limit", "500")));
const scored = rows
  .map((listing) => ({ listing, evaluation: evaluateCar(brief, listing) }))
  .sort((a, b) => {
    if (a.evaluation.hardPass !== b.evaluation.hardPass) return a.evaluation.hardPass ? -1 : 1;
    return b.evaluation.score - a.evaluation.score;
  });

const passed = scored.filter((item) => item.evaluation.hardPass);
console.log(`Criteria v${version}; scored ${scored.length}; hard-pass ${passed.length}.`);
for (const { listing, evaluation } of scored.slice(0, Number(arg("top", "20")))) {
  console.log(
    `${evaluation.score.toFixed(1).padStart(5)} ${evaluation.verdict.toUpperCase()} | ` +
      `${listing.title} | ${listing.priceEur ?? "—"} € | ${listing.mileageKm ?? "—"} km | ` +
      `${listing.firstRegistration?.slice(0, 7) ?? "?"} | seats=${listing.seats ?? "?"} ` +
      `doors=${listing.doors ?? "?"} isofix=${listing.hasIsofix === null ? "?" : listing.hasIsofix ? "yes" : "no"}`,
  );
  if (evaluation.hardFailures.length > 0) console.log(`         ${evaluation.hardFailures.join("; ")}`);
  else if (evaluation.unknowns.length > 0) console.log(`         unknowns: ${evaluation.unknowns.join(", ")}`);
}
