import { AutoScout24Adapter } from "../sources/autoscout24.js";
import { AutoUncleAdapter } from "../sources/autouncle.js";
import { KleinanzeigenAdapter } from "../sources/kleinanzeigen.js";
import { getActiveCriteria, openDb } from "../db/index.js";
import { sweepAvailability } from "../core/availability.js";

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

const db = openDb(arg("db", process.env.DB_PATH ?? "./data/buy-scout.db"));
const brief = getActiveCriteria(db).brief;
const sourceFilter = arg("source", "").trim();
const sources = sourceFilter ? new Set(sourceFilter.split(",").map((value) => value.trim())) : undefined;
const adapters = [new AutoScout24Adapter(), new AutoUncleAdapter(), new KleinanzeigenAdapter()].filter(
  (adapter) => !sources || sources.has(adapter.id),
);
const limit = Number(arg("limit", process.env.AVAILABILITY_LIMIT ?? "100"));
const staleAfterHours = Number(arg("hours", process.env.AVAILABILITY_STALE_HOURS ?? "24"));
const delayMs = Number(arg("delay", process.env.AVAILABILITY_DELAY_MS ?? "2000"));
const order = arg("order", "score") === "oldest" ? "oldest" : "score";

console.log(
  `[availability] checking up to ${limit} listing(s) not seen for ${staleAfterHours}h ` +
    `with ${delayMs}ms spacing; order=${order}` + (sources ? `; sources=${[...sources].join(",")}` : ""),
);

const result = await sweepAvailability(db, adapters, {
  brief,
  limit,
  staleAfterHours,
  delayMs,
  sources,
  order,
  onCheck: (listing, status) => {
    console.log(`[${status}] ${listing.source} | ${listing.title} | ${listing.lastSeenAt}`);
  },
});

console.log(
  `\nChecked ${result.checked}; gone ${result.gone}, live ${result.available}, ` +
    `unknown ${result.unknown}, skipped ${result.skipped}.`,
);
if (result.goneListings.length > 0) {
  console.log("Retired:");
  for (const listing of result.goneListings) {
    console.log(`  - ${listing.source} ${listing.externalId} | ${listing.title}`);
  }
}
