import test from "node:test";
import assert from "node:assert/strict";
import { evaluateCar } from "../src/domain/cars/evaluate.js";
import type { NormalisedListing, SearchBrief } from "../src/core/types.js";

const NOW = new Date("2026-10-31T12:00:00Z");

const brief: SearchBrief = {
  category: "car",
  budgetAllInEur: 7800,
  purchaseMaxEur: 7000,
  reserveEur: 800,
  location: { zip: "69168", radiusKm: 200 },
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
  soft: {
    prioritise: ["family", "safety", "cost", "reliability", "deal"],
  },
  preferences: [
    { id: "vw", label: "VW bias", field: "make", match: "contains", value: "Volkswagen", weight: 20 },
    { id: "passat", label: "Passat bias", field: "model", match: "contains", value: "Passat", weight: 15 },
    { id: "auto", label: "Automatic", field: "transmission", match: "contains", value: "Automatik", weight: 10 },
  ],
};

function listing(overrides: Partial<NormalisedListing> = {}): NormalisedListing {
  return {
    source: "autoscout24",
    externalId: "golden-1",
    url: "https://example.test/car",
    title: "Volkswagen Passat 2.0 TDI",
    priceEur: 6000,
    currency: "EUR",
    make: "Volkswagen",
    model: "Passat",
    variant: "2.0 TDI",
    firstRegistration: "2014-06-01",
    mileageKm: 120000,
    fuel: "Diesel",
    transmission: "Automatik",
    powerKw: 110,
    powerPs: 150,
    bodyType: "Kombi",
    seats: 5,
    doors: 5,
    sellerType: "dealer",
    sellerName: "Example",
    city: "Walldorf",
    zip: "69190",
    distanceKm: 20,
    priceLabel: "fair-price",
    priceEvaluation: null,
    priceMedianEur: null,
    damaged: false,
    commercialOnly: false,
    hasIsofix: true,
    huDue: "2027-06-01",
    warranty: null,
    carfaxUrl: null,
    description: "Scheckheftgepflegt, unfallfrei.",
    equipment: ["Klima"],
    redFlags: [],
    summary: null,
    imageUrl: null,
    firstSeenAt: "2026-10-01T00:00:00Z",
    lastSeenAt: "2026-10-31T00:00:00Z",
    contentHash: "abc",
    rawJson: "{}",
    ...overrides,
  };
}

test("golden: a complete family car is INSPECT", () => {
  const result = evaluateCar(brief, listing(), NOW);
  assert.equal(result.hardPass, true);
  assert.equal(result.verdict, "inspect");
  assert.equal(result.score, 100);
});

test("golden: the car cap is inclusive and one euro over rejects", () => {
  assert.equal(evaluateCar(brief, listing({ priceEur: 7000 }), NOW).hardPass, true);
  const over = evaluateCar(brief, listing({ priceEur: 7001 }), NOW);
  assert.equal(over.hardPass, false);
  assert.equal(over.verdict, "reject");
  assert.equal(over.score, 0);
});

test("golden: the shared distance tolerance is 10 km at a 200 km radius", () => {
  assert.equal(evaluateCar(brief, listing({ distanceKm: 210 }), NOW).hardPass, true);
  const over = evaluateCar(brief, listing({ distanceKm: 211 }), NOW);
  assert.equal(over.verdict, "reject");
  assert.match(over.hardFailures.join(" "), /distance/);
});

test("golden: missing seats makes the car ASK, not INSPECT", () => {
  const result = evaluateCar(brief, listing({ seats: null }), NOW);
  assert.equal(result.hardPass, true);
  assert.equal(result.verdict, "ask");
  assert.ok(result.unknowns.includes("seats"));
});

test("golden: missing ISOFIX makes the car ASK", () => {
  const result = evaluateCar(brief, listing({ hasIsofix: null }), NOW);
  assert.equal(result.verdict, "ask");
  assert.ok(result.unknowns.includes("isofix"));
});

test("golden: false ISOFIX is a hard fail", () => {
  const result = evaluateCar(brief, listing({ hasIsofix: false }), NOW);
  assert.equal(result.verdict, "reject");
  assert.match(result.hardFailures.join(" "), /ISOFIX/);
});

test("golden: a manual car fails an automatic-only brief", () => {
  const result = evaluateCar({ ...brief, hard: { ...brief.hard, transmission: "automatic" } }, listing({ transmission: "Schaltgetriebe" }), NOW);
  assert.equal(result.verdict, "reject");
  assert.match(result.hardFailures.join(" "), /transmission/);
});

test("golden: a damaged car is rejected", () => {
  const result = evaluateCar(brief, listing({ damaged: true }), NOW);
  assert.equal(result.verdict, "reject");
  assert.match(result.hardFailures.join(" "), /damaged/);
});

test("golden: an implausibly cheap modern car is rejected", () => {
  const result = evaluateCar(brief, listing({ priceEur: 500, firstRegistration: "2020-01-01" }), NOW);
  assert.equal(result.verdict, "reject");
  assert.match(result.hardFailures.join(" "), /implausibly low/);
});

test("golden: a red-flag listing is rejected", () => {
  const result = evaluateCar(brief, listing({ redFlags: ["Unfallschaden"] }), NOW);
  assert.equal(result.verdict, "reject");
  assert.match(result.hardFailures.join(" "), /accident|Unfall/i);
});

test("golden: preference boosts are capped at 25", () => {
  const result = evaluateCar(brief, listing(), NOW);
  assert.equal(result.preferenceBoost, 25);
  assert.ok(result.preferenceMatches.length >= 3);
  assert.equal(result.components.preference, 1);
});

test("golden: required fuel unknown produces ASK, not INSPECT", () => {
  const result = evaluateCar({ ...brief, hard: { ...brief.hard, fuel: "diesel" } }, listing({ fuel: null }), NOW);
  assert.equal(result.hardPass, true);
  assert.equal(result.verdict, "ask");
  assert.ok(result.unknowns.includes("fuel"));
});

test("golden: required transmission unknown produces ASK, not INSPECT", () => {
  const result = evaluateCar(
    { ...brief, hard: { ...brief.hard, transmission: "automatic" } },
    listing({ transmission: null }),
    NOW,
  );
  assert.equal(result.hardPass, true);
  assert.equal(result.verdict, "ask");
  assert.ok(result.unknowns.includes("transmission"));
});

test("golden: unknown damage status produces ASK when damage is excluded", () => {
  const result = evaluateCar(brief, listing({ damaged: null }), NOW);
  assert.equal(result.verdict, "ask");
  assert.ok(result.unknowns.includes("damaged"));
});

test("golden: unknown commercial-only status produces ASK when excluded", () => {
  const result = evaluateCar(brief, listing({ commercialOnly: null }), NOW);
  assert.equal(result.verdict, "ask");
  assert.ok(result.unknowns.includes("commercialOnly"));
});
