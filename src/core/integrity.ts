import type { FilterIntegrity, RawRef, SearchBrief } from "./types.js";
import { distanceToleranceKm } from "./distance.js";

interface As24Payload {
  price?: { priceRaw?: number | null };
  location?: { distanceToSearchLocationInKm?: number | null };
}

export function checkFilterIntegrity(
  brief: SearchBrief,
  refs: RawRef[],
  totalResults: number | null,
): FilterIntegrity {
  const reasons: string[] = [];
  const prices: number[] = [];
  const distances: number[] = [];

  for (const ref of refs) {
    const payload = ref.payload as As24Payload | null;
    const price = payload?.price?.priceRaw;
    if (typeof price === "number" && Number.isFinite(price)) prices.push(price);
    const distance = payload?.location?.distanceToSearchLocationInKm;
    if (typeof distance === "number" && Number.isFinite(distance)) distances.push(distance);
  }

  const observedMaxPriceEur = prices.length ? Math.max(...prices) : null;
  const observedMaxDistanceKm = distances.length ? Math.max(...distances) : null;

  if (observedMaxPriceEur !== null && observedMaxPriceEur > brief.purchaseMaxEur) {
    reasons.push(
      `price filter leaked: observed max ${observedMaxPriceEur} EUR > cap ${brief.purchaseMaxEur} EUR`,
    );
  }

  const distanceTolerance = distanceToleranceKm(brief.location.radiusKm);
  if (observedMaxDistanceKm !== null && observedMaxDistanceKm > brief.location.radiusKm + distanceTolerance) {
    reasons.push(
      `radius filter leaked: observed max ${observedMaxDistanceKm} km > ${brief.location.radiusKm} km + ${distanceTolerance} km`,
    );
  }

  if (totalResults !== null && totalResults > 50_000) {
    reasons.push(`result set implausibly broad: ${totalResults} listings — filters likely ignored`);
  }

  if (refs.length === 0 && (totalResults === null || totalResults > 0)) {
    reasons.push("zero listings parsed despite a non-zero result count");
  }

  return {
    ok: reasons.length === 0,
    reasons,
    observedMaxPriceEur,
    observedMaxDistanceKm,
    totalResults,
  };
}
