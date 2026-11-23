import "../core/env.js";
import { evaluateCar } from "../domain/cars/evaluate.js";
import { getActiveCriteria, openDb, updateListingDetail, upsertListing } from "../db/index.js";
import { importListingUrl } from "../sources/url-import.js";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main(): Promise<void> {
  const rawUrl = arg("url");
  if (!rawUrl) {
    throw new Error("Usage: npm run import:url -- --url <kleinanzeigen-or-mobile.de-url>");
  }

  const db = openDb(arg("db") ?? process.env.DB_PATH ?? "./data/buy-scout.db");
  try {
    const active = getActiveCriteria(db);
    const result = await importListingUrl(rawUrl);
    upsertListing(db, result.listing);
    updateListingDetail(db, result.listing);
    const evaluation = evaluateCar(active.brief, result.listing);

    console.log(`Imported ${result.listing.source} ${result.listing.externalId}`);
    console.log(`  ${result.listing.title}`);
    console.log(
      `  ${result.listing.priceEur ?? "?"} € | ${result.listing.mileageKm ?? "?"} km | ` +
        `${result.listing.firstRegistration ?? "?"} | ${result.listing.fuel ?? "?"} | ` +
        `${result.listing.transmission ?? "?"} | ${result.listing.city ?? "?"}`,
    );
    console.log(`  fetched via ${result.fetchedVia}; ${result.finalUrl}`);
    for (const warning of result.warnings) console.log(`  ! ${warning}`);
    console.log(`  verdict=${evaluation.verdict} score=${evaluation.score} hardPass=${evaluation.hardPass}`);
    for (const reason of evaluation.reasons) console.log(`  - ${reason}`);
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
