import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { AutoScout24Adapter, normaliseAs24Listing, type As24Listing } from "../sources/autoscout24.js";
import { AutoUncleAdapter, normaliseAutoUncleCard, type AutoUncleCard } from "../sources/autouncle.js";
import { KleinanzeigenAdapter, normaliseKleinanzeigenCard, type KleinanzeigenCard } from "../sources/kleinanzeigen.js";
import { MobileDeAdapter, normaliseMobileDeCard, type MobileDeCard } from "../sources/mobile-de.js";
import { getActiveCriteria } from "../db/index.js";
import { isUsableSourceResult, runSources } from "../core/source-runner.js";
import { evaluateCar, type CarEvaluation } from "../domain/cars/evaluate.js";
import { classifyListingWithLaya, layaEnabled } from "../intelligence/laya.js";
import { dedupeListings } from "../core/dedupe.js";
import { sha256 } from "../core/parse.js";
import { distanceToleranceKm } from "../core/distance.js";
import { formatRecommendations } from "../acquisition/playbook.js";
import { sweepAvailability } from "../core/availability.js";
import {
  countListings,
  findListing,
  finishRun,
  getFetchCoverage,
  getFetchStats,
  insertPriceObservation,
  insertRawDetail,
  insertRawListing,
  insertMemoryObservation,
  insertRawPage,
  listingDbId,
  openDb,
  recordAccessAttempt,
  startRun,
  touchListing,
  updateListingDetail,
  upsertFetchCoverage,
  upsertFetchStats,
  upsertDecision,
  upsertListing,
  upsertLayaClassification,
  type Db,
} from "../db/index.js";
import type { NormalisedListing, RawRef, SearchBrief, SourceAdapter, SourceSearchResult } from "../core/types.js";

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function formatEur(value: number | null): string {
  return value === null ? "—" : `${value.toLocaleString("de-DE")} €`;
}

function formatInt(value: number | null): string {
  return value === null ? "—" : value.toLocaleString("de-DE");
}

function printSourceSummary(result: SourceSearchResult, brief: SearchBrief): void {
  console.log(`\n[${result.source}] ${result.refs.length} listings, total=${result.totalResults ?? "?"}`);
  console.log(
    `[${result.source}] integrity=${result.integrity.ok ? "OK" : "INVALID"} ` +
      `maxPrice=${result.integrity.observedMaxPriceEur ?? "?"}€ ` +
      `maxDistance=${result.integrity.observedMaxDistanceKm ?? "?"}km`,
  );
  for (const reason of result.integrity.reasons) console.log(`  ! ${reason}`);
  for (const warning of result.warnings) console.log(`  ~ ${warning}`);
  console.log(`  cap=${formatEur(brief.purchaseMaxEur)} radius=${brief.location.radiusKm}km`);
}

function printScored(scored: Array<{ listing: NormalisedListing; evaluation: CarEvaluation }>): void {
  const ranked = [...scored].sort((a, b) => {
    if (a.evaluation.hardPass !== b.evaluation.hardPass) return a.evaluation.hardPass ? -1 : 1;
    return b.evaluation.score - a.evaluation.score;
  });
  const passed = ranked.filter((item) => item.evaluation.hardPass);
  console.log(`\nScored ${ranked.length}; hard-pass ${passed.length}. Top 10:\n`);
  for (const { listing, evaluation } of ranked.slice(0, 10)) {
    console.log(
      `${evaluation.score.toFixed(1).padStart(5)} ${evaluation.verdict.toUpperCase()} | ${listing.title} | ` +
        `${formatEur(listing.priceEur)} | ${formatInt(listing.mileageKm)} km | ` +
        `${listing.firstRegistration?.slice(0, 7) ?? "?"} | ` +
        `seats=${listing.seats ?? "?"} doors=${listing.doors ?? "?"} ` +
        `isofix=${listing.hasIsofix === null ? "?" : listing.hasIsofix ? "yes" : "no"} | ` +
        `${listing.distanceKm ?? "?"} km`,
    );
    const detail = evaluation.reasons.slice(0, 3).join("; ");
    if (detail) console.log(`         ${detail}`);
    if (listing.redFlags.length > 0) console.log(`         flags: ${listing.redFlags.join(", ")}`);
  }
}

