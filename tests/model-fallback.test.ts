import test from "node:test";
import assert from "node:assert/strict";
import { buildManualListing } from "../src/core/manual.js";
import { evaluateCar } from "../src/domain/cars/evaluate.js";
import { analyzeListing } from "../src/intelligence/analyst.js";
import { researchListing } from "../src/intelligence/research.js";
import type { SearchBrief } from "../src/core/types.js";

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
  soft: { prioritise: ["family", "safety", "cost", "reliability", "deal"] },
};

const listing = buildManualListing({
  title: "Volkswagen Passat 2.0 TDI",
  url: "https://example.test/fallback",
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
});

const evaluation = evaluateCar(brief, listing, new Date("2026-10-31T00:00:00Z"));

test("analysis returns the deterministic fallback on a network error", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.LLM_API_KEY;
  const originalBase = process.env.LLM_BASE_URL;
  process.env.LLM_API_KEY = "test-key";
  process.env.LLM_BASE_URL = "http://127.0.0.1:1";
  globalThis.fetch = (async () => {
    throw new Error("simulated timeout");
  }) as typeof fetch;
  try {
    const result = await analyzeListing(listing, evaluation);
    assert.equal(result.source, "fallback");
    assert.equal(result.model, "deterministic-fallback");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = originalKey;
    if (originalBase === undefined) delete process.env.LLM_BASE_URL;
    else process.env.LLM_BASE_URL = originalBase;
  }
});

test("research rejects an invalid model payload and returns the fallback", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.LLM_API_KEY;
  const originalBase = process.env.LLM_BASE_URL;
  const originalFirecrawl = process.env.FIRECRAWL_API_KEY;
  process.env.LLM_API_KEY = "test-key";
  process.env.LLM_BASE_URL = "http://model.test";
  delete process.env.FIRECRAWL_API_KEY;
  globalThis.fetch = (async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify({ summary: 42, commonProblems: "not-an-array" }) } }], model: "test" }),
  })) as unknown as typeof fetch;
  try {
    const result = await researchListing(listing, evaluation);
    assert.equal(result.model, "deterministic-variant-kb");
    assert.equal(result.researchBasis, "model_knowledge");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = originalKey;
    if (originalBase === undefined) delete process.env.LLM_BASE_URL;
    else process.env.LLM_BASE_URL = originalBase;
    if (originalFirecrawl === undefined) delete process.env.FIRECRAWL_API_KEY;
    else process.env.FIRECRAWL_API_KEY = originalFirecrawl;
  }
});
