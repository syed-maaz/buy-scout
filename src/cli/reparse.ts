import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { NormalisedListing } from "../core/types.js";
import {
  findListing,
  getActiveCriteria,
  insertPriceObservation,
  listingDbId,
  openDb,
  upsertReplayListing,
  type Db,
} from "../db/index.js";
import { extractNextData, normaliseAs24Listing } from "../sources/autoscout24.js";
import {
  normaliseKleinanzeigenCard,
  parseKleinanzeigenCards,
} from "../sources/kleinanzeigen.js";

export const REPARSE_SOURCES = ["autoscout24", "kleinanzeigen"] as const;
export type ReparseSource = (typeof REPARSE_SOURCES)[number];

export function isReparseSource(value: string): value is ReparseSource {
  return (REPARSE_SOURCES as readonly string[]).includes(value);
}

/**
 * Pure source dispatch: turn one stored raw search page into normalised
 * listings. No database or filesystem access, so it is safe to test.
 */
export function listingsFromRawHtml(
  source: ReparseSource,
  html: string,
): NormalisedListing[] {
  if (source === "autoscout24") {
    const payload = extractNextData(html);
    return (payload.listings ?? []).map(normaliseAs24Listing);
  }
  return parseKleinanzeigenCards(html).map(normaliseKleinanzeigenCard);
}

export interface ReparseSummary {
  source: ReparseSource;
  pages: number;
  skippedPages: number;
  parsed: number;
  inserted: number;
  updated: number;
  skippedDelisted: number;
}

/**
 * Re-read stored raw pages for one source and upsert every parsed listing,
 * recording a price observation for each one. Pages that fail to parse are
 * skipped so one corrupt file does not abort the run.
 */
export function reparseSource(
  db: Db,
  source: ReparseSource,
  limit: number,
): ReparseSummary {
  const rows = db
    .prepare(
      `SELECT html_path, fetched_at, page FROM raw_pages
        WHERE source = ?
        ORDER BY fetched_at DESC, page ASC
        LIMIT ?`,
    )
    .all(source, limit) as Array<{ html_path: string; fetched_at: string; page: number }>;

  const summary: ReparseSummary = {
    source,
    pages: rows.length,
    skippedPages: 0,
    parsed: 0,
    inserted: 0,
    updated: 0,
    skippedDelisted: 0,
  };

  for (const row of rows) {
    try {
      const html = readFileSync(resolve(row.html_path), "utf8");
      const listings = listingsFromRawHtml(source, html);
      for (const listing of listings) {
        const existing = findListing(db, listing.source, listing.externalId);
        const write = upsertReplayListing(db, listing, row.fetched_at);
        if (write === "skipped") {
          summary.skippedDelisted += 1;
          continue;
        }
        const id = listingDbId(db, listing.source, listing.externalId);
        const priceChanged = listing.priceEur !== null && existing?.priceEur !== listing.priceEur;
        if (id !== null && priceChanged) {
          insertPriceObservation(db, {
            listingId: id,
            priceEur: listing.priceEur,
            observedAt: row.fetched_at,
          });
        }
        if (write === "updated") summary.updated += 1;
        else summary.inserted += 1;
        summary.parsed += 1;
      }
    } catch (error) {
      summary.skippedPages += 1;
      console.warn(
        `skip ${source} page ${row.page} (${row.html_path}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return summary;
}

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

function main(): void {
  const db = openDb(arg("db", process.env.DB_PATH ?? "./data/buy-scout.db"));
  const limit = Math.max(1, Number(arg("limit", "10")) || 1);
  const source = arg("source", "autoscout24");

  if (!isReparseSource(source)) {
    console.error(
      `reparse supports ${REPARSE_SOURCES.join(", ")} only (got ${source})`,
    );
    process.exitCode = 1;
    return;
  }

  const summary = reparseSource(db, source, limit);
  if (summary.pages === 0) {
    console.error(`no raw pages for ${source}; nothing to reparse`);
    process.exitCode = 1;
    return;
  }

  const pageNote =
    summary.skippedPages > 0
      ? `${summary.pages} page(s), ${summary.skippedPages} skipped`
      : `${summary.pages} page(s)`;
  const delistedNote = summary.skippedDelisted > 0
    ? `, ${summary.skippedDelisted} delisted preserved`
    : "";
  console.log(
    `reparsed ${summary.source}: ${pageNote}, ${summary.parsed} listings (${summary.inserted} new, ${summary.updated} existing${delistedNote}); criteria v${getActiveCriteria(db).version}`,
  );
  if (summary.parsed === 0) process.exitCode = 1;
  else {
    console.log("run npm run score or npm run eval to rerank the current working set");
  }
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return pathToFileURL(resolve(entry)).href === import.meta.url;
}

if (isDirectRun()) main();
