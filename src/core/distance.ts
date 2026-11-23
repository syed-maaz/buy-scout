/**
 * One distance tolerance for source filtering, integrity checks and evaluation.
 * Small radii use a 5 km floor; larger radii use 5% of the radius.
 */
export function distanceToleranceKm(radiusKm: number): number {
  return Math.max(5, Math.ceil(radiusKm * 0.05));
}

export function withinDistanceLimit(distanceKm: number | null, radiusKm: number): boolean {
  return distanceKm === null || distanceKm <= radiusKm + distanceToleranceKm(radiusKm);
}
