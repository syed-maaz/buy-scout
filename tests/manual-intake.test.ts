import test from "node:test";
import assert from "node:assert/strict";
import { buildManualListing, manualInputFromArgs } from "../src/core/manual.js";

const input = {
  title: "Volkswagen Passat 2.0 TDI",
  url: "https://example.test/manual-passat",
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
};

test("manual intake builds a normalised listing with a stable id", () => {
  const first = buildManualListing(input, new Date("2026-10-31T12:00:00Z"));
  const second = buildManualListing(input, new Date("2026-10-31T13:00:00Z"));
  assert.equal(first.externalId, second.externalId);
  assert.equal(first.source, "manual");
  assert.equal(first.priceEur, 6500);
  assert.equal(first.seats, 5);
  assert.equal(first.hasIsofix, true);
  assert.equal(first.distanceKm, 5);
});

test("manual intake parses the command flags", () => {
  const parsed = manualInputFromArgs([
    "--title", "VW Golf",
    "--url", "https://example.test/golf",
    "--price", "5000",
    "--mileage", "120000",
    "--year", "2014",
    "--seats", "5",
    "--doors", "5",
    "--isofix", "yes",
    "--zip", "69168",
  ]);
  assert.equal(parsed.title, "VW Golf");
  assert.equal(parsed.priceEur, 5000);
  assert.equal(parsed.hasIsofix, true);
  assert.equal(parsed.year, 2014);
});

test("manual intake requires a title and URL", () => {
  assert.throws(() => manualInputFromArgs(["--url", "https://example.test"]), /title/);
  assert.throws(() => manualInputFromArgs(["--title", "VW"]), /url/);
});
