import type { Db } from "../db/index.js";
import {
  markListingAvailable,
  markListingUnavailable,
  recordAvailabilityCheck,
  staleListings,
} from "../db/index.js";
import { evaluateCar } from "../domain/cars/evaluate.js";
import type { NormalisedListing, SearchBrief, SourceAdapter } from "../core/types.js";

export interface AvailabilitySweepOptions {
  /** Maximum detail pages to check in this pass. */
  limit?: number;
  /** Only check listings not seen for this many hours. Default 24. */
  staleAfterHours?: number;
  /** Delay between source requests. Default 2000 ms. */
  delayMs?: number;
  /** Optional brief used to prioritise the most attractive stale cars. */
  brief?: SearchBrief;
  /** Check the highest-scoring stale cars (default) or the oldest. */
  order?: "score" | "oldest";
  /** Restrict to these source ids. */
  sources?: Set<string>;
  /** Progress callback for CLI/fetch logs. */
  onCheck?: (listing: NormalisedListing, status: "available" | "gone" | "unknown") => void;
}

export interface AvailabilitySweepResult {
  checked: number;
  available: number;
  gone: number;
  unknown: number;
  skipped: number;
  goneListings: NormalisedListing[];
}

/**
 * Probe stale listings at the source. A delisting is only written when the
 * source gives a reliable signal (HTTP 404/410 or its explicit gone page).
 * Network errors and blocks stay unknown and never hide a car.
 */
export async function sweepAvailability(
  db: Db,
  adapters: SourceAdapter[],
  opts: AvailabilitySweepOptions = {},
): Promise<AvailabilitySweepResult> {
  const limit = Math.max(0, Math.trunc(opts.limit ?? 12));
  const staleAfterHours = Math.max(0, opts.staleAfterHours ?? 24);
  const delayMs = Math.max(0, opts.delayMs ?? 2000);
  const cutoff = new Date(Date.now() - staleAfterHours * 60 * 60 * 1000).toISOString();
  const bySource = new Map(adapters.map((adapter) => [adapter.id, adapter]));
  const supported = new Set(
    adapters.filter((adapter) => adapter.checkAvailability !== undefined).map((adapter) => adapter.id),
  );
  const wanted = opts.sources
    ? new Set([...opts.sources].filter((source) => supported.has(source)))
    : supported;

  // Oldest-first selection happens in SQL, so stale rows at the tail of a
  // recency-ordered table are not cut off before the filter. The SQL source
  // filter prevents unsupported sources from consuming the limit.
  const candidates = staleListings(db, cutoff, opts.order === "oldest" ? limit : undefined, wanted)
    .filter((listing) => wanted.has(listing.source))
    .map((listing) => ({
      listing,
      score: opts.brief ? evaluateCar(opts.brief, listing).score : 0,
    }))
    .sort((a, b) =>
      opts.order === "oldest"
        ? a.listing.lastSeenAt.localeCompare(b.listing.lastSeenAt)
        : b.score - a.score || a.listing.lastSeenAt.localeCompare(b.listing.lastSeenAt),
    )
    .slice(0, limit);

  const result: AvailabilitySweepResult = {
    checked: 0,
    available: 0,
    gone: 0,
    unknown: 0,
    skipped: 0,
    goneListings: [],
  };

  for (const [index, { listing }] of candidates.entries()) {
    const adapter = bySource.get(listing.source);
    if (!adapter?.checkAvailability) {
      result.skipped += 1;
      continue;
    }
    const status = await adapter.checkAvailability({
      source: listing.source,
      externalId: listing.externalId,
      url: listing.url,
      page: 0,
      payload: {},
    });
    result.checked += 1;
    if (status === "gone") {
      markListingUnavailable(db, {
        source: listing.source,
        externalId: listing.externalId,
        reason: `${adapter.label} detail page confirmed gone`,
      });
      result.gone += 1;
      result.goneListings.push(listing);
    } else if (status === "available") {
      markListingAvailable(db, { source: listing.source, externalId: listing.externalId });
      result.available += 1;
    } else {
      recordAvailabilityCheck(db, { source: listing.source, externalId: listing.externalId });
      result.unknown += 1;
    }
    opts.onCheck?.(listing, status);
    if (index < candidates.length - 1 && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return result;
}