async function fetchDetailForRef(
  db: Db,
  adapter: SourceAdapter,
  ref: RawRef,
  rawDir: string,
): Promise<NormalisedListing | null> {
  try {
    if (!adapter.fetchDetail) return null;
    const detail = await adapter.fetchDetail(ref);
    const day = detail.fetchedAt.slice(0, 10);
    const detailDir = join(rawDir, detail.source, day, "details");
    mkdirSync(detailDir, { recursive: true });
    const base = detail.externalId;
    const htmlPath = join(detailDir, `${base}.html`);
    const jsonPath = join(detailDir, `${base}.json`);
    writeFileSync(htmlPath, detail.html, "utf8");
    writeFileSync(jsonPath, JSON.stringify(detail.payload), "utf8");
    insertRawDetail(db, {
      source: detail.source,
      externalId: detail.externalId,
      fetchedAt: detail.fetchedAt,
      httpStatus: detail.httpStatus,
      htmlPath,
      jsonPath,
    });
    return detail.listing;
  } catch (error) {
    console.warn(
      `  ! detail failed for ${ref.externalId}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

async function main(): Promise<void> {
  const dbPath = arg("db", process.env.DB_PATH ?? "./data/buy-scout.db");
  const db = openDb(dbPath);
  const active = getActiveCriteria(db);
  const brief = JSON.parse(JSON.stringify(active.brief)) as typeof active.brief;
  brief.location.zip = arg("zip", brief.location.zip);
  brief.location.radiusKm = Number(arg("radius", String(brief.location.radiusKm)));
  brief.purchaseMaxEur = Number(arg("max", String(brief.purchaseMaxEur)));
  brief.budgetAllInEur = brief.purchaseMaxEur + brief.reserveEur;
  const briefOverridden =
    brief.location.zip !== active.brief.location.zip ||
    brief.location.radiusKm !== active.brief.location.radiusKm ||
    brief.purchaseMaxEur !== active.brief.purchaseMaxEur;

  const queryKey = [
    brief.location.zip,
    brief.location.radiusKm,
    brief.hard.fuel,
    brief.hard.transmission,
    brief.purchaseMaxEur,
  ].join("|");
  const coverage = getFetchCoverage(db, "autoscout24", queryKey);
  const coveredMax = coverage?.sweptTo ?? 0;
  const expands = brief.purchaseMaxEur > coveredMax;
  const forceFull = hasFlag("full");
  const forceRefresh = hasFlag("refresh");
  const refreshOnly = !forceFull && !forceRefresh && coverage !== null && !expands;
  const priceFrom = !forceFull && expands && coveredMax > 0 ? coveredMax : undefined;
  const mode = forceFull ? "full" : forceRefresh ? "refresh" : refreshOnly ? "refresh" : priceFrom ? "expand" : "full";
  const pagesArg = process.argv.includes("--pages")
    ? Number(arg("pages", "10"))
    : null;
  const learned = getFetchStats(db, "autoscout24");
  const learnedMaxPages =
    learned?.avgNewPerPage == null ? 10 : learned.avgNewPerPage >= 15 ? 10 : learned.avgNewPerPage >= 8 ? 8 : 6;
  const refreshPages = Number(arg("refresh-pages", process.env.FETCH_REFRESH_PAGES ?? "10"));
  const maxPages = pagesArg ?? (forceRefresh || refreshOnly ? Math.max(6, refreshPages) : learnedMaxPages);
  const minPages = Number(arg("min-pages", process.env.FETCH_MIN_PAGES ?? "5"));
  const targetNew = Number(arg("target-new", process.env.FETCH_TARGET_NEW ?? "50"));
  const delayMs = Number(arg("delay", process.env.FETCH_DELAY_MS ?? "3000"));
  const rawDir = resolve(arg("raw", process.env.RAW_DIR ?? "./data/raw"));
  const withDetails = !hasFlag("no-details");
  const availabilityLimit = Number(arg("availability-limit", process.env.FETCH_AVAILABILITY_LIMIT ?? "12"));
  const availabilityStaleHours = Number(arg("availability-hours", process.env.FETCH_AVAILABILITY_HOURS ?? "24"));

  console.log(
    `[fetch] criteria v${active.version}; coverage ${coveredMax > 0 ? `0-${coveredMax} €` : "none"}; ` +
      `mode ${mode === "refresh" ? "refresh (covered)" : mode === "expand" ? `expand ${priceFrom}-${brief.purchaseMaxEur} €` : mode}; ` +
      `page budget ${maxPages}${learned?.avgNewPerPage == null ? " (cold start)" : ` (learned ${learned.avgNewPerPage.toFixed(1)} new/page)`}`,
  );

  const sourceFilter = arg("source", "");
  const sourceRows = db
    .prepare(`SELECT id, enabled FROM sources`)
    .all() as Array<{ id: string; enabled: number }>;
  const enabledSources = sourceFilter
    ? new Set([sourceFilter])
    : new Set(sourceRows.filter((row) => row.enabled === 1).map((row) => row.id));
  const adapters = [new AutoScout24Adapter(), new AutoUncleAdapter(), new KleinanzeigenAdapter(), new MobileDeAdapter()].filter(
    (adapter) => enabledSources.has(adapter.id),
  );
  if (adapters.length === 0) {
    throw new Error("No enabled source adapters. Enable at least one source in the sources table.");
  }
  const knownBySource = new Map<string, Set<string>>();
  for (const adapter of adapters) {
    const rows = db
      .prepare(`SELECT external_id FROM listings WHERE source = ?`)
      .all(adapter.id) as Array<{ external_id: string }>;
    knownBySource.set(adapter.id, new Set(rows.map((row) => row.external_id)));
  }

  const pageStats = new Map<string, { newCount: number; seen: number; pages: number }>();
  const onPage = (source: string, page: { page: number }, refs: RawRef[]): boolean => {
    const known = knownBySource.get(source) ?? new Set<string>();
    const newOnPage = refs.filter((ref) => !known.has(ref.externalId)).length;
    const stats = pageStats.get(source) ?? { newCount: 0, seen: 0, pages: 0 };
    stats.newCount += newOnPage;
    stats.seen += refs.length;
    stats.pages = page.page;
    pageStats.set(source, stats);

    const ratio = refs.length === 0 ? 0 : newOnPage / refs.length;
    console.log(
      `[${source}] page ${page.page}: ${newOnPage}/${refs.length} new ` +
        `(run total ${stats.newCount} new / ${stats.seen} seen)`,
    );
    if (page.page >= minPages && stats.newCount >= targetNew) {
      console.log(`[${source}] stop: reached target ${targetNew} new listings`);
      return true;
    }
    if (page.page >= minPages && ratio < 0.2) {
      console.log(`[${source}] stop: page is mostly known (${(ratio * 100).toFixed(0)}% new)`);
      return true;
    }
    return false;
  };

  const startedAt = new Date().toISOString();
  const run = await runSources(adapters, brief, { maxPages, delayMs, sort: "age", priceFrom, onPage });

  const before = countListings(db);
  const scored: Array<{ listing: NormalisedListing; evaluation: CarEvaluation }> = [];

  for (const result of run.results) {
    const runId = `${result.source}-${startedAt.replace(/[:.]/g, "-")}`;
    startRun(db, { id: runId, source: result.source, startedAt });

    const adapter = adapters.find((candidate) => candidate.id === result.source);
    recordAccessAttempt(db, {
      source: result.source,
      method: adapter?.accessMethod ?? "unknown",
      symptom: result.integrity.ok ? null : "filter_ignored",
      success: result.integrity.ok,
      httpStatus: result.pages[0]?.httpStatus ?? null,
      note: `found=${result.refs.length} total=${result.totalResults ?? "?"}`,
      createdAt: startedAt,
    });
    if (result.integrity.ok) {
      db.prepare(`UPDATE sources SET status = 'working', note = ?, updated_at = ? WHERE id = ?`).run(
        adapter?.statusNote ?? "healthy",
        new Date().toISOString(),
        result.source,
      );
    }

    const day = startedAt.slice(0, 10);
    const pageDir = join(rawDir, result.source, day);
    const listingDir = join(pageDir, "listings");
    mkdirSync(listingDir, { recursive: true });

    for (const page of result.pages) {
      const htmlPath = join(pageDir, `${runId}-p${page.page}.html`);
      writeFileSync(htmlPath, page.html, "utf8");
      insertRawPage(db, {
        runId,
        source: page.source,
        page: page.page,
        url: page.url,
        fetchedAt: page.fetchedAt,
        httpStatus: page.httpStatus,
        htmlPath,
        listingCount: page.listingCount,
        totalResults: page.totalResults,
      });
    }

    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    if (!result.integrity.ok) {
      finishRun(db, {
        id: runId,
        status: "filter_invalid",
        finishedAt: new Date().toISOString(),
        pages: result.pages.length,
        found: result.refs.length,
        inserted: 0,
        updated: 0,
        totalResults: result.totalResults,
        integrityJson: JSON.stringify(result.integrity),
      });
      console.warn(`[${result.source}] filter integrity invalid; listings not persisted`);
      db.prepare(`UPDATE sources SET status = 'degraded', note = ?, updated_at = ? WHERE id = ?`).run(
        `filter_invalid: ${result.integrity.reasons.join("; ")}`.slice(0, 300),
        new Date().toISOString(),
        result.source,
      );
      printSourceSummary(result, brief);
      continue;
    }

    for (const [index, ref] of result.refs.entries()) {
      const card =
        result.source === "autouncle"
          ? normaliseAutoUncleCard(ref.payload as AutoUncleCard)
          : result.source === "kleinanzeigen"
            ? normaliseKleinanzeigenCard(ref.payload as KleinanzeigenCard)
            : result.source === "mobile_de"
              ? normaliseMobileDeCard(ref.payload as MobileDeCard)
              : normaliseAs24Listing(ref.payload as As24Listing);
      const existing = findListing(db, card.source, card.externalId);
      const changed =
        !existing ||
        existing.priceEur !== card.priceEur ||
        existing.mileageKm !== card.mileageKm;
      const detailAdapter = adapter as SourceAdapter;
      const missingFamilyDetail =
        detailAdapter?.fetchDetail !== undefined &&
        existing !== null &&
        (existing.seats === null || existing.doors === null || existing.hasIsofix === null);
      const needsDetail = changed || missingFamilyDetail;

      if (existing && !needsDetail) {
        touchListing(db, card.source, card.externalId, new Date().toISOString());
        const id = listingDbId(db, card.source, card.externalId);
        if (id !== null) {
          insertPriceObservation(db, {
            listingId: id,
            priceEur: existing.priceEur,
            observedAt: new Date().toISOString(),
          });
        }
        scored.push({ listing: existing, evaluation: evaluateCar(brief, existing) });
        skipped += 1;
        continue;
      }

      let listing = card;
      if (withDetails && detailAdapter?.fetchDetail && needsDetail) {
        const detailed = await fetchDetailForRef(db, detailAdapter, ref, rawDir);
        if (detailed) listing = detailed;
        else if (existing) {
          listing = {
            ...existing,
            title: card.title,
            url: card.url,
            priceEur: card.priceEur,
            mileageKm: card.mileageKm,
            lastSeenAt: card.lastSeenAt,
            rawJson: card.rawJson,
            contentHash: card.contentHash,
          };
        }
        if (index < result.refs.length - 1 && delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, Math.max(1000, delayMs)));
        }
      }

      if (listing.priceEur !== null && listing.priceEur > brief.purchaseMaxEur) {
        console.warn(`  ! skip ${listing.source} ${listing.externalId}: price ${listing.priceEur} > ${brief.purchaseMaxEur}`);
        skipped += 1;
        continue;
      }
      if (
        listing.distanceKm !== null &&
        listing.distanceKm > brief.location.radiusKm + distanceToleranceKm(brief.location.radiusKm)
      ) {
        console.warn(`  ! skip ${listing.source} ${listing.externalId}: distance ${listing.distanceKm} km`);
        skipped += 1;
        continue;
      }

      const jsonPath = join(listingDir, `${listing.externalId}.json`);
      writeFileSync(jsonPath, listing.rawJson, "utf8");
      insertRawListing(db, {
        source: listing.source,
        externalId: listing.externalId,
        url: listing.url,
        fetchedAt: listing.lastSeenAt,
        jsonPath,
        contentHash: listing.contentHash,
      });
      upsertListing(db, listing);
      if (!existing || withDetails) updateListingDetail(db, listing);
      const id = listingDbId(db, listing.source, listing.externalId);
      if (id !== null) {
        insertPriceObservation(db, {
          listingId: id,
          priceEur: listing.priceEur,
          observedAt: listing.lastSeenAt,
        });
      }
      scored.push({ listing, evaluation: evaluateCar(brief, listing) });
      if (existing) updated += 1;
      else inserted += 1;
    }

    const pageStat = pageStats.get(result.source);
    if (pageStat) {
      console.log(
        `[${result.source}] smart fetch: ${pageStat.pages} page(s), ${pageStat.newCount} new, ` +
          `${pageStat.seen - pageStat.newCount} known; details skipped for ${skipped}`,
      );
      if (result.source === "autoscout24") {
        const previous = getFetchStats(db, "autoscout24");
        const currentPerPage = pageStat.newCount / Math.max(1, pageStat.pages);
        const currentRatio = pageStat.seen === 0 ? 0 : pageStat.newCount / pageStat.seen;
        upsertFetchStats(db, {
          source: "autoscout24",
          lastNew: pageStat.newCount,
          lastKnown: pageStat.seen - pageStat.newCount,
          avgNewPerPage:
            previous?.avgNewPerPage == null
              ? currentPerPage
              : previous.avgNewPerPage * 0.7 + currentPerPage * 0.3,
          avgNewRatio:
            previous?.avgNewRatio == null
              ? currentRatio
              : previous.avgNewRatio * 0.7 + currentRatio * 0.3,
          runs: (previous?.runs ?? 0) + 1,
        });
      }
    }

    if (result.source === "autoscout24" && result.integrity.ok) {
      upsertFetchCoverage(db, {
        source: "autoscout24",
        queryKey,
        priceFrom: priceFrom ?? 0,
        priceTo: brief.purchaseMaxEur,
        sweptTo: mode === "full" || mode === "expand"
          ? Math.max(coverage?.sweptTo ?? 0, brief.purchaseMaxEur)
          : coverage?.sweptTo ?? 0,
        peekedTo: brief.purchaseMaxEur,
        mode,
        pages: result.pages.length,
        totalResults: result.totalResults,
        lastFetchedAt: new Date().toISOString(),
      });
    }

    finishRun(db, {
      id: runId,
      status: result.integrity.ok ? "ok" : "filter_invalid",
      finishedAt: new Date().toISOString(),
      pages: result.pages.length,
      found: result.refs.length,
      inserted,
      updated,
      totalResults: result.totalResults,
      integrityJson: JSON.stringify(result.integrity),
    });

    printSourceSummary(result, brief);
  }

  for (const failure of run.failures) {
    console.error(`[${failure.source}] FAILED: ${failure.error}`);
    console.error(`  symptom: ${failure.symptom}`);
    console.error(`${formatRecommendations(failure.symptom).split("\n").map((line) => `  ${line}`).join("\n")}`);
    const failureRunId = `${failure.source}-${startedAt.replace(/[:.]/g, "-")}-failed`;
    startRun(db, { id: failureRunId, source: failure.source, startedAt });
    finishRun(db, {
      id: failureRunId,
      status: "failed",
      finishedAt: new Date().toISOString(),
      pages: 0,
      found: 0,
      inserted: 0,
      updated: 0,
      totalResults: null,
      integrityJson: JSON.stringify({ error: failure.error, symptom: failure.symptom }),
    });
    db.prepare(`UPDATE sources SET status = 'blocked', note = ?, updated_at = ? WHERE id = ?`).run(
      `${failure.symptom}: ${failure.error}`.slice(0, 300),
      new Date().toISOString(),
      failure.source,
    );
    recordAccessAttempt(db, {
      source: failure.source,
      method: adapters.find((adapter) => adapter.id === failure.source)?.accessMethod ?? "unknown",
      symptom: failure.symptom,
      success: false,
      note: failure.error,
      createdAt: startedAt,
    });
    insertMemoryObservation(db, {
      kind: "access_failure",
      content: `${failure.source}: ${failure.symptom}`,
      metadataJson: JSON.stringify({
        error: failure.error,
        recommendations: failure.recommendations,
      }),
      createdAt: new Date().toISOString(),
    });
  }

  if (!hasFlag("no-availability") && availabilityLimit > 0) {
    const availability = await sweepAvailability(db, adapters, {
      brief,
      limit: availabilityLimit,
      staleAfterHours: availabilityStaleHours,
      delayMs: Math.max(1500, Math.min(delayMs, 4000)),
      onCheck: (listing, status) => {
        if (status === "gone") {
          console.log(`[availability] gone: ${listing.source} ${listing.title}`);
        }
      },
    });
    if (availability.checked > 0) {
      console.log(
        `\n[availability] checked ${availability.checked} stale listing(s): ` +
          `${availability.gone} gone, ${availability.available} still live, ${availability.unknown} unknown`,
      );
    }
  }

  const useLaya = layaEnabled() && !hasFlag("no-laya");
  if (useLaya && scored.length > 0) {
    let classified = 0;
    let risky = 0;
    let deferred = 0;
    let firstError = "";
    for (const { listing, evaluation } of scored) {
      const classification = await classifyListingWithLaya(listing, evaluation);
      if (!classification.enabled) {
        if (!firstError) firstError = classification.reason;
        continue;
      }
      upsertLayaClassification(db, {
        source: listing.source,
        externalId: listing.externalId,
        model: classification.model ?? "laya",
        layaJson: JSON.stringify(classification),
        createdAt: new Date().toISOString(),
      });
      classified += 1;
      if ((classification.risk?.score ?? 0) >= 2) risky += 1;
      if (classification.deferToDeepSeek) deferred += 1;
    }
    console.log(
      `\nLaya: classified ${classified}/${scored.length}; risk>=2 ${risky}; deferred ${deferred}` +
        (firstError ? ` (first error: ${firstError})` : ""),
    );
  }

  const deduped = dedupeListings(scored.map((item) => item.listing));
  const uniqueKeys = new Set(deduped.unique.map((listing) => `${listing.source}:${listing.externalId}`));
  const uniqueScored = scored.filter((item) => uniqueKeys.has(`${item.listing.source}:${item.listing.externalId}`));
  printScored(uniqueScored);
  console.log(
    `\nDedupe: ${scored.length} listings -> ${deduped.unique.length} unique; ` +
      `${deduped.duplicateCount} duplicates across ${deduped.groups.length} group(s).`,
  );

  const decidedAt = new Date().toISOString();
  for (const { listing, evaluation } of scored) {
    const decisionId = sha256(`${listing.source}:${listing.externalId}:${decidedAt.slice(0, 10)}`).slice(0, 32);
    upsertDecision(db, {
      id: decisionId,
      question: `Shortlist this car for a family of four near ${brief.location.zip}?`,
      decision: evaluation.verdict,
      rationale: evaluation.reasons.join("; "),
      confidence: evaluation.confidence,
      evidenceJson: JSON.stringify({
        criteriaVersion: active.version,
        criteriaOverridden: briefOverridden,
        ...(briefOverridden ? { effectiveBriefJson: JSON.stringify(brief) } : {}),
        briefHash: sha256(JSON.stringify(brief)).slice(0, 16),
        score: evaluation.score,
        components: evaluation.components,
        hardFailures: evaluation.hardFailures,
        unknowns: evaluation.unknowns,
        listing: {
          source: listing.source,
          externalId: listing.externalId,
          url: listing.url,
          title: listing.title,
          priceEur: listing.priceEur,
          mileageKm: listing.mileageKm,
          firstRegistration: listing.firstRegistration,
          seats: listing.seats,
          doors: listing.doors,
          hasIsofix: listing.hasIsofix,
          redFlags: listing.redFlags,
        },
      }),
      createdAt: decidedAt,
    });
  }
  insertMemoryObservation(db, {
    kind: "source_run",
    content: `Fetched ${run.results.map((result) => `${result.source}:${result.refs.length}`).join(", ")}`,
    metadataJson: JSON.stringify({
      startedAt,
      results: run.results.map((result) => ({
        source: result.source,
        found: result.refs.length,
        totalResults: result.totalResults,
        integrity: result.integrity.ok,
      })),
      failures: run.failures,
    }),
    createdAt: decidedAt,
  });

  const after = countListings(db);
  const inserted = Math.max(0, after - before);
  console.log(`\nCriteria: v${active.version}`);
  console.log(`DB: ${dbPath}`);
  console.log(`raw: ${rawDir}`);
  console.log(`listings: ${before} -> ${after} (new: ${inserted})`);

  // Partial success is still usable: one blocked source must not stop the
  // analysis/eval chain when another source returned data.
  const anyUsableResult = run.results.some(isUsableSourceResult);
  process.exitCode = anyUsableResult ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
