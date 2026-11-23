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
};

function car(overrides: Partial<NormalisedListing> = {}): NormalisedListing {
  return {
    source: "autoscout24",
    externalId: "x",
    url: "https://example.test/x",
    title: "Test Car",
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
    description: "Scheckheftgepflegt, unfallfrei.",
    equipment: ["Isofix"],
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

test("adversarial: price over cap", () => assert.equal(evaluateCar(brief, car({ priceEur: 6000 })).hardPass, false));
test("adversarial: distance over radius", () => assert.equal(evaluateCar(brief, car({ distanceKm: 56 })).hardPass, false));
test("adversarial: damaged", () => assert.equal(evaluateCar(brief, car({ damaged: true })).hardPass, false));
test("adversarial: commercial only", () => assert.equal(evaluateCar(brief, car({ commercialOnly: true })).hardPass, false));
test("adversarial: 4 seats", () => assert.equal(evaluateCar(brief, car({ seats: 4 })).hardPass, false));
test("adversarial: 3 doors", () => assert.equal(evaluateCar(brief, car({ doors: 3 })).hardPass, false));
test("adversarial: no isofix", () => assert.equal(evaluateCar(brief, car({ hasIsofix: false })).hardPass, false));
test("adversarial: too old", () => assert.equal(evaluateCar(brief, car({ firstRegistration: "2008-01-01" })).hardPass, false));
test("adversarial: too many km", () => assert.equal(evaluateCar(brief, car({ mileageKm: 250000 })).hardPass, false));
test("adversarial: red flag Unfallschaden", () => assert.equal(evaluateCar(brief, car({ redFlags: ["Unfallschaden"] })).hardPass, false));
test("adversarial: red flag Bastler", () => assert.equal(evaluateCar(brief, car({ redFlags: ["Bastler"] })).hardPass, false));
test("adversarial: red flag Motorschaden", () => assert.equal(evaluateCar(brief, car({ redFlags: ["Motorschaden"] })).hardPass, false));
test("adversarial: red flag ohne TÜV", () => assert.equal(evaluateCar(brief, car({ redFlags: ["ohne TÜV"] })).hardPass, false));
test("adversarial: fuel mismatch", () => {
  const petrolBrief = { ...brief, hard: { ...brief.hard, fuel: "petrol" as const } };
  assert.equal(evaluateCar(petrolBrief, car({ fuel: "Diesel" })).hardPass, false);
});
test("adversarial: gearbox mismatch", () => {
  const manualBrief = { ...brief, hard: { ...brief.hard, transmission: "manual" as const } };
  assert.equal(evaluateCar(manualBrief, car({ transmission: "Automatik" })).hardPass, false);
});
test("adversarial: unknown family fields become ask", () => {
  const e = evaluateCar(brief, car({ seats: null, doors: null, hasIsofix: null, bodyType: null }));
  assert.equal(e.hardPass, true);
  assert.equal(e.verdict, "ask");
});
test("adversarial: clean car becomes inspect", () => {
  const e = evaluateCar(brief, car());
  assert.equal(e.hardPass, true);
  assert.equal(e.verdict, "inspect");
});
test("adversarial: price exactly at cap is allowed", () => {
  assert.equal(evaluateCar(brief, car({ priceEur: 5200 })).hardPass, true);
});
test("adversarial: distance exactly at radius is allowed", () => {
  assert.equal(evaluateCar(brief, car({ distanceKm: 50 })).hardPass, true);
});
test("adversarial: hard fail gets score 0", () => {
  const e = evaluateCar(brief, car({ damaged: true }));
  assert.equal(e.score, 0);
  assert.equal(e.verdict, "reject");
});
