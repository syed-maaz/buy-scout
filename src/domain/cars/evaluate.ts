import type { NormalisedListing, SearchBrief } from "../../core/types.js";
import { applyPreferences, type PreferenceMatch } from "../preferences.js";
import { distanceToleranceKm } from "../../core/distance.js";

export type CarVerdict = "inspect" | "ask" | "watch" | "reject";

export interface CarEvaluation {
  verdict: CarVerdict;
  hardPass: boolean;
  hardFailures: string[];
  unknowns: string[];
  score: number;
  confidence: number;
  reasons: string[];
  preferenceBoost: number;
  preferenceMatches: PreferenceMatch[];
  components: {
    family: number;
    deal: number;
    age: number;
    mileage: number;
    distance: number;
    evidence: number;
    preference: number;
  };
}

const HARD_RED_FLAGS = [
  "Unfallschaden",
  "Bastler",
  "Motorschaden",
  "motor defekt",
  "motor klappert",
  "Getriebeschaden",
  "getriebe defekt",
  "kupplung defekt",
  "turbolader defekt",
  "zahnriemen defekt",
  "ölverlust",
  "ohne TÜV",
  "kein TÜV",
  "nicht fahrbereit",
];

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function registrationYear(listing: NormalisedListing): number | null {
  if (!listing.firstRegistration) return null;
  const year = Number.parseInt(listing.firstRegistration.slice(0, 4), 10);
  return Number.isFinite(year) ? year : null;
}

function dealComponent(listing: NormalisedListing): number {
  if (listing.priceMedianEur && listing.priceEur) {
    const delta = (listing.priceMedianEur - listing.priceEur) / listing.priceMedianEur;
    return clamp01(0.5 + delta * 1.5);
  }
  switch (listing.priceLabel) {
    case "very-good-price":
    case "super-price":
      return 0.95;
    case "good-price":
      return 0.8;
    case "fair-price":
      return 0.55;
    case "high-price":
      return 0.3;
    default:
      return 0.5;
  }
}

function familyComponent(listing: NormalisedListing): { value: number; unknowns: string[] } {
  const unknowns: string[] = [];
  let score = 0;
  let weight = 0;

  if (listing.seats === null) unknowns.push("seats");
  else {
    weight += 2;
    score += listing.seats >= 5 ? 2 : 0;
  }

  if (listing.doors === null) unknowns.push("doors");
  else {
    weight += 2;
    score += listing.doors >= 4 ? 2 : 0;
  }

  if (listing.hasIsofix === null) unknowns.push("isofix");
  else {
    weight += 2;
    score += listing.hasIsofix ? 2 : 0;
  }

  if (listing.bodyType) {
    weight += 1;
    const body = listing.bodyType.toLowerCase();
    score += /kombi|suv|van|minivan|sportswagon|tourer/.test(body) ? 1 : 0.5;
  } else {
    unknowns.push("bodyType");
  }

  return { value: weight > 0 ? clamp01(score / weight) : 0.5, unknowns };
}

