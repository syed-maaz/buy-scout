import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getPriceChange,
  getPriceHistory,
  insertPriceObservation,
  listingDbId,
  openDb,
  upsertListing,
  type Db,
} from "../src/db/index.js";
import type { NormalisedListing } from "../src/core/types.js";

function car(overrides: Partial<NormalisedListing> = {}): NormalisedListing {
  return {
    source: "autoscout24",
    externalId: "price-1",
    url: "https://example.test/price-1",
    title: "Kia Ceed",
    priceEur: 4990,
    currency: "EUR",
    make: "Kia",
    model: "Ceed",
    variant: null,
    firstRegistration: "2013-06-01",
    mileageKm: 120000,
    fuel: "Benzin",
    transmission: "Schaltgetriebe",
    powerKw: 85,
    powerPs: 116,
    bodyType: "Kombi",
    seats: 5,
    doors: 4,
    sellerType: "dealer",
    sellerName: null,
    city: "Wiesloch",
    zip: "69168",
    distanceKm: 10,
    priceLabel: null,
    priceEvaluation: null,
    priceMedianEur: null,
    damaged: false,
    commercialOnly: false,
    hasIsofix: true,
    huDue: "new",
    warranty: false,
    carfaxUrl: null,
    description: null,
    equipment: [],
    redFlags: [],
    summary: null,
    imageUrl: null,
    firstSeenAt: "2026-10-20T10:00:00.000Z",
    lastSeenAt: "2026-10-20T10:00:00.000Z",
    contentHash: "hash",
    rawJson: "{}",
    ...overrides,
  };
}

function withDb(run: (db: Db) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "buy-scout-price-"));
  const db = openDb(join(dir, "test.db"));
  try {
    run(db);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

function seed(db: Db, overrides: Partial<NormalisedListing> = {}): number {
  const listing = car(overrides);
  upsertListing(db, listing);
  const id = listingDbId(db, listing.source, listing.externalId);
  assert.notEqual(id, null);
  return id as number;
}

test("no observations -> no price change", () => {
  withDb((db) => {
    seed(db);
    assert.deepEqual(getPriceHistory(db, "autoscout24", "price-1"), []);
    assert.deepEqual(getPriceChange(db, "autoscout24", "price-1"), {
      latest: null,
      previous: null,
      deltaEur: null,
      observationCount: 0,
    });
    // An unknown listing behaves the same instead of throwing.
    assert.equal(getPriceChange(db, "autoscout24", "missing").latest, null);
    assert.deepEqual(getPriceHistory(db, "autoscout24", "missing"), []);
  });
});

test("one observation -> history length 1 and no delta", () => {
  withDb((db) => {
    const id = seed(db);
    insertPriceObservation(db, {
      listingId: id,
      priceEur: 4990,
      observedAt: "2026-10-20T10:00:00.000Z",
    });

    assert.deepEqual(getPriceHistory(db, "autoscout24", "price-1"), [
      { priceEur: 4990, observedAt: "2026-10-20T10:00:00.000Z" },
    ]);
    assert.deepEqual(getPriceChange(db, "autoscout24", "price-1"), {
      latest: { priceEur: 4990, observedAt: "2026-10-20T10:00:00.000Z" },
      previous: null,
      deltaEur: null,
      observationCount: 1,
    });
  });
});

test("two observations -> correct delta and dates", () => {
  withDb((db) => {
    const id = seed(db);
    // Insert newest first to prove ordering comes from observed_at, not row id.
    insertPriceObservation(db, {
      listingId: id,
      priceEur: 4490,
      observedAt: "2026-10-27T09:30:00.000Z",
    });
    insertPriceObservation(db, {
      listingId: id,
      priceEur: 4990,
      observedAt: "2026-10-20T10:00:00.000Z",
    });

    // History is oldest -> newest: last element is the latest observation.
    assert.deepEqual(getPriceHistory(db, "autoscout24", "price-1"), [
      { priceEur: 4990, observedAt: "2026-10-20T10:00:00.000Z" },
      { priceEur: 4490, observedAt: "2026-10-27T09:30:00.000Z" },
    ]);

    const change = getPriceChange(db, "autoscout24", "price-1");
    assert.deepEqual(change.latest, { priceEur: 4490, observedAt: "2026-10-27T09:30:00.000Z" });
    assert.deepEqual(change.previous, { priceEur: 4990, observedAt: "2026-10-20T10:00:00.000Z" });
    assert.equal(change.deltaEur, -500);
    assert.equal(change.observationCount, 2);

    // limit keeps the newest points but still returns them oldest -> newest.
    assert.deepEqual(getPriceHistory(db, "autoscout24", "price-1", 1), [
      { priceEur: 4490, observedAt: "2026-10-27T09:30:00.000Z" },
    ]);
    assert.deepEqual(getPriceHistory(db, "autoscout24", "price-1", 0), []);
  });
});

test("price history is isolated by source and externalId", () => {
  withDb((db) => {
    const a = seed(db, { source: "autoscout24", externalId: "same-id" });
    const b = seed(db, { source: "kleinanzeigen", externalId: "same-id" });
    const c = seed(db, { source: "autoscout24", externalId: "other-id" });
    insertPriceObservation(db, { listingId: a, priceEur: 4000, observedAt: "2026-10-20T10:00:00.000Z" });
    insertPriceObservation(db, { listingId: a, priceEur: 3800, observedAt: "2026-10-21T10:00:00.000Z" });
    insertPriceObservation(db, { listingId: b, priceEur: 9000, observedAt: "2026-10-22T10:00:00.000Z" });
    insertPriceObservation(db, { listingId: c, priceEur: 7000, observedAt: "2026-10-23T10:00:00.000Z" });

    const sameId = getPriceChange(db, "autoscout24", "same-id");
    assert.equal(sameId.observationCount, 2);
    assert.equal(sameId.latest?.priceEur, 3800);
    assert.equal(sameId.deltaEur, -200);
    assert.equal(getPriceHistory(db, "autoscout24", "same-id").length, 2);

    const otherSource = getPriceChange(db, "kleinanzeigen", "same-id");
    assert.equal(otherSource.observationCount, 1);
    assert.equal(otherSource.latest?.priceEur, 9000);
    assert.equal(otherSource.previous, null);
    assert.equal(otherSource.deltaEur, null);

    assert.equal(getPriceHistory(db, "autoscout24", "other-id").length, 1);
    assert.equal(getPriceChange(db, "autoscout24", "other-id").latest?.priceEur, 7000);
    assert.equal(getPriceChange(db, "autoscout24", "nope").observationCount, 0);
  });
});
