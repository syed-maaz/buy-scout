import test from "node:test";
import assert from "node:assert/strict";
import { evaluateCar } from "../src/domain/cars/evaluate.js";
import type { NormalisedListing, SearchBrief } from "../src/core/types.js";

const brief: SearchBrief = {
  category: "car",
  budgetAllInEur: 6000,
  purchaseMaxEur: 5200,
  reserveEur: 800,
  location: { zip: "69168", radiusKm: 50 },
  hard: {
    minSeats: 5,
    minDoors: 4,
    minFirstRegistrationYear: 2010,
    maxMileageKm: 180000,
    fuel: "any",
    transmission: "any",
    excludeDamaged: true,
    excludeCommercialOnly: true,
  },
  soft: { prioritise: ["family"] },
  preferences: [],
};

function car(overrides: Partial<NormalisedListing> = {}): NormalisedListing {
  return {
    source: "autoscout24",
    externalId: "x",
    url: "https://example.test/x",
    title: "Kia Ceed",
    priceEur: 3990,
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
    priceLabel: "good-price",
    priceEvaluation: 2,
    priceMedianEur: 4500,
    damaged: false,
    commercialOnly: false,
    hasIsofix: true,
    huDue: "new",
    warranty: false,
    carfaxUrl: null,
    description: "Scheckheftgepflegt.",
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

test("a preference boosts the score without hiding the non-match", () => {
  const plain = evaluateCar(brief, car());
  const preferredBrief: SearchBrief = {
    ...brief,
    preferences: [
      { id: "p1", label: "Bose sound", field: "equipment", match: "contains", value: "Bose", weight: 10 },
    ],
  };
  const preferred = evaluateCar(preferredBrief, car({ equipment: ["Bose Sound System"] }));
  const other = evaluateCar(preferredBrief, car({ equipment: ["Standard audio"] }));

  assert.ok(preferred.score > plain.score);
  assert.equal(preferred.preferenceBoost, 10);
  assert.equal(preferred.preferenceMatches.length, 1);
  assert.equal(other.hardPass, true);
  assert.equal(other.verdict, "inspect");
  assert.equal(other.preferenceBoost, 0);
});

test("preference does not rescue a hard fail", () => {
  const preferredBrief: SearchBrief = {
    ...brief,
    preferences: [
      { id: "p1", label: "Bose", field: "equipment", match: "contains", value: "Bose", weight: 25 },
    ],
  };
  const e = evaluateCar(preferredBrief, car({ equipment: ["Bose"], damaged: true }));
  assert.equal(e.hardPass, false);
  assert.equal(e.score, 0);
  assert.equal(e.verdict, "reject");
});

test("equals match is exact for make", () => {
  const preferredBrief: SearchBrief = {
    ...brief,
    preferences: [
      { id: "p1", label: "Samsung", field: "make", match: "equals", value: "Samsung", weight: 15 },
    ],
  };
  assert.equal(evaluateCar(preferredBrief, car({ make: "Samsung" })).preferenceBoost, 15);
  assert.equal(evaluateCar(preferredBrief, car({ make: "Samsung Electronics" })).preferenceBoost, 0);
});

test("preference boost is capped at 25", () => {
  const preferredBrief: SearchBrief = {
    ...brief,
    preferences: [
      { id: "p1", label: "A", field: "equipment", match: "contains", value: "Bose", weight: 20 },
      { id: "p2", label: "B", field: "title", match: "contains", value: "Kia", weight: 20 },
    ],
  };
  assert.equal(evaluateCar(preferredBrief, car({ equipment: ["Bose"] })).preferenceBoost, 25);
});
