import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { finishRun, openDb, startRun } from "../src/db/index.js";
import { checkHealth } from "../src/core/health.js";

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), "buy-scout-health-"));
  return { dir, db: openDb(join(dir, "test.db")) };
}

function recordRun(db: ReturnType<typeof openDb>, source: string, id: string, startedAt: string, inserted: number) {
  startRun(db, { id, source, startedAt });
  finishRun(db, {
    id,
    status: "ok",
    finishedAt: new Date(Date.parse(startedAt) + 60_000).toISOString(),
    pages: 1,
    found: 20,
    inserted,
    updated: 0,
    totalResults: 20,
    integrityJson: null,
  });
}

test("health fails when enabled sources have never run", () => {
  const { dir, db } = tempDb();
  try {
    const report = checkHealth(db, Date.now());
    assert.equal(report.healthy, false);
    assert.ok(report.staleSources.includes("autoscout24"));
    assert.ok(report.staleSources.includes("kleinanzeigen"));
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("health passes with a recent successful insert for every enabled source", () => {
  const { dir, db } = tempDb();
  const now = Date.now();
  try {
    for (const source of ["autoscout24", "kleinanzeigen"]) {
      recordRun(db, source, `${source}-ok`, new Date(now - 60 * 60 * 1000).toISOString(), 1);
    }
    const report = checkHealth(db, now);
    assert.equal(report.healthy, true);
    assert.equal(report.warnings.length, 0);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("health fails after a 72-hour dry spell", () => {
  const { dir, db } = tempDb();
  const now = Date.now();
  try {
    for (const source of ["autoscout24", "kleinanzeigen"]) {
      recordRun(db, source, `${source}-stale`, new Date(now - 100 * 60 * 60 * 1000).toISOString(), 1);
    }
    const report = checkHealth(db, now);
    assert.equal(report.healthy, false);
    assert.deepEqual(report.staleSources.sort(), ["autoscout24", "kleinanzeigen"]);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
