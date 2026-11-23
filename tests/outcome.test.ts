import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getLatestOutcome,
  openDb,
  recordListingOutcome,
  upsertDecision,
  upsertListing,
} from "../src/db/index.js";
import { buildManualListing } from "../src/core/manual.js";

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), "buy-scout-outcome-"));
  return { dir, db: openDb(join(dir, "test.db")) };
}

const listing = buildManualListing({
  title: "Volkswagen Passat 2.0 TDI",
  url: "https://example.test/outcome",
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

function decision(id: string, externalId: string) {
  return {
    id,
    question: "Shortlist this car?",
    decision: "inspect",
    rationale: "passes hard gates",
    confidence: 1,
    evidenceJson: JSON.stringify({
      criteriaVersion: 18,
      criteriaBriefHash: "abc",
      listing: { source: "manual", externalId },
    }),
    createdAt: "2026-10-31T10:00:00.000Z",
  };
}

test("outcome is recorded against the newest decision and exposed as latest", () => {
  const { dir, db } = tempDb();
  try {
    upsertListing(db, listing);
    upsertDecision(db, decision("decision-1", listing.externalId));
    const first = recordListingOutcome(db, {
      source: "manual",
      externalId: listing.externalId,
      outcome: "rejected_after_viewing",
      notes: "rust on sills",
      createdAt: "2026-10-31T11:00:00.000Z",
    });
    assert.equal(first?.decisionId, "decision-1");
    const latest = getLatestOutcome(db, "manual", listing.externalId);
    assert.equal(latest?.outcome, "rejected_after_viewing");
    assert.equal(latest?.notes, "rust on sills");
    const decisionRow = db.prepare("SELECT outcome FROM brain_decisions WHERE id = 'decision-1'").get() as { outcome: string };
    assert.equal(decisionRow.outcome, "rejected_after_viewing");
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("outcome cannot be recorded without a decision", () => {
  const { dir, db } = tempDb();
  try {
    upsertListing(db, listing);
    const result = recordListingOutcome(db, {
      source: "manual",
      externalId: listing.externalId,
      outcome: "bought",
    });
    assert.equal(result, null);
    assert.equal(getLatestOutcome(db, "manual", listing.externalId), null);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("decision column and latest outcome agree when outcomes arrive out of order", () => {
  const { dir, db } = tempDb();
  try {
    upsertListing(db, listing);
    upsertDecision(db, decision("decision-ordered", listing.externalId));
    recordListingOutcome(db, {
      source: "manual",
      externalId: listing.externalId,
      outcome: "bought",
      createdAt: "2026-10-31T12:00:00.000Z",
    });
    recordListingOutcome(db, {
      source: "manual",
      externalId: listing.externalId,
      outcome: "too_far",
      createdAt: "2026-10-31T11:00:00.000Z",
    });
    const row = db.prepare("SELECT outcome FROM brain_decisions WHERE id = 'decision-ordered'").get() as { outcome: string };
    assert.equal(row.outcome, "bought");
    assert.equal(getLatestOutcome(db, "manual", listing.externalId)?.outcome, "bought");
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("latest outcome wins when a listing has more than one", () => {
  const { dir, db } = tempDb();
  try {
    upsertListing(db, listing);
    upsertDecision(db, decision("decision-2", listing.externalId));
    recordListingOutcome(db, {
      source: "manual",
      externalId: listing.externalId,
      outcome: "too_far",
      createdAt: "2026-10-31T11:00:00.000Z",
    });
    recordListingOutcome(db, {
      source: "manual",
      externalId: listing.externalId,
      outcome: "bought",
      createdAt: "2026-10-31T12:00:00.000Z",
    });
    assert.equal(getLatestOutcome(db, "manual", listing.externalId)?.outcome, "bought");
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
