import test from "node:test";
import assert from "node:assert/strict";
import { renderReport } from "../src/report/render.js";
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
  soft: { prioritise: ["family"] },
};

test("report header follows the active brief", () => {
  const html = renderReport({
    items: [],
    generatedAt: "2026-10-31T00:00:00Z",
    criteriaVersion: 18,
    brief,
    counts: { listings: 0, decisions: 0, observations: 0 },
    sources: [],
  });
  assert.match(html, /69168/);
  assert.match(html, /7\.000/);
  assert.match(html, /7\.800/);
  assert.match(html, /200 km/);
  assert.doesNotMatch(html, /6\.000/);
  assert.doesNotMatch(html, /50 km/);
});
