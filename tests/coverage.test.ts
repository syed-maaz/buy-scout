import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getFetchCoverage, openDb, upsertFetchCoverage } from "../src/db/index.js";

test("coverage expands but never shrinks when the budget is lowered", () => {
  const dir = mkdtempSync(join(tmpdir(), "buy-scout-coverage-"));
  const db = openDb(join(dir, "test.db"));
  try {
    assert.equal(getFetchCoverage(db, "autoscout24", "k"), null);
    upsertFetchCoverage(db, {
      source: "autoscout24",
      queryKey: "k",
      priceFrom: 0,
      priceTo: 7000,
      sweptTo: 7000,
      peekedTo: 7000,
      mode: "full",
      pages: 3,
      totalResults: 100,
      lastFetchedAt: "2026-10-28T00:00:00.000Z",
    });
    assert.equal(getFetchCoverage(db, "autoscout24", "k")?.priceTo, 7000);

    upsertFetchCoverage(db, {
      source: "autoscout24",
      queryKey: "k",
      priceFrom: 7000,
      priceTo: 10000,
      sweptTo: 10000,
      peekedTo: 10000,
      mode: "expand",
      pages: 2,
      totalResults: 80,
      lastFetchedAt: "2026-10-28T01:00:00.000Z",
    });
    assert.equal(getFetchCoverage(db, "autoscout24", "k")?.priceTo, 10000);

    upsertFetchCoverage(db, {
      source: "autoscout24",
      queryKey: "k",
      priceFrom: 0,
      priceTo: 5000,
      sweptTo: 10000,
      peekedTo: 5000,
      mode: "refresh",
      pages: 1,
      totalResults: 40,
      lastFetchedAt: "2026-10-28T02:00:00.000Z",
    });
    assert.equal(getFetchCoverage(db, "autoscout24", "k")?.priceTo, 10000);
    assert.equal(getFetchCoverage(db, "autoscout24", "k")?.sweptTo, 10000);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