export function evaluateCar(
  brief: SearchBrief,
  listing: NormalisedListing,
  now: Date = new Date(),
): CarEvaluation {
  const hardFailures: string[] = [];
  const unknowns: string[] = [];
  const reasons: string[] = [];

  if (listing.priceEur !== null && listing.priceEur > brief.purchaseMaxEur) {
    hardFailures.push(`price ${listing.priceEur} € > cap ${brief.purchaseMaxEur} €`);
  }
  if (
    listing.distanceKm !== null &&
    listing.distanceKm > brief.location.radiusKm + distanceToleranceKm(brief.location.radiusKm)
  ) {
    hardFailures.push(`distance ${listing.distanceKm} km > radius ${brief.location.radiusKm} km`);
  }
  if (brief.hard.excludeDamaged) {
    if (listing.damaged === true) hardFailures.push("listed as damaged");
    else if (listing.damaged === null) unknowns.push("damaged");
  }
  if (brief.hard.excludeCommercialOnly) {
    if (listing.commercialOnly === true) hardFailures.push("commercial/export-only seller");
    else if (listing.commercialOnly === null) unknowns.push("commercialOnly");
  }
  if (listing.seats !== null && listing.seats < brief.hard.minSeats) {
    hardFailures.push(`seats ${listing.seats} < ${brief.hard.minSeats}`);
  } else if (listing.seats === null) {
    unknowns.push("seats");
  }
  if (listing.doors !== null && listing.doors < brief.hard.minDoors) {
    hardFailures.push(`doors ${listing.doors} < ${brief.hard.minDoors}`);
  } else if (listing.doors === null) {
    unknowns.push("doors");
  }
  if (listing.hasIsofix === false) {
    hardFailures.push("no ISOFIX");
  } else if (listing.hasIsofix === null) {
    unknowns.push("isofix");
  }

  const year = registrationYear(listing);
  if (listing.priceEur !== null && year !== null && year >= 2010 && listing.priceEur < 1000) {
    hardFailures.push(`price ${listing.priceEur} € is implausibly low for a ${year} car`);
  }
  if (year !== null && year < brief.hard.minFirstRegistrationYear) {
    hardFailures.push(`first registration ${year} < ${brief.hard.minFirstRegistrationYear}`);
  } else if (year === null) {
    unknowns.push("firstRegistration");
  }

  if (listing.mileageKm !== null && listing.mileageKm > brief.hard.maxMileageKm) {
    hardFailures.push(`mileage ${listing.mileageKm} km > ${brief.hard.maxMileageKm} km`);
  } else if (listing.mileageKm === null) {
    unknowns.push("mileage");
  }

  if (brief.hard.fuel !== "any") {
    if (listing.fuel === null) {
      unknowns.push("fuel");
    } else {
      const fuel = listing.fuel.toLowerCase();
      if (brief.hard.fuel === "petrol" && !fuel.includes("benzin")) {
        hardFailures.push(`fuel ${listing.fuel} != petrol`);
      }
      if (brief.hard.fuel === "diesel" && !fuel.includes("diesel")) {
        hardFailures.push(`fuel ${listing.fuel} != diesel`);
      }
    }
  }

  if (brief.hard.transmission !== "any") {
    if (listing.transmission === null) {
      unknowns.push("transmission");
    } else {
      const gearbox = listing.transmission.toLowerCase();
      if (brief.hard.transmission === "manual" && !gearbox.includes("schalt")) {
        hardFailures.push(`transmission ${listing.transmission} != manual`);
      }
      if (brief.hard.transmission === "automatic" && !gearbox.includes("autom")) {
        hardFailures.push(`transmission ${listing.transmission} != automatic`);
      }
    }
  }

  for (const flag of HARD_RED_FLAGS) {
    if (listing.redFlags.some((item) => item.toLowerCase().includes(flag.toLowerCase()))) {
      hardFailures.push(`red flag: ${flag}`);
    }
  }

  const family = familyComponent(listing);
  for (const unknown of family.unknowns) {
    if (!unknowns.includes(unknown)) unknowns.push(unknown);
  }

  const age = year === null ? 0.5 : clamp01(1 - Math.max(0, now.getFullYear() - year - 8) / 15);
  const mileage =
    listing.mileageKm === null ? 0.5 : clamp01(1 - Math.max(0, listing.mileageKm - 100000) / 150000);
  const distance =
    listing.distanceKm === null ? 0.5 : clamp01(1 - listing.distanceKm / brief.location.radiusKm);
  const deal = dealComponent(listing);
  const preferences = applyPreferences(brief.preferences, listing);

  const knownFields = [
    listing.priceEur,
    listing.mileageKm,
    listing.firstRegistration,
    listing.fuel,
    listing.transmission,
    listing.seats,
    listing.doors,
    listing.hasIsofix,
    listing.bodyType,
  ].filter((value) => value !== null).length;
  const evidence = clamp01(knownFields / 9);

  const rawScore =
    100 *
    (0.3 * family.value +
      0.25 * deal +
      0.15 * age +
      0.15 * mileage +
      0.1 * distance +
      0.05 * evidence);
  const score = hardFailures.length > 0 ? 0 : Math.min(100, rawScore + preferences.boost);
  const blockingUnknowns = unknowns.filter((item) =>
    ["seats", "doors", "isofix", "bodyType", "fuel", "transmission", "damaged", "commercialOnly"].includes(item),
  );
  const verdict: CarVerdict =
    hardFailures.length > 0
      ? "reject"
      : blockingUnknowns.length > 0
        ? "ask"
        : score >= 65
          ? "inspect"
          : "watch";

  if (hardFailures.length > 0) {
    reasons.push(...hardFailures);
  } else {
    reasons.push("passes hard gates");
    if (family.value >= 0.75) reasons.push("strong family fit");
    if (deal >= 0.75) reasons.push("priced well vs median/label");
    if (unknowns.length > 0) reasons.push(`unknowns: ${unknowns.join(", ")}`);
    for (const match of preferences.matches) {
      reasons.push(`priority: ${match.label} (+${match.weight})`);
    }
  }

  return {
    verdict,
    hardPass: hardFailures.length === 0,
    hardFailures,
    unknowns,
    score: Math.round(score * 10) / 10,
    confidence: Math.round(evidence * 100) / 100,
    reasons,
    preferenceBoost: preferences.boost,
    preferenceMatches: preferences.matches,
    components: {
      family: Math.round(family.value * 100) / 100,
      deal: Math.round(deal * 100) / 100,
      age: Math.round(age * 100) / 100,
      mileage: Math.round(mileage * 100) / 100,
      distance: Math.round(distance * 100) / 100,
      evidence: Math.round(evidence * 100) / 100,
      preference: Math.round(clamp01(preferences.boost / 25) * 100) / 100,
    },
  };
}
