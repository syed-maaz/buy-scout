import { getActiveCriteria, insertPriceObservation, listingDbId, openDb, upsertListing } from "../db/index.js";
import { buildManualListing, manualInputFromArgs } from "../core/manual.js";
import { evaluateCar } from "../domain/cars/evaluate.js";

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

try {
  const db = openDb(arg("db", process.env.DB_PATH ?? "./data/buy-scout.db"));
  const listing = buildManualListing(manualInputFromArgs(process.argv.slice(2)));
  const { brief, version } = getActiveCriteria(db);
  upsertListing(db, listing);
  const id = listingDbId(db, listing.source, listing.externalId);
  if (id !== null) {
    insertPriceObservation(db, {
      listingId: id,
      priceEur: listing.priceEur,
      observedAt: new Date().toISOString(),
    });
  }
  const evaluation = evaluateCar(brief, listing);
  console.log(
    `${evaluation.verdict.toUpperCase()} ${evaluation.score.toFixed(1)} | ${listing.title} | ` +
      `${listing.priceEur ?? "?"} € | criteria v${version} | ${listing.source}:${listing.externalId}`,
  );
  console.log(evaluation.reasons.join("; "));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(
    "usage: npm run intake -- --title \"VW Passat\" --url https://... --price 6500 --mileage 150000 --year 2013 --seats 5 --doors 5 --isofix yes --body Kombi --zip 69168",
  );
  process.exitCode = 1;
}
