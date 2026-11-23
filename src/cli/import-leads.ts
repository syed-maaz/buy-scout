import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { getActiveCriteria, openDb, updateListingDetail, upsertListing } from "../db/index.js";
import { evaluateCar } from "../domain/cars/evaluate.js";
import { parseEmailFile, type EmailLead } from "../ingest/email.js";
import { importListingUrl } from "../sources/url-import.js";

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1] ?? fallback;
}

async function main(): Promise<void> {
  const dir = resolve(arg("dir", "./data/emails"));
  const limit = Math.max(1, Number(arg("limit", "50")));
  const db = openDb(arg("db", process.env.DB_PATH ?? "./data/buy-scout.db"));
  const leads: EmailLead[] = [];
  try {
    for (const file of readdirSync(dir)) {
      if (!/\.(eml|html?|txt)$/i.test(file)) continue;
      leads.push(...parseEmailFile(join(dir, file)));
    }
  } catch (error) {
    throw new Error(`Cannot read ${dir}: ${error instanceof Error ? error.message : String(error)}`);
  }

  const unique = [...new Map(leads.map((lead) => [lead.url, lead])).values()].slice(0, limit);
  const active = getActiveCriteria(db);
  let imported = 0;
  let failed = 0;
  let skipped = 0;
  try {
    for (const lead of unique) {
      if (lead.source !== "kleinanzeigen" && lead.source !== "mobile_de") {
        skipped += 1;
        console.log(`SKIP ${lead.source}: URL import is not enabled for this host yet`);
        continue;
      }
      try {
        const result = await importListingUrl(lead.url);
        upsertListing(db, result.listing);
        updateListingDetail(db, result.listing);
        const evaluation = evaluateCar(active.brief, result.listing);
        imported += 1;
        console.log(`OK ${lead.source} ${result.listing.externalId}: ${result.listing.title} (${evaluation.verdict})`);
      } catch (error) {
        failed += 1;
        console.log(`FAIL ${lead.source}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } finally {
    db.close();
  }
  console.log(`Email leads: ${leads.length}; unique: ${unique.length}; imported: ${imported}; failed: ${failed}; skipped: ${skipped}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
