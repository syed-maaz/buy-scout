import test from "node:test";
import assert from "node:assert/strict";
import { selectAnalysisCandidates } from "../src/intelligence/selection.js";
import type { NormalisedListing, SearchBrief } from "../src/core/types.js";
import type { CarEvaluation } from "../src/domain/cars/evaluate.js";

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
  analysis: { minScore: 60, minConfidence: 0.6, maxCards: 30, autoRun: false },
};

function evaluation(score: number, confidence: number, verdict: CarEvaluation["verdict"]): CarEvaluation {
  return {
    verdict,
    hardPass: verdict !== "reject",
    hardFailures: verdict === "reject" ? ["test"] : [],
    unknowns: [],
    score,
    confidence,
    reasons: [],
    preferenceBoost: 0,
    preferenceMatches: [],
    components: { family: 1, deal: 1, age: 1, mileage: 1, distance: 1, evidence: 1, preference: 0 },
  };
}

function listing(id: string): NormalisedListing {
  return { externalId: id } as NormalisedListing;
}

test("selects by score and confidence, not by fixed top N", () => {
  const scored = [
    { listing: listing("a"), evaluation: evaluation(80, 0.9, "inspect") },
    { listing: listing("b"), evaluation: evaluation(70, 0.5, "ask") },
    { listing: listing("c"), evaluation: evaluation(50, 0.9, "watch") },
    { listing: listing("d"), evaluation: evaluation(0, 0.9, "reject") },
  ];
  const selection = selectAnalysisCandidates(brief, scored);
  assert.deepEqual(selection.items.map((item) => item.listing.externalId), ["a"]);
  assert.equal(selection.considered, 1);
});

test("maxCards caps qualifying cards without changing the threshold", () => {
  const scored = [1, 2, 3].map((n) => ({
    listing: listing(String(n)),
    evaluation: evaluation(70 + n, 0.9, "inspect" as const),
  }));
  const selection = selectAnalysisCandidates(brief, scored, { maxCards: 2 });
  assert.equal(selection.items.length, 2);
  assert.equal(selection.considered, 3);
});
