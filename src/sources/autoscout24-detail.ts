import type { NormalisedListing } from "../core/types.js";
import { sha256 } from "../core/parse.js";

export interface As24Detail {
  id?: string;
  title?: string;
  description?: string;
  vehicle?: {
    numberOfSeats?: number | null;
    numberOfDoors?: number | null;
    bodyType?: string | null;
    firstRegistrationDateRaw?: string | null;
    mileageInKmRaw?: number | null;
    rawPowerInKw?: number | null;
    rawPowerInHp?: number | null;
    transmissionType?: string | null;
    fuelCategory?: { formatted?: string | null } | null;
    equipment?: Record<string, Array<{ id?: string | null }>> | null;
  } | null;
  prices?: {
    public?: {
      median?: number | null;
      priceRaw?: number | null;
    } | null;
  } | null;
  price?: {
    priceRaw?: number | null;
    priceEvaluation?: number | null;
  } | null;
  seller?: {
    isDealer?: boolean;
    companyName?: string | null;
  } | null;
  warranty?: string | null;
  warrantyExists?: boolean | null;
  vehicleReport?: {
    carfax?: { reportUrlEn?: string | null } | null;
  } | null;
  location?: {
    zip?: string | null;
    city?: string | null;
  } | null;
}

export function extractAs24Detail(html: string): As24Detail {
  const match = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/,
  );
  if (!match) throw new Error("AutoScout24 detail: __NEXT_DATA__ not found");
  const parsed = JSON.parse(match[1]) as {
    props?: { pageProps?: { listingDetails?: As24Detail } };
  };
  const detail = parsed.props?.pageProps?.listingDetails;
  if (!detail) throw new Error("AutoScout24 detail: listingDetails missing");
  return detail;
}

export function stripHtml(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function collectEquipment(
  equipment: Record<string, Array<{ id?: string | null }>> | null | undefined,
): string[] {
  if (!equipment) return [];
  const out = new Set<string>();
  for (const items of Object.values(equipment)) {
    for (const item of items) {
      if (item.id && item.id.trim()) out.add(item.id.trim());
    }
  }
  return [...out];
}

export function detectRedFlags(text: string): string[] {
  const flags: string[] = [];
  const patterns: Array<[string, RegExp]> = [
    ["Unfallschaden", /unfallschaden|unfallfahrzeug|nach\s+unfall/i],
    ["Bastler", /bastler|bastelfahrzeug/i],
    ["Motorschaden", /motorschaden|motor\s*defekt/i],
    ["Getriebeschaden", /getriebeschaden|getriebe\s*defekt/i],
    ["ohne TÜV", /ohne\s*(tüv|hu)|kein\s*(tüv|hu)|tüv\s*abgelaufen/i],
    ["nicht fahrbereit", /nicht\s*fahrbereit/i],
  ];
  for (const [label, pattern] of patterns) {
    if (pattern.test(text)) flags.push(label);
  }
  return flags;
}

export function detectCommercialOnly(text: string): boolean | null {
  if (!text.trim()) return null;
  return /nur\s+(an\s+)?(gewerb|händler)|ausschließlich\s+(an\s+)?gewerb|nur\s+export|export\s*only|für\s+gewerbetreibende|bevorzugt\s+an\s+gewerbetreibende/i.test(
    text,
  );
}

export function detectIsofix(equipment: string[], text: string): boolean | null {
  if (equipment.length === 0 && !text.trim()) return null;
  if (equipment.some((item) => /isofix/i.test(item))) return true;
  if (/isofix/i.test(text)) return true;
  return equipment.length > 0 ? false : null;
}

export function detectHuDue(text: string): string | null {
  if (/hu\s*\/\s*au\s*neu|hu\s+neu|neue\s+hu/i.test(text)) return "new";
  const match = text.match(/\bHU\s*(?:bis|gültig\s*bis)?\s*(\d{1,2}\s*[\/.]\s*\d{4})/i);
  return match ? match[1].replace(/\s+/g, "") : null;
}

export function mergeAs24Detail(base: NormalisedListing, detail: As24Detail): NormalisedListing {
  const description = stripHtml(detail.description);
  const equipment = collectEquipment(detail.vehicle?.equipment);
  const redFlags = detectRedFlags(description);
  const commercialOnly = detectCommercialOnly(description);
  const hasIsofix = detectIsofix(equipment, description);
  const huDue = detectHuDue(description);
  const now = new Date().toISOString();

  const contentHash = sha256(
    [
      base.title,
      detail.price?.priceRaw ?? base.priceEur ?? "",
      detail.vehicle?.mileageInKmRaw ?? base.mileageKm ?? "",
      detail.vehicle?.firstRegistrationDateRaw ?? base.firstRegistration ?? "",
      description.slice(0, 500),
    ].join("|"),
  ).slice(0, 16);

  return {
    ...base,
    title: detail.title ?? base.title,
    priceEur:
      detail.price?.priceRaw ??
      detail.prices?.public?.priceRaw ??
      base.priceEur,
    firstRegistration:
      detail.vehicle?.firstRegistrationDateRaw ?? base.firstRegistration,
    mileageKm: detail.vehicle?.mileageInKmRaw ?? base.mileageKm,
    fuel: detail.vehicle?.fuelCategory?.formatted ?? base.fuel,
    transmission: detail.vehicle?.transmissionType ?? base.transmission,
    powerKw: detail.vehicle?.rawPowerInKw ?? base.powerKw,
    powerPs: detail.vehicle?.rawPowerInHp ?? base.powerPs,
    bodyType: detail.vehicle?.bodyType ?? base.bodyType,
    seats: detail.vehicle?.numberOfSeats ?? null,
    doors: detail.vehicle?.numberOfDoors ?? null,
    sellerType: detail.seller?.isDealer ? "dealer" : detail.seller ? "private" : base.sellerType,
    sellerName: detail.seller?.companyName ?? base.sellerName,
    city: detail.location?.city ?? base.city,
    zip: detail.location?.zip ?? base.zip,
    priceEvaluation: detail.price?.priceEvaluation ?? base.priceEvaluation,
    priceMedianEur: detail.prices?.public?.median ?? null,
    commercialOnly,
    hasIsofix,
    huDue,
    warranty:
      typeof detail.warrantyExists === "boolean"
        ? detail.warrantyExists
        : detail.warranty
          ? true
          : null,
    carfaxUrl: detail.vehicleReport?.carfax?.reportUrlEn ?? null,
    description: description || null,
    equipment,
    redFlags,
    summary: description ? description.slice(0, 300) : base.summary,
    lastSeenAt: now,
    contentHash,
    rawJson: JSON.stringify(detail),
  };
}
