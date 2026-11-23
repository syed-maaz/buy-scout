import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  findListing,
  getPriceHistory,
  markListingUnavailable,
  openDb,
  upsertListing,
  upsertReplayListing,
} from "../src/db/index.js";
import { reparseSource } from "../src/cli/reparse.js";
import { buildManualListing } from "../src/core/manual.js";

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), "buy-scout-replay-"));
  return { dir, db: openDb(join(dir, "test.db")) };
}

function car(priceEur: number, lastSeenAt: string) {
  return {
    ...buildManualListing({
      title: "Volkswagen Passat 2.0 TDI",
      url: "https://example.test/replay-1",
      priceEur,
      mileageKm: 150000,
      year: 2013,
      fuel: "Diesel",
      transmission: "Automatik",
      bodyType: "Kombi",
      seats: 5,
      doors: 5,
      hasIsofix: true,
      city: "Walldorf",
      zip: "69190",
      description: "Scheckheftgepflegt",
    }),
    externalId: "replay-1",
    lastSeenAt,
    firstSeenAt: "2026-10-01T00:00:00.000Z",
  };
}

test("replay never resurrects a delisted listing", () => {
  const { dir, db } = tempDb();
  try {
    upsertListing(db, car(5000, "2026-11-05T09:00:00.000Z"));
    markListingUnavailable(db, {
      source: "manual",
      externalId: "replay-1",
      reason: "confirmed gone",
      checkedAt: "2026-11-04T09:00:00.000Z",
    });

    const result = upsertReplayListing(db, car(7000, "2026-11-01T09:00:00.000Z"), "2026-11-01T09:00:00.000Z");
    const row = findListing(db, "manual", "replay-1");

    assert.equal(result, "skipped");
    assert.equal(row?.priceEur, 5000);
    assert.equal(row?.lastSeenAt, "2026-11-05T09:00:00.000Z");
    assert.equal(row?.delistedAt, "2026-11-04T09:00:00.000Z");
    assert.equal(row?.delistReason, "confirmed gone");
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("replay fills null fields but never overwrites live price or last seen", () => {
  const { dir, db } = tempDb();
  try {
    const live = car(5000, "2026-11-05T09:00:00.000Z");
    upsertListing(db, { ...live, bodyType: null });
    const archived = car(7000, "2026-11-01T09:00:00.000Z");

    const result = upsertReplayListing(db, { ...archived, bodyType: "Kombi" }, "2026-11-01T09:00:00.000Z");
    const row = findListing(db, "manual", "replay-1");

    assert.equal(result, "updated");
    assert.equal(row?.priceEur, 5000);
    assert.equal(row?.lastSeenAt, "2026-11-05T09:00:00.000Z");
    assert.equal(row?.bodyType, "Kombi");
    assert.equal(getPriceHistory(db, "manual", "replay-1").length, 0);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reparse preserves a delisted row from a historical page", () => {
  const { dir, db } = tempDb();
  const htmlPath = join(dir, "page.html");
  try {
    writeFileSync(
      htmlPath,
      `<html><body><main><article data-adid="2876543210" data-href="/s-anzeige/kia/2876543210-216-1200">
        <div><span>68753 Waghäusel</span></div>
        <h3><a href="/s-anzeige/kia/2876543210-216-1200">Kia Ceed SW</a></h3>
        <p>4.250 €</p>
      </article></main></body></html>`,
      "utf8",
    );
    db.prepare(
      `INSERT INTO raw_pages (run_id, source, page, url, fetched_at, http_status, html_path, listing_count, total_results)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "reparse-test",
      "kleinanzeigen",
      1,
      "https://example.test/search",
      "2026-11-01T09:00:00.000Z",
      200,
      htmlPath,
      1,
      1,
    );

    const listing = {
      ...buildManualListing({
        title: "Kia Ceed SW",
        url: "https://www.kleinanzeigen.de/s-anzeige/kia/2876543210-216-1200",
        priceEur: 5000,
        mileageKm: 100000,
        year: 2013,
        fuel: "Diesel",
        transmission: "Schaltgetriebe",
        bodyType: "Kombi",
        seats: 5,
        doors: 5,
        hasIsofix: true,
        city: "Waghäusel",
        zip: "68753",
        description: "Scheckheftgepflegt",
      }),
      source: "kleinanzeigen" as const,
      externalId: "2876543210",
      lastSeenAt: "2026-11-05T09:00:00.000Z",
      firstSeenAt: "2026-10-01T00:00:00.000Z",
    };
    upsertListing(db, listing);
    markListingUnavailable(db, {
      source: "kleinanzeigen",
      externalId: "2876543210",
      reason: "confirmed gone",
      checkedAt: "2026-11-04T09:00:00.000Z",
    });

    const summary = reparseSource(db, "kleinanzeigen", 1);
    const row = findListing(db, "kleinanzeigen", "2876543210");

    assert.equal(summary.skippedDelisted, 1);
    assert.equal(row?.priceEur, 5000);
    assert.equal(row?.lastSeenAt, "2026-11-05T09:00:00.000Z");
    assert.notEqual(row?.delistedAt, null);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
