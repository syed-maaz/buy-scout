import test from "node:test";
import assert from "node:assert/strict";
import { dedupeListings } from "../src/core/dedupe.js";
import type { NormalisedListing } from "../src/core/types.js";

function listing(overrides: Partial<NormalisedListing> = {}): NormalisedListing {
  return {
    source: "autoscout24",
    externalId: "1",
    url: "https://example.test/1",
    title: "Kia Ceed SW",
    priceEur: 3990,
    currency: "EUR",
    make: "Kia",
    model: "Ceed SW",
    variant: null,
    firstRegistration: "2012-06-01",
    mileageKm: 165000,
    fuel: "Diesel",
    transmission: "Schaltgetriebe",
    powerKw: 85,
    powerPs: 116,
    bodyType: "Kombi",
    seats: 5,
    doors: 4,
    sellerType: "dealer",
    sellerName: "A",
    city: "Waghäusel",
    zip: "68753",
    distanceKm: 14,
    priceLabel: "good-price",
    priceEvaluation: 2,
    priceMedianEur: 4500,
    damaged: false,
    commercialOnly: false,
    hasIsofix: true,
    huDue: "new",
    warranty: false,
    carfaxUrl: null,
    description: "x",
    equipment: [],
    redFlags: [],
    summary: null,
    imageUrl: null,
    firstSeenAt: "2026-10-28T00:00:00.000Z",
    lastSeenAt: "2026-10-28T00:00:00.000Z",
    contentHash: "x",
    rawJson: "{}",
    ...overrides,
  };
}

test("dedupes the same car across sources", () => {
  const result = dedupeListings([
    listing({ source: "autoscout24", externalId: "a" }),
    listing({ source: "mobile_de", externalId: "b" }),
  ]);
  assert.equal(result.unique.length, 1);
  assert.equal(result.duplicateCount, 1);
  assert.equal(result.groups.length, 1);
});

test("does not merge cars with different mileage bands", () => {
  const result = dedupeListings([
    listing({ externalId: "a", mileageKm: 165000 }),
    listing({ externalId: "b", mileageKm: 120000 }),
  ]);
  assert.equal(result.unique.length, 2);
  assert.equal(result.duplicateCount, 0);
});

test("does not merge different models", () => {
  const result = dedupeListings([
    listing({ externalId: "a", model: "Ceed SW" }),
    listing({ externalId: "b", model: "Ceed" }),
  ]);
  assert.equal(result.unique.length, 2);
});

test("does not merge listings whose make or model is unknown", () => {
  const car = {
    ...listing(),
    make: null,
    model: null,
    source: "kleinanzeigen" as const,
    externalId: "k1",
  };
  const result = dedupeListings([car, { ...car, externalId: "k2" }]);
  assert.equal(result.unique.length, 2);
  assert.equal(result.duplicateCount, 0);
});
