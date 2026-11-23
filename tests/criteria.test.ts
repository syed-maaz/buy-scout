import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultBrief, parseBriefJson } from "../src/core/brief.js";
import {
  getActiveCriteria,
  openDb,
  saveCriteria,
  upsertLayaClassification,
  upsertListingAnalysis,
} from "../src/db/index.js";

test("criteria versions increment and re-score against the new active profile", () => {
  const dir = mkdtempSync(join(tmpdir(), "buy-scout-criteria-"));
  const db = openDb(join(dir, "test.db"));
  try {
    const first = getActiveCriteria(db);
    assert.equal(first.version, 1);
    assert.equal(first.brief.purchaseMaxEur, 7000);
    assert.equal(first.brief.location.radiusKm, 200);

    const changed = { ...first.brief, purchaseMaxEur: 4500, budgetAllInEur: 5300 };
    const saved = saveCriteria(db, changed, "Test 4500");
    assert.equal(saved.version, 2);

    const active = getActiveCriteria(db);
    assert.equal(active.version, 2);
    assert.equal(active.brief.purchaseMaxEur, 4500);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("legacy inert criteria keys are stripped instead of being advertised", () => {
  const legacy = {
    ...defaultBrief(),
    hard: { ...defaultBrief().hard, minIsofix: 2, minHuMonths: 12 },
    soft: { ...defaultBrief().soft, minBootLitres: 450, needsThreeAcross: false, maxLengthMm: null },
  };
  const parsed = parseBriefJson(JSON.stringify(legacy));
  assert.equal("minIsofix" in parsed.hard, false);
  assert.equal("minHuMonths" in parsed.hard, false);
  assert.equal("minBootLitres" in parsed.soft, false);
  assert.equal("needsThreeAcross" in parsed.soft, false);
  assert.equal("maxLengthMm" in parsed.soft, false);
});

test("criteria save clears dependent Laya classifications", () => {
  const dir = mkdtempSync(join(tmpdir(), "buy-scout-criteria-"));
  const db = openDb(join(dir, "test.db"));
  try {
    upsertLayaClassification(db, {
      source: "autoscout24",
      externalId: "x",
      model: "laya",
      layaJson: "{}",
      createdAt: new Date().toISOString(),
    });
    const { brief } = getActiveCriteria(db);
    saveCriteria(db, { ...brief, purchaseMaxEur: 4500, budgetAllInEur: 5300 }, "Test");
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM laya_classifications").get() as { n: number }).n, 0);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("openDb versions the schema and keeps it on reopen", () => {
  const dir = mkdtempSync(join(tmpdir(), "buy-scout-criteria-"));
  try {
    const first = openDb(join(dir, "test.db"));
    const version = (first.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
    assert.equal(version, 4);
    assert.equal((first.prepare("PRAGMA busy_timeout").get() as { timeout: number }).timeout, 5000);
    first.close();
    const second = openDb(join(dir, "test.db"));
    assert.equal((second.prepare("PRAGMA user_version").get() as { user_version: number }).user_version, 4);
    second.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("saving criteria clears stale analyses", () => {
  const dir = mkdtempSync(join(tmpdir(), "buy-scout-criteria-"));
  const db = openDb(join(dir, "test.db"));
  try {
    upsertListingAnalysis(db, {
      source: "autoscout24",
      externalId: "x",
      model: "fallback",
      analysisJson: "{}",
      createdAt: new Date().toISOString(),
    });
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM listing_analyses").get() as { n: number }).n, 1);

    const { brief } = getActiveCriteria(db);
    saveCriteria(db, { ...brief, purchaseMaxEur: 4500, budgetAllInEur: 5300 }, "Test");
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM listing_analyses").get() as { n: number }).n, 0);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
