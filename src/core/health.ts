import type { Db } from "../db/index.js";

export interface SourceHealth {
  id: string;
  enabled: boolean;
  status: string;
  lastOkAt: string | null;
  lastNewAt: string | null;
  stale: boolean;
}

export interface HealthReport {
  healthy: boolean;
  sources: SourceHealth[];
  staleSources: string[];
  lastNewAt: string | null;
  noNewForDays: number | null;
  warnings: string[];
  counts: {
    listings: number;
    decisions: number;
    observations: number;
    rawPages: number;
    rawDetails: number;
  };
}

const STALE_SOURCE_HOURS = 72;
const NO_NEW_DAYS = 7;

function ageHours(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const value = Date.parse(iso);
  if (!Number.isFinite(value)) return null;
  return (now - value) / 3_600_000;
}

export function checkHealth(db: Db, now = Date.now()): HealthReport {
  const rows = db
    .prepare(
      `SELECT s.id, s.enabled, s.status,
              MAX(CASE WHEN r.status = 'ok' THEN r.started_at END) AS last_ok,
              MAX(CASE WHEN r.inserted > 0 THEN r.started_at END) AS last_new
         FROM sources s
         LEFT JOIN source_runs r ON r.source = s.id
        GROUP BY s.id
        ORDER BY s.id`,
    )
    .all() as Array<{
    id: string;
    enabled: number;
    status: string;
    last_ok: string | null;
    last_new: string | null;
  }>;

  const warnings: string[] = [];
  const sources: SourceHealth[] = rows.map((row) => {
    const stale = row.enabled === 1 && (ageHours(row.last_ok, now) ?? Infinity) > STALE_SOURCE_HOURS;
    if (stale) warnings.push(`${row.id}: no successful run in ${STALE_SOURCE_HOURS}h`);
    return {
      id: row.id,
      enabled: row.enabled === 1,
      status: row.status,
      lastOkAt: row.last_ok,
      lastNewAt: row.last_new,
      stale,
    };
  });

  const lastNewAt = rows.reduce<string | null>((latest, row) => {
    if (!row.last_new) return latest;
    return !latest || row.last_new > latest ? row.last_new : latest;
  }, null);
  const noNewForDays = lastNewAt === null ? null : (ageHours(lastNewAt, now) ?? Infinity) / 24;
  if (noNewForDays === null) {
    warnings.push("no successful insertion has ever been recorded");
  } else if (noNewForDays > NO_NEW_DAYS) {
    warnings.push(`no new listing inserted for ${Math.floor(noNewForDays)} days`);
  }

  const counts = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM listings) AS listings,
         (SELECT COUNT(*) FROM brain_decisions) AS decisions,
         (SELECT COUNT(*) FROM memory_observations) AS observations,
         (SELECT COUNT(*) FROM raw_pages) AS rawPages,
         (SELECT COUNT(*) FROM raw_details) AS rawDetails`,
    )
    .get() as HealthReport["counts"];

  return {
    healthy: warnings.length === 0,
    sources,
    staleSources: sources.filter((source) => source.stale).map((source) => source.id),
    lastNewAt,
    noNewForDays: noNewForDays === null ? null : Math.floor(noNewForDays),
    warnings,
    counts,
  };
}
