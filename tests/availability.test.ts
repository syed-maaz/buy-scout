import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  findListing,
  latestListings,
  markListingAvailable,
  markListingUnavailable,
  openDb,
  touchListing,
  upsertListing,
} from "../src/db/index.js";
import { buildManualListing } from "../src/core/manual.js";
import { sweepAvailability } from "../src/core/availability.js";
import type { SourceAdapter } from "../src/core/types.js";

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), "buy-scout-availability-"));
  return { dir, db: openDb(join(dir, "test.db")), close: (db: ReturnType<typeof openDb>) => { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

function car(externalId: string, lastSeenAt = "2026-10-28T10:00:00.000Z") {
  return {
    ...buildManualListing({
      title: "Volkswagen Passat 2.0 TDI",
      url: `https://example.test/${externalId}`,
      priceEur: 6500,
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
    externalId,
    lastSeenAt,
    firstSeenAt: "2026-10-28T10:00:00.000Z",
  };
}

test("unavailable listings are hidden from the default list but remain retrievable", () => {
  const { dir, db } = tempDb();
  try {
    upsertListing(db, car("gone-1"));
    assert.equal(latestListings(db).length, 1);
    markListingUnavailable(db, { source: "manual", externalId: "gone-1", reason: "source says gone" });
    assert.equal(latestListings(db).length, 0);
    assert.equal(latestListings(db, 10, { includeUnavailable: true }).length, 1);
    const gone = findListing(db, "manual", "gone-1");
    assert.equal(gone?.delistedAt !== null, true);
    assert.equal(gone?.delistReason, "source says gone");
    assert.equal(latestListings(db, 10, { includeUnavailable: true })[0].delistedAt !== null, true);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("seeing a card again or confirming it is live restores it", () => {
  const { dir, db } = tempDb();
  try {
    upsertListing(db, car("restore-1"));
    markListingUnavailable(db, { source: "manual", externalId: "restore-1", reason: "410" });
    assert.equal(latestListings(db).length, 0);
    touchListing(db, "manual", "restore-1", "2026-11-03T10:00:00.000Z");
    assert.equal(latestListings(db).length, 1);
    markListingUnavailable(db, { source: "manual", externalId: "restore-1", reason: "410" });
    markListingAvailable(db, { source: "manual", externalId: "restore-1" });
    assert.equal(latestListings(db).length, 1);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("availability sweep only retires listings with a reliable gone signal", async () => {
  const { dir, db } = tempDb();
  const statuses = new Map([
    ["gone-1", "gone" as const],
    ["live-1", "available" as const],
    ["unknown-1", "unknown" as const],
  ]);
  const adapter: SourceAdapter = {
    id: "manual",
    label: "Manual",
    enabled: true,
    async search() { throw new Error("not used"); },
    async checkAvailability(ref) { return statuses.get(ref.externalId) ?? "unknown"; },
  };
  try {
    for (const id of statuses.keys()) upsertListing(db, car(id, "2026-10-01T10:00:00.000Z"));
    const result = await sweepAvailability(db, [adapter], { limit: 10, staleAfterHours: 24, delayMs: 0 });
    assert.equal(result.checked, 3);
    assert.equal(result.gone, 1);
    assert.equal(result.available, 1);
    assert.equal(result.unknown, 1);
    assert.equal(result.goneListings[0].externalId, "gone-1");
    assert.equal(latestListings(db).length, 2);
    assert.equal(latestListings(db, 10, { includeUnavailable: true }).length, 3);
    const unknown = findListing(db, "manual", "unknown-1");
    assert.equal(unknown?.delistedAt ?? null, null);
    assert.notEqual(unknown?.availabilityCheckedAt ?? null, null);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sweep ignores listings seen inside the stale window", async () => {
  const { dir, db } = tempDb();
  const adapter: SourceAdapter = {
    id: "manual",
    label: "Manual",
    enabled: true,
    async search() { throw new Error("not used"); },
    async checkAvailability() { return "gone"; },
  };
  try {
    upsertListing(db, car("fresh-1", new Date().toISOString()));
    const result = await sweepAvailability(db, [adapter], { limit: 10, staleAfterHours: 24, delayMs: 0 });
    assert.equal(result.checked, 0);
    assert.equal(latestListings(db).length, 1);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a sweep rotates to unexamined stale listings on the next run", async () => {
  const { dir, db } = tempDb();
  const checked: string[] = [];
  const adapter: SourceAdapter = {
    id: "manual",
    label: "Manual",
    enabled: true,
    async search() { throw new Error("not used"); },
    async checkAvailability(ref) { checked.push(ref.externalId); return "available"; },
  };
  try {
    const ids = ["oldest", "second", "third", "fourth"];
    for (const [index, id] of ids.entries()) {
      upsertListing(db, car(id, `2026-10-0${index + 1}T10:00:00.000Z`));
    }
    await sweepAvailability(db, [adapter], { limit: 2, staleAfterHours: 24, delayMs: 0, order: "oldest" });
    assert.deepEqual(checked, ["oldest", "second"]);

    checked.length = 0;
    await sweepAvailability(db, [adapter], { limit: 2, staleAfterHours: 24, delayMs: 0, order: "oldest" });
    assert.deepEqual(checked, ["third", "fourth"]);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("unsupported sources do not consume the availability limit", async () => {
  const { dir, db } = tempDb();
  const checked: string[] = [];
  const adapter: SourceAdapter = {
    id: "manual",
    label: "Manual",
    enabled: true,
    async search() { throw new Error("not used"); },
    async checkAvailability(ref) { checked.push(ref.externalId); return "available"; },
  };
  try {
    upsertListing(db, {
      ...car("unsupported", "2026-10-01T10:00:00.000Z"),
      source: "autouncle",
    });
    upsertListing(db, car("supported", "2026-10-02T10:00:00.000Z"));
    await sweepAvailability(db, [adapter], { limit: 1, staleAfterHours: 24, delayMs: 0, order: "oldest" });
    assert.deepEqual(checked, ["supported"]);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
