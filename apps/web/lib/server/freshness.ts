/**
 * Freshness is judged only from the original source timestamp and the
 * per-asset manifest bound. A missing or non-positive bound fails closed rather
 * than falling back to a global default.
 */
export function isObservationFresh(
  nowSeconds: number,
  sourceUpdatedAt: number | null | undefined,
  maxSourceAgeSeconds: number | null | undefined,
): boolean {
  if (sourceUpdatedAt === null || sourceUpdatedAt === undefined) return false;
  if (
    maxSourceAgeSeconds === null ||
    maxSourceAgeSeconds === undefined ||
    !Number.isInteger(maxSourceAgeSeconds) ||
    maxSourceAgeSeconds <= 0
  ) {
    return false;
  }
  return nowSeconds - sourceUpdatedAt <= maxSourceAgeSeconds;
}
