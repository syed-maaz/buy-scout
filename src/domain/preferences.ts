import type { NormalisedListing, PreferenceRule } from "../core/types.js";

export interface PreferenceMatch {
  id: string;
  label: string;
  field: PreferenceRule["field"];
  value: string;
  weight: number;
  evidence: string;
}

export interface PreferenceResult {
  boost: number;
  matches: PreferenceMatch[];
}

function fieldValue(listing: NormalisedListing, field: PreferenceRule["field"]): string {
  switch (field) {
    case "make":
      return listing.make ?? "";
    case "model":
      return listing.model ?? "";
    case "variant":
      return listing.variant ?? "";
    case "title":
      return [listing.title, listing.variant, listing.description].filter(Boolean).join(" ");
    case "equipment":
      return [listing.equipment.join(" "), listing.title, listing.description].filter(Boolean).join(" ");
    case "bodyType":
      return listing.bodyType ?? "";
    case "fuel":
      return listing.fuel ?? "";
    case "transmission":
      return listing.transmission ?? "";
    case "sellerType":
      return listing.sellerType;
    default:
      return "";
  }
}

export function applyPreferences(
  rules: PreferenceRule[] | undefined,
  listing: NormalisedListing,
): PreferenceResult {
  const matches: PreferenceMatch[] = [];
  let boost = 0;

  for (const rule of rules ?? []) {
    if (rule.enabled === false || rule.weight <= 0 || !rule.value.trim()) continue;
    const haystack = fieldValue(listing, rule.field).toLowerCase();
    const needle = rule.value.trim().toLowerCase();
    if (!haystack) continue;
    const matched = rule.match === "equals" ? haystack === needle : haystack.includes(needle);
    if (!matched) continue;

    const weight = Math.max(0, Math.min(25, rule.weight));
    boost += weight;
    matches.push({
      id: rule.id,
      label: rule.label,
      field: rule.field,
      value: rule.value,
      weight,
      evidence: fieldValue(listing, rule.field).slice(0, 160),
    });
  }

  // A preference is a tie-breaker, not a takeover. Cap the total boost.
  return { boost: Math.min(25, boost), matches };
}
