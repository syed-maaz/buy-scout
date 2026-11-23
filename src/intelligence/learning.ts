import type { Db } from "../db/index.js";
import { getActiveCriteria, saveCriteria } from "../db/index.js";
import type { PreferenceRule, SearchBrief } from "../core/types.js";

export interface SavedPreferenceSuggestion {
  field: PreferenceRule["field"];
  value: string;
  label: string;
  weight: number;
  count: number;
}

export interface SavedLearningResult {
  savedCount: number;
  suggestions: SavedPreferenceSuggestion[];
  applied: boolean;
  version: number | null;
  message: string;
}

function top(values: Array<string | null>, minimum: number): Array<{ value: string; count: number }> {
  const counts = new Map<string, number>();
  for (const value of values) {
    const text = value?.trim();
    if (!text) continue;
    counts.set(text, (counts.get(text) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= minimum)
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);
}

export function savedPreferenceSuggestions(
  db: Db,
  brief: SearchBrief,
): { savedCount: number; suggestions: SavedPreferenceSuggestion[] } {
  const saved = db
    .prepare(
      `SELECT l.make, l.model, l.transmission, l.fuel, l.body_type, l.price_eur
         FROM saved_listings s JOIN listings l
           ON l.source = s.source AND l.external_id = s.external_id`,
    )
    .all() as Array<{ make: string | null; model: string | null; transmission: string | null; fuel: string | null; body_type: string | null; price_eur: number | null }>;

  if (saved.length === 0) return { savedCount: 0, suggestions: [] };
  const existing = new Set((brief.preferences ?? []).map((rule) => `${rule.field}:${rule.value.toLowerCase()}`));
  const out: SavedPreferenceSuggestion[] = [];
  const add = (field: PreferenceRule["field"], value: string | null, count: number, labelPrefix: string) => {
    if (!value || existing.has(`${field}:${value.toLowerCase()}`)) return;
    out.push({
      field,
      value,
      label: `Learned ${labelPrefix}: ${value}`,
      weight: Math.min(15, 5 + count * 3),
      count,
    });
  };
  const strong = (items: Array<{ value: string; count: number }>) =>
    items.filter((item) => item.count / saved.length >= 0.75);
  for (const item of strong(top(saved.map((row) => row.make), 2))) add("make", item.value, item.count, "make");
  for (const item of strong(top(saved.map((row) => row.model), 2))) add("model", item.value, item.count, "model");
  for (const item of strong(top(saved.map((row) => row.transmission), 2))) add("transmission", item.value, item.count, "gearbox");
  for (const item of strong(top(saved.map((row) => row.fuel), 2))) add("fuel", item.value, item.count, "fuel");
  for (const item of strong(top(saved.map((row) => row.body_type), 2))) add("bodyType", item.value, item.count, "body");
  return { savedCount: saved.length, suggestions: out };
}

export function applySavedPreferences(db: Db): SavedLearningResult {
  const { brief, version } = getActiveCriteria(db);
  const { savedCount, suggestions } = savedPreferenceSuggestions(db, brief);
  if (savedCount < 2) {
    return {
      savedCount,
      suggestions,
      applied: false,
      version,
      message: "Save at least 2 cars before applying learned preferences.",
    };
  }
  if (suggestions.length === 0) {
    return {
      savedCount,
      suggestions,
      applied: false,
      version,
      message: "No new preference rules found; your saved cars already match the active preferences.",
    };
  }
  brief.preferences = [
    ...(brief.preferences ?? []),
    ...suggestions.map((s) => ({
      id: `learned-${s.field}-${s.value.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      label: s.label,
      field: s.field,
      match: "contains" as const,
      value: s.value,
      weight: s.weight,
      enabled: true,
    })),
  ];
  const next = saveCriteria(db, brief, "Family profile");
  return {
    savedCount,
    suggestions,
    applied: true,
    version: next.version,
    message: `Applied ${suggestions.length} learned preference${suggestions.length === 1 ? "" : "s"} from ${savedCount} saved cars.`,
  };
}
