import test from "node:test";
import assert from "node:assert/strict";
import {
  parseFirstRegistration,
  parseGermanInt,
  parsePower,
} from "../src/core/parse.js";
import { checkFilterIntegrity } from "../src/core/integrity.js";
import { buildAs24Url, normaliseAs24Listing, type As24Listing } from "../src/sources/autoscout24.js";
import { mergeAs24Detail, type As24Detail } from "../src/sources/autoscout24-detail.js";
import { evaluateCar } from "../src/domain/cars/evaluate.js";
import type { RawRef, SearchBrief } from "../src/core/types.js";

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
  soft: {
    prioritise: ["family", "safety", "cost", "reliability", "deal"],
  },
};

const sample: As24Listing = {
  id: "abc-123",
  title: "Kia Ceed SW",
  url: "/angebote/kia-ceed-abc-123",
  images: ["https://example.test/car.jpg"],
  price: { priceRaw: 3990, priceEvaluation: 2 },
  vehicle: {
    make: "Kia",
    model: "Ceed SW",
    variant: "Ceed",
    motorTypeName: "1.6 CRDI",
    transmission: "Schaltgetriebe",
    fuel: "Diesel",
    mileageInKm: "165.000 km",
    isCurrentlyDamaged: false,
    subtitle: "Garantie, Anhängerkupplung",
  },
  location: { zip: "68753", city: "Waghäusel", distanceToSearchLocationInKm: 14 },
  seller: { type: "Dealer", companyName: "Example Cars GmbH" },
  tracking: { firstRegistration: "06-2012", priceLabel: "good-price" },
  vehicleDetails: [
    { ariaLabel: "Leistung", data: "85 kW (116 PS)" },
    { ariaLabel: "Erstzulassung", data: "06/2012" },
  ],
};

test("parses German integers", () => {
  assert.equal(parseGermanInt("165.000 km"), 165000);
  assert.equal(parseGermanInt("1.582 cm³"), 1582);
  assert.equal(parseGermanInt(null), null);
});

test("parses first registration", () => {
  assert.equal(parseFirstRegistration("06-2012"), "2012-06-01");
  assert.equal(parseFirstRegistration("06/2012"), "2012-06-01");
  assert.equal(parseFirstRegistration("2012"), null);
});

test("parses power", () => {
  assert.deepEqual(parsePower("85 kW (116 PS)"), { kw: 85, ps: 116 });
});

test("normalizes an AutoScout24 listing", () => {
  const listing = normaliseAs24Listing(sample);
  assert.equal(listing.externalId, "abc-123");
  assert.equal(listing.priceEur, 3990);
  assert.equal(listing.make, "Kia");
  assert.equal(listing.firstRegistration, "2012-06-01");
  assert.equal(listing.mileageKm, 165000);
  assert.equal(listing.powerKw, 85);
  assert.equal(listing.sellerType, "dealer");
  assert.equal(listing.distanceKm, 14);
  assert.equal(listing.damaged, false);
});

test("filter integrity catches leaked prices", () => {
  const refs: RawRef[] = [
    { source: "autoscout24", externalId: "1", url: "https://x", page: 1, payload: { price: { priceRaw: 6200 }, location: { distanceToSearchLocationInKm: 10 } } },
  ];
  const integrity = checkFilterIntegrity(brief, refs, 4328);
  assert.equal(integrity.ok, false);
  assert.match(integrity.reasons.join(" "), /price filter leaked/);
});

test("filter integrity accepts a sane result set", () => {
  const refs: RawRef[] = [
    { source: "autoscout24", externalId: "1", url: "https://x", page: 1, payload: { price: { priceRaw: 3990 }, location: { distanceToSearchLocationInKm: 14 } } },
  ];
  const integrity = checkFilterIntegrity(brief, refs, 4328);
  assert.equal(integrity.ok, true);
});


