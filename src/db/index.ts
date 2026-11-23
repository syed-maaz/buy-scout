import { readFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import type { NormalisedListing, SearchBrief } from "../core/types.js";
import { briefToJson, defaultBrief, parseBriefJson } from "../core/brief.js";

const schemaPath = fileURLToPath(new URL("./schema.sql", import.meta.url));
const SCHEMA_VERSION = 4;

export type Db = DatabaseSync;

function seedSources(db: Db): void {
  const now = new Date().toISOString();
  const sources: Array<[string, string, number, string, string]> = [
    ["autoscout24", "AutoScout24", 1, "working", "search + detail enrichment + family gates"],
    ["mobile_de", "mobile.de", 0, "blocked", "direct HTTP 403; Playwright blocked; no adapter loaded"],
    ["autouncle", "AutoUncle", 0, "blocked", "Jina Reader returned an empty payload; disabled until a recovery path exists"],
    ["kleinanzeigen", "Kleinanzeigen", 1, "working", "direct search + detail HTML; terms require written consent for crawlers; prefer saved-search email"],
  ];
  const stmt = db.prepare(
    `INSERT INTO sources (id, label, enabled, status, note, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       label = excluded.label,
       updated_at = excluded.updated_at`,
  );
  for (const source of sources) stmt.run(...source, now);
}

function ensureFetchCoverageColumns(db: Db): void {
  const cols = db.prepare(`PRAGMA table_info(fetch_coverage)`).all() as Array<{ name: string }>;
  const names = new Set(cols.map((col) => col.name));
  const add = (name: string, sql: string) => {
    if (!names.has(name)) db.exec(`ALTER TABLE fetch_coverage ADD COLUMN ${sql}`);
  };
  add("swept_to", "swept_to INTEGER NOT NULL DEFAULT 0");
  add("peeked_to", "peeked_to INTEGER");
  add("last_mode", "last_mode TEXT");
}

function ensureSellerMessageColumns(db: Db): void {
  const cols = db.prepare(`PRAGMA table_info(seller_messages)`).all() as Array<{ name: string }>;
  if (!cols.some((col) => col.name === "detected_language")) {
    db.exec(`ALTER TABLE seller_messages ADD COLUMN detected_language TEXT`);
  }
}

function ensureOutcomeColumns(db: Db): void {
  const cols = db.prepare(`PRAGMA table_info(brain_outcomes)`).all() as Array<{ name: string }>;
  const names = new Set(cols.map((col) => col.name));
  if (!names.has("source")) db.exec(`ALTER TABLE brain_outcomes ADD COLUMN source TEXT`);
  if (!names.has("external_id")) db.exec(`ALTER TABLE brain_outcomes ADD COLUMN external_id TEXT`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_brain_outcomes_listing
    ON brain_outcomes(source, external_id, created_at DESC)`);
  db.prepare(
    `UPDATE brain_outcomes
        SET source = json_extract((SELECT evidence_json FROM brain_decisions d WHERE d.id = decision_id), '$.listing.source'),
            external_id = json_extract((SELECT evidence_json FROM brain_decisions d WHERE d.id = decision_id), '$.listing.externalId')
      WHERE source IS NULL OR external_id IS NULL`,
  ).run();
}

function seedCriteria(db: Db): void {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM criteria_profiles`).get() as { n: number };
  if (row.n > 0) return;
  const brief = defaultBrief();
  db.prepare(
    `INSERT INTO criteria_profiles (version, name, criteria_json, active, created_at)
     VALUES (1, 'Default family profile', ?, 1, ?)`,
  ).run(briefToJson(brief), new Date().toISOString());
}

export function getActiveCriteria(db: Db): { version: number; brief: SearchBrief } {
  const row = db
    .prepare(
      `SELECT version, criteria_json FROM criteria_profiles WHERE active = 1 ORDER BY version DESC LIMIT 1`,
    )
    .get() as { version: number; criteria_json: string } | undefined;
  if (!row) {
    seedCriteria(db);
    return getActiveCriteria(db);
  }
  return { version: row.version, brief: parseBriefJson(row.criteria_json) };
}

export function saveCriteria(
  db: Db,
  brief: SearchBrief,
  name = "Family profile",
): { version: number } {
  const parsed = parseBriefJson(JSON.stringify(brief));
  const now = new Date().toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    const next = db.prepare(`SELECT COALESCE(MAX(version), 0) + 1 AS v FROM criteria_profiles`).get() as { v: number };
    db.prepare(`UPDATE criteria_profiles SET active = 0`).run();
    db.prepare(
      `INSERT INTO criteria_profiles (version, name, criteria_json, active, created_at)
       VALUES (?, ?, ?, 1, ?)`,
    ).run(next.v, name, briefToJson(parsed), now);
    // Criteria changed: old analyses and Laya triage are no longer valid.
    db.prepare(`DELETE FROM listing_analyses`).run();
    db.prepare(`DELETE FROM laya_classifications`).run();
    db.exec("COMMIT");
    return { version: next.v };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function listCriteriaVersions(
  db: Db,
): Array<{ version: number; name: string; active: number; createdAt: string }> {
  return db
    .prepare(
      `SELECT version, name, active, created_at AS createdAt
         FROM criteria_profiles ORDER BY version DESC`,
    )
    .all() as Array<{ version: number; name: string; active: number; createdAt: string }>;
}

function seedAccessLessons(db: Db): void {
  const now = new Date().toISOString();
  const lessons: Array<[string, string, string]> = [
    [
      "access:autouncle",
      "Cloudflare challenge -> Jina Reader HTML (X-Return-Format: html) works",
      "live test 2026-10-28; 25 cards parsed",
    ],
    [
      "access:mobile_de",
      "403 / Playwright blocked -> saved-search email is the trigger; Firecrawl for detail; search filters are ignored",
      "live test 2026-10-28; Firecrawl 200 but 212k unfiltered; official API 401",
    ],
    [
      "access:generic",
      "Hand-built filter URLs may silently reset -> assert max price/radius/count and filter locally",
      "mobile.de returned 212k; AutoScout24 returned 3.6k with valid filters",
    ],
    [
      "access:autouncle",
      "Price bucket must be rounded up (5200 is 404, 6000 works); filter the 5200 cap locally",
      "live test 2026-10-28",
    ],
  ];
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO rule_cards (scope, rule, evidence, active, created_at)
     VALUES (?, ?, ?, 1, ?)`,
  );
  for (const [scope, rule, evidence] of lessons) stmt.run(scope, rule, evidence, now);
}

export function recordAccessAttempt(
  db: Db,
  args: {
    source: string;
    method: string;
    symptom: string | null;
    success: boolean;
    httpStatus?: number | null;
    note?: string | null;
    createdAt?: string;
  },
): void {
  db.prepare(
    `INSERT INTO access_attempts (source, method, symptom, success, http_status, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    args.source,
    args.method,
    args.symptom,
    args.success ? 1 : 0,
    args.httpStatus ?? null,
    args.note ?? null,
    args.createdAt ?? new Date().toISOString(),
  );
}

function ensureListingColumns(db: Db): void {
  const existing = new Set(
    (db.prepare(`PRAGMA table_info(listings)`).all() as Array<{ name: string }>).map((row) => row.name),
  );
  const additions: Array<[string, string]> = [
    ["seats", "INTEGER"],
    ["doors", "INTEGER"],
    ["price_median_eur", "REAL"],
    ["commercial_only", "INTEGER"],
    ["has_isofix", "INTEGER"],
    ["hu_due", "TEXT"],
    ["warranty", "INTEGER"],
    ["carfax_url", "TEXT"],
    ["description", "TEXT"],
    ["equipment_json", "TEXT"],
    ["red_flags_json", "TEXT"],
    ["delisted_at", "TEXT"],
    ["delist_reason", "TEXT"],
    ["availability_checked_at", "TEXT"],
  ];
  for (const [name, ddl] of additions) {
    if (!existing.has(name)) db.exec(`ALTER TABLE listings ADD COLUMN ${name} ${ddl}`);
  }
}

function schemaVersion(db: Db): number {
  const row = db.prepare(`PRAGMA user_version`).get() as { user_version?: number } | undefined;
  return Number(row?.user_version ?? 0);
}

/**
 * Apply the schema once per database, under one immediate transaction. Read-only
 * commands then open without repeating DDL or seed writes.
 */
function migrate(db: Db): void {
  if (schemaVersion(db) >= SCHEMA_VERSION) return;

  db.exec("BEGIN IMMEDIATE");
  try {
    if (schemaVersion(db) < SCHEMA_VERSION) {
      db.exec(readFileSync(schemaPath, "utf8"));
      ensureListingColumns(db);
      ensureFetchCoverageColumns(db);
      ensureSellerMessageColumns(db);
      ensureOutcomeColumns(db);
      seedSources(db);
      seedAccessLessons(db);
      seedCriteria(db);
      db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function openDb(path = process.env.DB_PATH ?? "./data/buy-scout.db"): Db {
  const absolute = resolve(path);
  mkdirSync(dirname(absolute), { recursive: true });
  const db = new DatabaseSync(absolute, { timeout: 5000 });
  db.exec("PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
  migrate(db);
  return db;
}

export function startRun(
  db: Db,
  args: { id: string; source: string; startedAt: string },
): void {
  db.prepare(
    `INSERT INTO source_runs (id, source, started_at, status)
     VALUES (?, ?, ?, 'running')`,
  ).run(args.id, args.source, args.startedAt);
}

export function finishRun(
  db: Db,
  args: {
    id: string;
    status: "ok" | "filter_invalid" | "failed";
    finishedAt: string;
    pages: number;
    found: number;
    inserted: number;
    updated: number;
    totalResults: number | null;
    integrityJson: string | null;
    error?: string | null;
  },
): void {
  db.prepare(
    `UPDATE source_runs
        SET finished_at = ?, status = ?, pages = ?, found = ?, inserted = ?,
            updated = ?, total_results = ?, integrity_json = ?, error = ?
      WHERE id = ?`,
  ).run(
    args.finishedAt,
    args.status,
    args.pages,
    args.found,
    args.inserted,
    args.updated,
    args.totalResults,
    args.integrityJson,
    args.error ?? null,
    args.id,
  );
}

export function insertRawPage(
  db: Db,
  args: {
    runId: string;
    source: string;
    page: number;
    url: string;
    fetchedAt: string;
    httpStatus: number;
    htmlPath: string;
    listingCount: number;
    totalResults: number | null;
  },
): void {
  db.prepare(
    `INSERT INTO raw_pages
       (run_id, source, page, url, fetched_at, http_status, html_path, listing_count, total_results)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    args.runId,
    args.source,
    args.page,
    args.url,
    args.fetchedAt,
    args.httpStatus,
    args.htmlPath,
    args.listingCount,
    args.totalResults,
  );
}

export function insertRawListing(
  db: Db,
  args: {
    source: string;
    externalId: string;
    url: string;
    fetchedAt: string;
    jsonPath: string;
    contentHash: string;
  },
): void {
  db.prepare(
    `INSERT OR IGNORE INTO raw_listings
       (source, external_id, url, fetched_at, json_path, content_hash)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(args.source, args.externalId, args.url, args.fetchedAt, args.jsonPath, args.contentHash);
}

export function upsertListing(db: Db, listing: NormalisedListing): void {
  db.prepare(
    `INSERT INTO listings (
       source, external_id, url, title, price_eur, currency, make, model, variant,
       first_registration, mileage_km, fuel, transmission, power_kw, power_ps, body_type,
       seller_type, seller_name, city, zip, distance_km, price_label, price_evaluation,
       damaged, summary, image_url, first_seen_at, last_seen_at, content_hash, raw_json
     ) VALUES (
       ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
     )
     ON CONFLICT(source, external_id) DO UPDATE SET
       url = excluded.url,
       title = excluded.title,
       price_eur = excluded.price_eur,
       make = excluded.make,
       model = excluded.model,
       variant = excluded.variant,
       first_registration = excluded.first_registration,
       mileage_km = excluded.mileage_km,
       fuel = excluded.fuel,
       transmission = excluded.transmission,
       power_kw = excluded.power_kw,
       power_ps = excluded.power_ps,
       seller_type = excluded.seller_type,
       seller_name = excluded.seller_name,
       city = excluded.city,
       zip = excluded.zip,
       distance_km = excluded.distance_km,
       price_label = excluded.price_label,
       price_evaluation = excluded.price_evaluation,
       damaged = excluded.damaged,
       summary = excluded.summary,
       image_url = excluded.image_url,
       last_seen_at = excluded.last_seen_at,
       delisted_at = NULL,
       delist_reason = NULL,
       content_hash = excluded.content_hash,
       raw_json = excluded.raw_json`,
  ).run(
    listing.source,
    listing.externalId,
    listing.url,
    listing.title,
    listing.priceEur,
    listing.currency,
    listing.make,
    listing.model,
    listing.variant,
    listing.firstRegistration,
    listing.mileageKm,
    listing.fuel,
    listing.transmission,
    listing.powerKw,
    listing.powerPs,
    listing.bodyType,
    listing.sellerType,
    listing.sellerName,
    listing.city,
    listing.zip,
    listing.distanceKm,
    listing.priceLabel,
    listing.priceEvaluation,
    listing.damaged ? 1 : listing.damaged === false ? 0 : null,
    listing.summary,
    listing.imageUrl,
    listing.firstSeenAt,
    listing.lastSeenAt,
    listing.contentHash,
    listing.rawJson,
  );
}

export type ReplayWriteResult = "inserted" | "updated" | "skipped";

/**
 * Replay a historical raw capture without treating it as a fresh sighting.
 * Existing rows keep their live price, last_seen_at and delisting state; only
 * missing fields are filled. A confirmed-gone row is never resurrected.
 */
export function upsertReplayListing(
  db: Db,
  listing: NormalisedListing,
  archivedAt: string,
): ReplayWriteResult {
  const existing = findListing(db, listing.source, listing.externalId);
  if (existing) {
    if (existing.delistedAt !== null) return "skipped";

    const fields: Array<[string, string | number | null]> = [
      ["url", listing.url],
      ["price_eur", listing.priceEur],
      ["make", listing.make],
      ["model", listing.model],
      ["variant", listing.variant],
      ["first_registration", listing.firstRegistration],
      ["mileage_km", listing.mileageKm],
      ["fuel", listing.fuel],
      ["transmission", listing.transmission],
      ["power_kw", listing.powerKw],
      ["power_ps", listing.powerPs],
      ["body_type", listing.bodyType],
      ["seller_name", listing.sellerName],
      ["city", listing.city],
      ["zip", listing.zip],
      ["distance_km", listing.distanceKm],
      ["price_label", listing.priceLabel],
      ["price_evaluation", listing.priceEvaluation],
      ["price_median_eur", listing.priceMedianEur],
      ["damaged", listing.damaged === null ? null : listing.damaged ? 1 : 0],
      ["commercial_only", listing.commercialOnly === null ? null : listing.commercialOnly ? 1 : 0],
      ["has_isofix", listing.hasIsofix === null ? null : listing.hasIsofix ? 1 : 0],
      ["seats", listing.seats],
      ["doors", listing.doors],
      ["hu_due", listing.huDue],
      ["warranty", listing.warranty === null ? null : listing.warranty ? 1 : 0],
      ["carfax_url", listing.carfaxUrl],
      ["description", listing.description],
      ["summary", listing.summary],
      ["image_url", listing.imageUrl],
      ["content_hash", listing.contentHash],
    ].filter(([, value]) => value !== null && value !== undefined) as Array<[string, string | number]>;

    if (listing.equipment.length > 0) fields.push(["equipment_json", JSON.stringify(listing.equipment)]);
    if (listing.redFlags.length > 0) fields.push(["red_flags_json", JSON.stringify(listing.redFlags)]);

    if (fields.length > 0) {
      const setSql = fields.map(([column]) => `${column} = COALESCE(${column}, ?)`).join(", ");
      db.prepare(
        `UPDATE listings SET ${setSql} WHERE source = ? AND external_id = ?`,
      ).run(...fields.map(([, value]) => value), listing.source, listing.externalId);
    }

    if (listing.sellerType !== "unknown") {
      db.prepare(
        `UPDATE listings SET seller_type = ? WHERE source = ? AND external_id = ? AND seller_type = 'unknown'`,
      ).run(listing.sellerType, listing.source, listing.externalId);
    }
    return "updated";
  }

  upsertListing(db, {
    ...listing,
    firstSeenAt: archivedAt,
    lastSeenAt: archivedAt,
  });
  return "inserted";
}

export function updateListingDetail(db: Db, listing: NormalisedListing): void {
  db.prepare(
    `UPDATE listings
        SET seats = ?, doors = ?, body_type = ?, price_median_eur = ?,
            commercial_only = ?, has_isofix = ?, hu_due = ?, warranty = ?,
            carfax_url = ?, description = ?, equipment_json = ?, red_flags_json = ?,
            last_seen_at = ?
      WHERE source = ? AND external_id = ?`,
  ).run(
    listing.seats,
    listing.doors,
    listing.bodyType,
    listing.priceMedianEur,
    listing.commercialOnly === null ? null : listing.commercialOnly ? 1 : 0,
    listing.hasIsofix === null ? null : listing.hasIsofix ? 1 : 0,
    listing.huDue,
    listing.warranty === null ? null : listing.warranty ? 1 : 0,
    listing.carfaxUrl,
    listing.description,
    JSON.stringify(listing.equipment),
    JSON.stringify(listing.redFlags),
    listing.lastSeenAt,
    listing.source,
    listing.externalId,
  );
}

export function insertRawDetail(
  db: Db,
  args: {
    source: string;
    externalId: string;
    fetchedAt: string;
    httpStatus: number;
    htmlPath: string;
    jsonPath: string;
  },
): void {
  db.prepare(
    `INSERT OR IGNORE INTO raw_details
       (source, external_id, fetched_at, http_status, html_path, json_path)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    args.source,
    args.externalId,
    args.fetchedAt,
    args.httpStatus,
    args.htmlPath,
    args.jsonPath,
  );
}

export function upsertDecision(
  db: Db,
  args: {
    id: string;
    question: string;
    decision: string;
    rationale: string;
    confidence: number;
    evidenceJson: string;
    createdAt: string;
  },
): void {
  db.prepare(
    `INSERT INTO brain_decisions
       (id, question, decision, rationale, confidence, evidence_json, outcome, created_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?)
     ON CONFLICT(id) DO UPDATE SET
       decision = excluded.decision,
       rationale = excluded.rationale,
       confidence = excluded.confidence,
       evidence_json = excluded.evidence_json`,
  ).run(
    args.id,
    args.question,
    args.decision,
    args.rationale,
    args.confidence,
    args.evidenceJson,
    args.createdAt,
  );
}

export type ListingOutcome =
  | "bought"
  | "sold"
  | "rejected_after_viewing"
  | "too_far"
  | "inspection_failed"
  | "other";

export interface OutcomeRecord {
  decisionId: string;
  outcome: ListingOutcome;
  notes: string | null;
  createdAt: string;
}

/**
 * Record a purchase outcome against the newest decision for a listing.
 * Returns null when no decision exists yet; the caller should fetch/score first.
 */
export function recordListingOutcome(
  db: Db,
  args: { source: string; externalId: string; outcome: ListingOutcome; notes?: string | null; createdAt?: string },
): OutcomeRecord | null {
  const decision = db
    .prepare(
      `SELECT id FROM brain_decisions
        WHERE json_extract(evidence_json, '$.listing.source') = ?
          AND json_extract(evidence_json, '$.listing.externalId') = ?
        ORDER BY created_at DESC LIMIT 1`,
    )
    .get(args.source, args.externalId) as { id: string } | undefined;
  if (!decision) return null;
  const createdAt = args.createdAt ?? new Date().toISOString();
  const notes = args.notes?.trim() || null;
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(
      `INSERT INTO brain_outcomes (decision_id, source, external_id, outcome, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(decision.id, args.source, args.externalId, args.outcome, notes, createdAt);
    db.prepare(
      `UPDATE brain_decisions
          SET outcome = (
            SELECT outcome FROM brain_outcomes
             WHERE decision_id = ?
             ORDER BY created_at DESC, id DESC LIMIT 1
          )
        WHERE id = ?`,
    ).run(decision.id, decision.id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return { decisionId: decision.id, outcome: args.outcome, notes, createdAt };
}

export function getLatestOutcome(
  db: Db,
  source: string,
  externalId: string,
): OutcomeRecord | null {
  const row = db
    .prepare(
      `SELECT decision_id, outcome, notes, created_at
         FROM brain_outcomes
        WHERE source = ? AND external_id = ?
        ORDER BY created_at DESC, id DESC LIMIT 1`,
    )
    .get(source, externalId) as
    | { decision_id: string; outcome: string; notes: string | null; created_at: string }
    | undefined;
  return row
    ? { decisionId: row.decision_id, outcome: row.outcome as ListingOutcome, notes: row.notes, createdAt: row.created_at }
    : null;
}

export function recordUserAction(
  db: Db,
  args: { source: string; externalId: string; action: "inspect" | "watch" | "skip"; note?: string | null },
): void {
  db.prepare(
    `INSERT INTO user_actions (source, external_id, action, note, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(args.source, args.externalId, args.action, args.note ?? null, new Date().toISOString());
}

export function clearUserAction(db: Db, source: string, externalId: string): void {
  db.prepare(`DELETE FROM user_actions WHERE source = ? AND external_id = ?`).run(source, externalId);
}

export function latestUserActions(db: Db): Map<string, { action: string; note: string | null; createdAt: string }> {
  const rows = db
    .prepare(
      `SELECT source, external_id, action, note, created_at
         FROM user_actions
        WHERE id IN (
          SELECT MAX(id) FROM user_actions GROUP BY source, external_id
        )`,
    )
    .all() as Array<{ source: string; external_id: string; action: string; note: string | null; created_at: string }>;
  return new Map(
    rows.map((row) => [
      `${row.source}:${row.external_id}`,
      { action: row.action, note: row.note, createdAt: row.created_at },
    ]),
  );
}

export function upsertListingAnalysis(
  db: Db,
  args: { source: string; externalId: string; model: string; analysisJson: string; createdAt: string },
): void {
  db.prepare(
    `INSERT INTO listing_analyses (source, external_id, model, analysis_json, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(source, external_id) DO UPDATE SET
       model = excluded.model,
       analysis_json = excluded.analysis_json,
       created_at = excluded.created_at`,
  ).run(args.source, args.externalId, args.model, args.analysisJson, args.createdAt);
}

export function getListingAnalysis(
  db: Db,
  source: string,
  externalId: string,
): { model: string; analysisJson: string } | null {
  const row = db
    .prepare(`SELECT model, analysis_json FROM listing_analyses WHERE source = ? AND external_id = ?`)
    .get(source, externalId) as { model: string; analysis_json: string } | undefined;
  return row ? { model: row.model, analysisJson: row.analysis_json } : null;
}

export function upsertLayaClassification(
  db: Db,
  args: { source: string; externalId: string; model: string; layaJson: string; createdAt: string },
): void {
  db.prepare(
    `INSERT INTO laya_classifications (source, external_id, model, laya_json, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(source, external_id) DO UPDATE SET
       model = excluded.model,
       laya_json = excluded.laya_json,
       created_at = excluded.created_at`,
  ).run(args.source, args.externalId, args.model, args.layaJson, args.createdAt);
}

export function getLayaClassification(
  db: Db,
  source: string,
  externalId: string,
): { model: string; layaJson: string } | null {
  const row = db
    .prepare(`SELECT model, laya_json FROM laya_classifications WHERE source = ? AND external_id = ?`)
    .get(source, externalId) as { model: string; laya_json: string } | undefined;
  return row ? { model: row.model, layaJson: row.laya_json } : null;
}

export function isListingSaved(db: Db, source: string, externalId: string): boolean {
  return db.prepare(`SELECT 1 FROM saved_listings WHERE source = ? AND external_id = ?`).get(source, externalId) !== undefined;
}

export function toggleSavedListing(
  db: Db,
  args: { source: string; externalId: string; note?: string | null },
): boolean {
  if (isListingSaved(db, args.source, args.externalId)) {
    db.prepare(`DELETE FROM saved_listings WHERE source = ? AND external_id = ?`).run(args.source, args.externalId);
    return false;
  }
  db.prepare(`INSERT INTO saved_listings (source, external_id, note, created_at) VALUES (?, ?, ?, ?)`).run(
    args.source,
    args.externalId,
    args.note ?? null,
    new Date().toISOString(),
  );
  return true;
}

export function getSellerMessage(
  db: Db,
  source: string,
  externalId: string,
): { language: string; detectedLanguage: string | null; messageText: string; createdAt: string } | null {
  const row = db
    .prepare(`SELECT language, detected_language, message_text, created_at FROM seller_messages WHERE source = ? AND external_id = ?`)
    .get(source, externalId) as { language: string; detected_language: string | null; message_text: string; created_at: string } | undefined;
  return row ? { language: row.language, detectedLanguage: row.detected_language, messageText: row.message_text, createdAt: row.created_at } : null;
}

export function upsertSellerMessage(
  db: Db,
  args: { source: string; externalId: string; language: string; detectedLanguage?: string | null; messageText: string; createdAt: string },
): void {
  db.prepare(
    `INSERT INTO seller_messages (source, external_id, language, detected_language, message_text, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(source, external_id) DO UPDATE SET
       language = excluded.language,
       detected_language = excluded.detected_language,
       message_text = excluded.message_text,
       created_at = excluded.created_at`,
  ).run(args.source, args.externalId, args.language, args.detectedLanguage ?? null, args.messageText, args.createdAt);
}

export function getListingResearch(
  db: Db,
  source: string,
  externalId: string,
): { model: string; basis: string; researchJson: string; createdAt: string } | null {
  const row = db
    .prepare(`SELECT model, basis, research_json, created_at FROM listing_research WHERE source = ? AND external_id = ?`)
    .get(source, externalId) as { model: string; basis: string; research_json: string; created_at: string } | undefined;
  return row ? { model: row.model, basis: row.basis, researchJson: row.research_json, createdAt: row.created_at } : null;
}

export function upsertListingResearch(
  db: Db,
  args: { source: string; externalId: string; model: string; basis: string; researchJson: string; createdAt: string },
): void {
  db.prepare(
    `INSERT INTO listing_research (source, external_id, model, basis, research_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(source, external_id) DO UPDATE SET
       model = excluded.model,
       basis = excluded.basis,
       research_json = excluded.research_json,
       created_at = excluded.created_at`,
  ).run(args.source, args.externalId, args.model, args.basis, args.researchJson, args.createdAt);
}

export function insertMemoryObservation(
  db: Db,
  args: { kind: string; content: string; metadataJson: string; createdAt: string },
): void {
  db.prepare(
    `INSERT INTO memory_observations (kind, content, metadata_json, created_at)
     VALUES (?, ?, ?, ?)`,
  ).run(args.kind, args.content, args.metadataJson, args.createdAt);
}

export function insertPriceObservation(
  db: Db,
  args: { listingId: number; priceEur: number | null; observedAt: string },
): void {
  db.prepare(
    `INSERT INTO price_observations (listing_id, price_eur, observed_at)
     VALUES (?, ?, ?)`,
  ).run(args.listingId, args.priceEur, args.observedAt);
}

export interface PricePoint {
  priceEur: number | null;
  observedAt: string;
}

export interface PriceChange {
  /** Most recent observation, or null when the listing has never been observed. */
  latest: PricePoint | null;
  /** Second most recent observation, or null with 0/1 observations. */
  previous: PricePoint | null;
  /** latest.priceEur - previous.priceEur. Null when either price is missing. Negative means the price dropped. */
  deltaEur: number | null;
  /** Total observations for this listing, independent of any display limit. */
  observationCount: number;
}

function toPricePoint(row: { price_eur: number | null; observed_at: string }): PricePoint {
  return {
    priceEur: row.price_eur === null ? null : Number(row.price_eur),
    observedAt: row.observed_at,
  };
}

/**
 * Price observations for one listing, ordered oldest -> newest (the last element
 * is the most recent). Only the newest `limit` observations are returned.
 */
export function getPriceHistory(
  db: Db,
  source: string,
  externalId: string,
  limit = 12,
): PricePoint[] {
  const capped = Number.isFinite(limit) ? Math.max(0, Math.trunc(limit)) : 0;
  if (capped === 0) return [];
  const rows = db
    .prepare(
      `SELECT po.price_eur, po.observed_at
         FROM price_observations po
         JOIN listings l ON l.id = po.listing_id
        WHERE l.source = ? AND l.external_id = ?
        ORDER BY po.observed_at DESC, po.id DESC
        LIMIT ?`,
    )
    .all(source, externalId, capped) as Array<{ price_eur: number | null; observed_at: string }>;
  return rows.reverse().map(toPricePoint);
}

/**
 * Latest and previous observed price with their dates and the delta
 * (latest - previous). Safe with 0 or 1 observations: `latest`/`previous`
 * are null and `deltaEur` is null instead of throwing.
 */
export function getPriceChange(db: Db, source: string, externalId: string): PriceChange {
  const rows = db
    .prepare(
      `SELECT po.price_eur, po.observed_at
         FROM price_observations po
         JOIN listings l ON l.id = po.listing_id
        WHERE l.source = ? AND l.external_id = ?
        ORDER BY po.observed_at DESC, po.id DESC
        LIMIT 2`,
    )
    .all(source, externalId) as Array<{ price_eur: number | null; observed_at: string }>;
  const count = db
    .prepare(
      `SELECT COUNT(*) AS n
         FROM price_observations po
         JOIN listings l ON l.id = po.listing_id
        WHERE l.source = ? AND l.external_id = ?`,
    )
    .get(source, externalId) as { n: number };
  const latest = rows[0] ? toPricePoint(rows[0]) : null;
  const previous = rows[1] ? toPricePoint(rows[1]) : null;
  const deltaEur =
    latest?.priceEur != null && previous?.priceEur != null
      ? latest.priceEur - previous.priceEur
      : null;
  return { latest, previous, deltaEur, observationCount: count.n };
}

export function getFetchCoverage(
  db: Db,
  source: string,
  queryKey: string,
): { priceTo: number; sweptTo: number; peekedTo: number | null; lastMode: string | null; pages: number; totalResults: number | null; lastFetchedAt: string } | null {
  const row = db
    .prepare(
      `SELECT price_to, swept_to, peeked_to, last_mode, pages, total_results, last_fetched_at
         FROM fetch_coverage WHERE source = ? AND query_key = ?`,
    )
    .get(source, queryKey) as
    | { price_to: number; swept_to: number; peeked_to: number | null; last_mode: string | null; pages: number; total_results: number | null; last_fetched_at: string }
    | undefined;
  return row
    ? {
        priceTo: row.price_to,
        sweptTo: row.swept_to,
        peekedTo: row.peeked_to,
        lastMode: row.last_mode,
        pages: row.pages,
        totalResults: row.total_results,
        lastFetchedAt: row.last_fetched_at,
      }
    : null;
}

export function upsertFetchCoverage(
  db: Db,
  args: {
    source: string;
    queryKey: string;
    priceFrom: number;
    priceTo: number;
    sweptTo?: number;
    peekedTo?: number | null;
    mode?: string;
    pages: number;
    totalResults: number | null;
    lastFetchedAt: string;
  },
): void {
  db.prepare(
    `INSERT INTO fetch_coverage
       (source, query_key, price_from, price_to, swept_to, peeked_to, last_mode, pages, total_results, last_fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(source, query_key) DO UPDATE SET
       price_from = excluded.price_from,
       price_to = MAX(fetch_coverage.price_to, excluded.price_to),
       swept_to = excluded.swept_to,
       peeked_to = excluded.peeked_to,
       last_mode = excluded.last_mode,
       pages = excluded.pages,
       total_results = excluded.total_results,
       last_fetched_at = excluded.last_fetched_at`,
  ).run(
    args.source,
    args.queryKey,
    args.priceFrom,
    args.priceTo,
    args.sweptTo ?? 0,
    args.peekedTo ?? null,
    args.mode ?? null,
    args.pages,
    args.totalResults,
    args.lastFetchedAt,
  );
}

export function getFetchStats(
  db: Db,
  source: string,
): { runs: number; lastNew: number; lastKnown: number; avgNewPerPage: number | null; avgNewRatio: number | null } | null {
  const row = db
    .prepare(`SELECT runs, last_new, last_known, avg_new_per_page, avg_new_ratio FROM fetch_stats WHERE source = ?`)
    .get(source) as
    | { runs: number; last_new: number; last_known: number; avg_new_per_page: number | null; avg_new_ratio: number | null }
    | undefined;
  return row
    ? {
        runs: row.runs,
        lastNew: row.last_new,
        lastKnown: row.last_known,
        avgNewPerPage: row.avg_new_per_page,
        avgNewRatio: row.avg_new_ratio,
      }
    : null;
}

export function upsertFetchStats(
  db: Db,
  args: {
    source: string;
    lastNew: number;
    lastKnown: number;
    avgNewPerPage: number;
    avgNewRatio: number;
    runs: number;
  },
): void {
  db.prepare(
    `INSERT INTO fetch_stats (source, runs, last_new, last_known, avg_new_per_page, avg_new_ratio, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(source) DO UPDATE SET
       runs = excluded.runs,
       last_new = excluded.last_new,
       last_known = excluded.last_known,
       avg_new_per_page = excluded.avg_new_per_page,
       avg_new_ratio = excluded.avg_new_ratio,
       updated_at = excluded.updated_at`,
  ).run(
    args.source,
    args.runs,
    args.lastNew,
    args.lastKnown,
    args.avgNewPerPage,
    args.avgNewRatio,
    new Date().toISOString(),
  );
}

export function countListings(db: Db): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM listings`).get() as { n: number };
  return row.n;
}

export function touchListing(db: Db, source: string, externalId: string, seenAt: string): void {
  // Seeing the card in a source search is positive availability evidence.
  db.prepare(
    `UPDATE listings
        SET last_seen_at = ?, delisted_at = NULL, delist_reason = NULL, availability_checked_at = ?
      WHERE source = ? AND external_id = ?`,
  ).run(seenAt, seenAt, source, externalId);
}

/**
 * Record a source-confirmed delisting. Idempotent: the first delisting time is
 * kept so the UI can show how long the car has been gone.
 */
export function markListingUnavailable(
  db: Db,
  args: { source: string; externalId: string; reason: string; checkedAt?: string },
): boolean {
  const checkedAt = args.checkedAt ?? new Date().toISOString();
  const result = db
    .prepare(
      `UPDATE listings
          SET delisted_at = COALESCE(delisted_at, ?),
              delist_reason = ?,
              availability_checked_at = ?
        WHERE source = ? AND external_id = ?`,
    )
    .run(checkedAt, args.reason, checkedAt, args.source, args.externalId);
  return result.changes > 0;
}

/** Clear a previous delisting after a source confirms the car is active again. */
export function markListingAvailable(
  db: Db,
  args: { source: string; externalId: string; checkedAt?: string },
): boolean {
  const checkedAt = args.checkedAt ?? new Date().toISOString();
  const result = db
    .prepare(
      `UPDATE listings
          SET delisted_at = NULL, delist_reason = NULL, availability_checked_at = ?
        WHERE source = ? AND external_id = ?`,
    )
    .run(checkedAt, args.source, args.externalId);
  return result.changes > 0;
}

/** Record a check that returned no reliable availability signal. */
export function recordAvailabilityCheck(
  db: Db,
  args: { source: string; externalId: string; checkedAt?: string },
): void {
  db.prepare(
    `UPDATE listings SET availability_checked_at = ? WHERE source = ? AND external_id = ?`,
  ).run(args.checkedAt ?? new Date().toISOString(), args.source, args.externalId);
}

export function isListingUnavailable(db: Db, source: string, externalId: string): boolean {
  const row = db
    .prepare(`SELECT 1 AS gone FROM listings WHERE source = ? AND external_id = ? AND delisted_at IS NOT NULL`)
    .get(source, externalId) as { gone: number } | undefined;
  return row !== undefined;
}

export function listingDbId(db: Db, source: string, externalId: string): number | null {
  const row = db
    .prepare(`SELECT id FROM listings WHERE source = ? AND external_id = ?`)
    .get(source, externalId) as { id: number } | undefined;
  return row?.id ?? null;
}

function mapListingRow(row: Record<string, unknown>): NormalisedListing {
  return {
    source: String(row.source),
    externalId: String(row.external_id),
    url: String(row.url),
    title: String(row.title),
    priceEur: row.price_eur === null ? null : Number(row.price_eur),
    currency: "EUR",
    make: row.make === null ? null : String(row.make),
    model: row.model === null ? null : String(row.model),
    variant: row.variant === null ? null : String(row.variant),
    firstRegistration: row.first_registration === null ? null : String(row.first_registration),
    mileageKm: row.mileage_km === null ? null : Number(row.mileage_km),
    fuel: row.fuel === null ? null : String(row.fuel),
    transmission: row.transmission === null ? null : String(row.transmission),
    powerKw: row.power_kw === null ? null : Number(row.power_kw),
    powerPs: row.power_ps === null ? null : Number(row.power_ps),
    bodyType: row.body_type === null ? null : String(row.body_type),
    seats: row.seats === null ? null : Number(row.seats),
    doors: row.doors === null ? null : Number(row.doors),
    sellerType: String(row.seller_type) as NormalisedListing["sellerType"],
    sellerName: row.seller_name === null ? null : String(row.seller_name),
    city: row.city === null ? null : String(row.city),
    zip: row.zip === null ? null : String(row.zip),
    distanceKm: row.distance_km === null ? null : Number(row.distance_km),
    priceLabel: row.price_label === null ? null : String(row.price_label),
    priceEvaluation: row.price_evaluation === null ? null : Number(row.price_evaluation),
    priceMedianEur: row.price_median_eur === null ? null : Number(row.price_median_eur),
    damaged: row.damaged === null ? null : Boolean(row.damaged),
    commercialOnly: row.commercial_only === null ? null : Boolean(row.commercial_only),
    hasIsofix: row.has_isofix === null ? null : Boolean(row.has_isofix),
    huDue: row.hu_due === null ? null : String(row.hu_due),
    warranty: row.warranty === null ? null : Boolean(row.warranty),
    carfaxUrl: row.carfax_url === null ? null : String(row.carfax_url),
    description: row.description === null ? null : String(row.description),
    equipment: row.equipment_json ? (JSON.parse(String(row.equipment_json)) as string[]) : [],
    redFlags: row.red_flags_json ? (JSON.parse(String(row.red_flags_json)) as string[]) : [],
    summary: row.summary === null ? null : String(row.summary),
    imageUrl: row.image_url === null ? null : String(row.image_url),
    firstSeenAt: String(row.first_seen_at),
    lastSeenAt: String(row.last_seen_at),
    delistedAt: row.delisted_at === null || row.delisted_at === undefined ? null : String(row.delisted_at),
    delistReason: row.delist_reason === null || row.delist_reason === undefined ? null : String(row.delist_reason),
    availabilityCheckedAt:
      row.availability_checked_at === null || row.availability_checked_at === undefined
        ? null
        : String(row.availability_checked_at),
    contentHash: String(row.content_hash),
    rawJson: String(row.raw_json),
  };
}

export function findListing(db: Db, source: string, externalId: string): NormalisedListing | null {
  const row = db
    .prepare(`SELECT * FROM listings WHERE source = ? AND external_id = ? LIMIT 1`)
    .get(source, externalId) as Record<string, unknown> | undefined;
  return row ? mapListingRow(row) : null;
}

/**
 * Availability candidates ordered by the last time they were checked (or seen).
 * The predicate is in SQL so recency cannot truncate the stale tail before it
 * is filtered.
 */
export function staleListings(
  db: Db,
  cutoff: string,
  limit?: number,
  sources?: Set<string>,
): NormalisedListing[] {
  if (sources && sources.size === 0) return [];
  const limitSql = limit === undefined ? "" : "LIMIT ?";
  const sourceList = sources ? [...sources] : [];
  const sourceSql = sourceList.length > 0
    ? `AND source IN (${sourceList.map(() => "?").join(", ")})`
    : "";
  const params: Array<string | number> = [cutoff, ...sourceList];
  if (limit !== undefined) params.push(limit);
  const rows = db
    .prepare(
      `SELECT source, external_id, url, title, price_eur, currency, make, model,
              variant, first_registration, mileage_km, fuel, transmission, power_kw,
              power_ps, body_type, seats, doors, seller_type, seller_name, city, zip,
              distance_km, price_label, price_evaluation, price_median_eur, damaged,
              commercial_only, has_isofix, hu_due, warranty, carfax_url, description,
              equipment_json, red_flags_json, summary, image_url, first_seen_at,
              last_seen_at, delisted_at, delist_reason, availability_checked_at,
              content_hash, '' AS raw_json
         FROM listings
        WHERE delisted_at IS NULL
          AND COALESCE(availability_checked_at, last_seen_at) < ?
          ${sourceSql}
        ORDER BY COALESCE(availability_checked_at, last_seen_at) ASC
        ${limitSql}`,
    )
    .all(...params) as Array<Record<string, unknown>>;
  return rows.map(mapListingRow);
}

/**
 * All active listings without raw_json, for candidate selection. No recency
 * limit: selection thresholds and maxCards must see the complete working set.
 */
export function latestListingsForSelection(db: Db): NormalisedListing[] {
  const rows = db
    .prepare(
      `SELECT source, external_id, url, title, price_eur, currency, make, model,
              variant, first_registration, mileage_km, fuel, transmission, power_kw,
              power_ps, body_type, seats, doors, seller_type, seller_name, city, zip,
              distance_km, price_label, price_evaluation, price_median_eur, damaged,
              commercial_only, has_isofix, hu_due, warranty, carfax_url, description,
              equipment_json, red_flags_json, summary, image_url, first_seen_at,
              last_seen_at, delisted_at, delist_reason, availability_checked_at,
              content_hash, '' AS raw_json
         FROM listings
        WHERE delisted_at IS NULL
        ORDER BY last_seen_at DESC, first_seen_at DESC`,
    )
    .all() as Array<Record<string, unknown>>;
  return rows.map(mapListingRow);
}

export interface ListingListRow {
  listing: NormalisedListing;
  analysisJson: string | null;
  layaJson: string | null;
  saved: boolean;
  hasResearch: boolean;
}

/**
 * List-page projection: one query, no raw_json, and the dependent data needed
 * by the UI joined as scalar subqueries instead of four queries per listing.
 */
export function latestListingsForList(
  db: Db,
  limit = 1000,
  opts: { includeUnavailable?: boolean } = {},
): ListingListRow[] {
  const where = opts.includeUnavailable ? "" : "WHERE l.delisted_at IS NULL";
  const rows = db
    .prepare(
      `SELECT l.source, l.external_id, l.url, l.title, l.price_eur, l.currency,
              l.make, l.model, l.variant, l.first_registration, l.mileage_km,
              l.fuel, l.transmission, l.power_kw, l.power_ps, l.body_type,
              l.seats, l.doors, l.seller_type, l.seller_name, l.city, l.zip,
              l.distance_km, l.price_label, l.price_evaluation, l.price_median_eur,
              l.damaged, l.commercial_only, l.has_isofix, l.hu_due, l.warranty,
              l.carfax_url, l.description, l.equipment_json, l.red_flags_json,
              l.summary, l.image_url, l.first_seen_at, l.last_seen_at,
              l.delisted_at, l.delist_reason, l.availability_checked_at,
              l.content_hash, '' AS raw_json,
              (SELECT a.analysis_json FROM listing_analyses a
                WHERE a.source = l.source AND a.external_id = l.external_id) AS analysis_json,
              (SELECT y.laya_json FROM laya_classifications y
                WHERE y.source = l.source AND y.external_id = l.external_id) AS laya_json,
              EXISTS(SELECT 1 FROM saved_listings s
                WHERE s.source = l.source AND s.external_id = l.external_id) AS saved,
              EXISTS(SELECT 1 FROM listing_research r
                WHERE r.source = l.source AND r.external_id = l.external_id) AS has_research
         FROM listings l ${where}
        ORDER BY l.last_seen_at DESC, l.first_seen_at DESC LIMIT ?`,
    )
    .all(limit) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    listing: mapListingRow(row),
    analysisJson: row.analysis_json === null ? null : String(row.analysis_json),
    layaJson: row.laya_json === null ? null : String(row.laya_json),
    saved: Number(row.saved) === 1,
    hasResearch: Number(row.has_research) === 1,
  }));
}

export function latestListings(
  db: Db,
  limit = 10,
  opts: { includeUnavailable?: boolean } = {},
): NormalisedListing[] {
  const where = opts.includeUnavailable ? "" : "WHERE delisted_at IS NULL";
  const rows = db
    .prepare(
      `SELECT source, external_id, url, title, price_eur, currency, make, model,
              variant, first_registration, mileage_km, fuel, transmission, power_kw,
              power_ps, body_type, seats, doors, seller_type, seller_name, city, zip,
              distance_km, price_label, price_evaluation, price_median_eur, damaged,
              commercial_only, has_isofix, hu_due, warranty, carfax_url, description,
              equipment_json, red_flags_json, summary, image_url, first_seen_at,
              last_seen_at, delisted_at, delist_reason, availability_checked_at,
              content_hash, raw_json
         FROM listings ${where}
        ORDER BY last_seen_at DESC, first_seen_at DESC LIMIT ?`,
    )
    .all(limit) as Array<Record<string, unknown>>;

  return rows.map(mapListingRow);
}
