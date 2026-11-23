import type { NormalisedListing } from "./types.js";
import { sha256 } from "./parse.js";
import { estimateDistanceFromWiesloch } from "../sources/autouncle.js";

export interface ManualListingInput {
  title: string;
  url: string;
  priceEur: number | null;
  mileageKm: number | null;
  year: number | null;
  fuel: string | null;
  transmission: string | null;
  bodyType: string | null;
  seats: number | null;
  doors: number | null;
  hasIsofix: boolean | null;
  city: string | null;
  zip: string | null;
  description: string | null;
  source?: string;
}

function optionalNumber(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function optionalBoolean(value: string | undefined): boolean | null {
  if (!value) return null;
  if (/^(yes|true|1|ja)$/i.test(value)) return true;
  if (/^(no|false|0|nein)$/i.test(value)) return false;
  return null;
}

export function buildManualListing(input: ManualListingInput, now = new Date()): NormalisedListing {
  const source = input.source?.trim() || "manual";
  const externalId = `manual-${sha256(input.url || `${input.title}|${input.priceEur ?? ""}`).slice(0, 12)}`;
  const nowIso = now.toISOString();
  return {
    source,
    externalId,
    url: input.url,
    title: input.title,
    priceEur: input.priceEur,
    currency: "EUR",
    make: input.title.split(/\s+/)[0] ?? null,
    model: input.title.split(/\s+/).slice(1, 3).join(" ") || null,
    variant: null,
    firstRegistration: input.year ? `${input.year}-01-01` : null,
    mileageKm: input.mileageKm,
    fuel: input.fuel,
    transmission: input.transmission,
    powerKw: null,
    powerPs: null,
    bodyType: input.bodyType,
    seats: input.seats,
    doors: input.doors,
    sellerType: "unknown",
    sellerName: null,
    city: input.city,
    zip: input.zip,
    distanceKm: estimateDistanceFromWiesloch(input.zip),
    priceLabel: null,
    priceEvaluation: null,
    priceMedianEur: null,
    damaged: null,
    commercialOnly: null,
    hasIsofix: input.hasIsofix,
    huDue: null,
    warranty: null,
    carfaxUrl: null,
    description: input.description,
    equipment: [],
    redFlags: [],
    summary: input.description?.slice(0, 300) ?? null,
    imageUrl: null,
    firstSeenAt: nowIso,
    lastSeenAt: nowIso,
    contentHash: sha256(JSON.stringify(input)).slice(0, 16),
    rawJson: JSON.stringify({ ...input, source, externalId, enteredAt: nowIso }),
  };
}

export function manualInputFromArgs(args: string[]): ManualListingInput {
  const value = (name: string): string | undefined => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const title = value("title")?.trim();
  const url = value("url")?.trim();
  if (!title) throw new Error("--title is required");
  if (!url) throw new Error("--url is required");
  return {
    title,
    url,
    priceEur: optionalNumber(value("price")),
    mileageKm: optionalNumber(value("mileage")),
    year: optionalNumber(value("year")),
    fuel: value("fuel") ?? null,
    transmission: value("transmission") ?? null,
    bodyType: value("body") ?? null,
    seats: optionalNumber(value("seats")),
    doors: optionalNumber(value("doors")),
    hasIsofix: optionalBoolean(value("isofix")),
    city: value("city") ?? null,
    zip: value("zip") ?? null,
    description: value("description") ?? null,
    source: value("source") ?? "manual",
  };
}