const detail: As24Detail = {
  id: "abc-123",
  title: "Kia Ceed SW",
  description:
    "<p>Sehr gepflegter Kombi. Isofix vorhanden. HU/AU neu. Scheckheftgepflegt.</p>",
  vehicle: {
    numberOfSeats: 5,
    numberOfDoors: 4,
    bodyType: "Kombi",
    firstRegistrationDateRaw: "2012-06-01",
    mileageInKmRaw: 165000,
    rawPowerInKw: 85,
    rawPowerInHp: 116,
    transmissionType: "Schaltgetriebe",
    fuelCategory: { formatted: "Diesel" },
    equipment: {
      safety: [{ id: "Isofix" }, { id: "ESP" }],
      comfort: [{ id: "Klimaanlage" }],
    },
  },
  prices: { public: { median: 4500, priceRaw: 3990 } },
  price: { priceRaw: 3990, priceEvaluation: 2 },
  seller: { isDealer: true, companyName: "Example Cars GmbH" },
  warrantyExists: false,
  vehicleReport: { carfax: { reportUrlEn: "https://example.test/carfax" } },
  location: { zip: "68753", city: "Waghäusel" },
};

test("merges AutoScout24 detail fields", () => {
  const listing = mergeAs24Detail(normaliseAs24Listing(sample), detail);
  assert.equal(listing.seats, 5);
  assert.equal(listing.doors, 4);
  assert.equal(listing.bodyType, "Kombi");
  assert.equal(listing.hasIsofix, true);
  assert.equal(listing.priceMedianEur, 4500);
  assert.equal(listing.huDue, "new");
  assert.equal(listing.warranty, false);
  assert.equal(listing.carfaxUrl, "https://example.test/carfax");
  assert.match(listing.description ?? "", /Isofix/);
  assert.ok(listing.equipment.includes("Isofix"));
});

test("family car passes hard gates when known fields fit", () => {
  const listing = mergeAs24Detail(normaliseAs24Listing(sample), detail);
  const evaluation = evaluateCar(brief, listing);
  assert.equal(evaluation.hardPass, true);
  assert.equal(evaluation.verdict, "inspect");
  assert.ok(evaluation.score > 0);
  assert.equal(evaluation.components.family, 1);
});

test("commercial-only seller is a hard fail", () => {
  const listing = mergeAs24Detail(normaliseAs24Listing(sample), detail);
  const evaluation = evaluateCar(brief, { ...listing, commercialOnly: true });
  assert.equal(evaluation.hardPass, false);
  assert.equal(evaluation.verdict, "reject");
  assert.equal(evaluation.score, 0);
  assert.match(evaluation.hardFailures.join(" "), /commercial/);
});

test("3-door car is a hard fail for a family profile", () => {
  const listing = mergeAs24Detail(normaliseAs24Listing(sample), detail);
  const evaluation = evaluateCar(brief, { ...listing, doors: 3 });
  assert.equal(evaluation.hardPass, false);
  assert.match(evaluation.hardFailures.join(" "), /doors 3/);
});

test("unknown family fields pass but lower confidence", () => {
  const listing = mergeAs24Detail(normaliseAs24Listing(sample), detail);
  const evaluation = evaluateCar(brief, { ...listing, seats: null, doors: null, hasIsofix: null });
  assert.equal(evaluation.hardPass, true);
  assert.equal(evaluation.verdict, "ask");
  assert.ok(evaluation.unknowns.includes("seats"));
  assert.ok(evaluation.unknowns.includes("doors"));
  assert.ok(evaluation.unknowns.includes("isofix"));
  assert.ok(evaluation.confidence < 1);
});


test("builds newest-first URL with optional price floor", () => {
  const url = new URL(buildAs24Url(brief, 2, { sort: "age", priceFrom: 7000 }));
  assert.equal(url.searchParams.get("priceto"), "5200");
  assert.equal(url.searchParams.get("pricefrom"), "7000");
  assert.equal(url.searchParams.get("sort"), "age");
  assert.equal(url.searchParams.get("desc"), "1");
  assert.equal(url.searchParams.get("page"), "2");
  assert.equal(url.searchParams.get("zip"), "69168");
});
