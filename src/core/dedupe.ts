import type { NormalisedListing } from "./types.js";

export interface DuplicateGroup {
  key: string;
  primary: NormalisedListing;
  duplicates: NormalisedListing[];
  reason: string;
}

export interface DedupeResult {
  unique: NormalisedListing[];
  groups: DuplicateGroup[];
  duplicateCount: number;
}

function norm(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9äöüß]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function bucket(value: number | null, size: number): string {
  if (value === null) return "?";
  return String(Math.round(value / size));
}

/**
 * Conservative cross-source dedupe for the POC.
 * Exact source IDs are handled by the DB uniqueness constraint already.
 * This catches the same car listed on multiple sources, not different cars
 * that happen to share a model/year.
 */
export function dedupeListings(listings: NormalisedListing[]): DedupeResult {
  const groups = new Map<string, NormalisedListing[]>();
  const unique: NormalisedListing[] = [];

  for (const listing of listings) {
    if (!listing.make || !listing.model) {
      unique.push(listing);
      continue;
    }
    const key = [
      norm(listing.make),
      norm(listing.model),
      listing.firstRegistration?.slice(0, 7) ?? "?",
      bucket(listing.mileageKm, 5000),
      bucket(listing.priceEur, 250),
    ].join("|");
    const bucketList = groups.get(key) ?? [];
    bucketList.push(listing);
    groups.set(key, bucketList);
  }

  const duplicates: DuplicateGroup[] = [];

  for (const [key, bucketList] of groups) {
    if (bucketList.length === 1) {
      unique.push(bucketList[0]);
      continue;
    }
    const sorted = [...bucketList].sort((a, b) => scoreCompleteness(b) - scoreCompleteness(a));
    const [primary, ...rest] = sorted;
    unique.push(primary);
    duplicates.push({
      key,
      primary,
      duplicates: rest,
      reason: "same make/model/registration/mileage band/price band",
    });
  }

  return {
    unique,
    groups: duplicates,
    duplicateCount: duplicates.reduce((sum, group) => sum + group.duplicates.length, 0),
  };
}

function scoreCompleteness(listing: NormalisedListing): number {
  return [
    listing.priceEur,
    listing.mileageKm,
    listing.firstRegistration,
    listing.fuel,
    listing.transmission,
    listing.seats,
    listing.doors,
    listing.hasIsofix,
    listing.bodyType,
    listing.description,
  ].filter((value) => value !== null && value !== "").length;
}
