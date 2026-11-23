import "../core/env.js";
import { getActiveCriteria, latestListings, openDb, upsertLayaClassification } from "../db/index.js";
import { evaluateCar } from "../domain/cars/evaluate.js";
import { classifyListingWithLaya, layaEnabled } from "../intelligence/laya.js";

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

if (!layaEnabled()) {
  console.error("Laya is disabled. Unset LAYA_ENABLED=0 to enable it.");
  process.exitCode = 1;
} else {
  const db = openDb(arg("db", process.env.DB_PATH ?? "./data/buy-scout.db"));
  const { brief } = getActiveCriteria(db);
  const limit = Number(arg("limit", "10000"));
  const listings = latestListings(db, limit);
  let classified = 0;
  let risky = 0;
  let deferred = 0;
  let failed = 0;

  for (const listing of listings) {
    const evaluation = evaluateCar(brief, listing);
    const laya = await classifyListingWithLaya(listing, evaluation);
    if (!laya.enabled) { failed += 1; continue; }
    upsertLayaClassification(db, {
      source: listing.source,
      externalId: listing.externalId,
      model: laya.model ?? "laya",
      layaJson: JSON.stringify(laya),
      createdAt: new Date().toISOString(),
    });
    classified += 1;
    if ((laya.risk?.score ?? 0) >= 2) risky += 1;
    if (laya.deferToDeepSeek) deferred += 1;
    if (classified % 25 === 0) console.log(`  ${classified}/${listings.length}`);
  }

  console.log(`Laya classified ${classified}/${listings.length}; risk>=2 ${risky}; deferred ${deferred}; failed ${failed}`);
}
