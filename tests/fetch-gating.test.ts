import test from "node:test";
import assert from "node:assert/strict";
import { isUsableSourceResult } from "../src/core/source-runner.js";
import type { SourceSearchResult } from "../src/core/types.js";

function result(ok: boolean, refs: number): SourceSearchResult {
  return {
    source: "autoscout24",
    refs: Array.from({ length: refs }, (_, index) => ({
      source: "autoscout24" as const,
      externalId: String(index),
      url: `https://example.test/${index}`,
      page: 1,
      payload: {},
    })),
    pages: [],
    totalResults: 500000,
    integrity: { ok, reasons: ok ? [] : ["price filter leaked"], observedMaxPriceEur: 9000, observedMaxDistanceKm: 20, totalResults: 500000 },
    warnings: [],
  };
}

test("a filter-invalid result is not usable even when it contains refs", () => {
  assert.equal(isUsableSourceResult(result(false, 10)), false);
});

test("a valid result with zero refs is not usable", () => {
  assert.equal(isUsableSourceResult(result(true, 0)), false);
});

test("a valid result with at least one ref is usable", () => {
  assert.equal(isUsableSourceResult(result(true, 1)), true);
});
