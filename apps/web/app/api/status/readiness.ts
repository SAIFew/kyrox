export interface ReadinessCheck {
  readonly id: string;
  readonly status: string;
}

/**
 * Readiness is conjunctive: a simulated publication can never compensate for a
 * failed critical dependency, and a missing critical check fails closed.
 */
export function isReadyForTraffic(
  checks: readonly ReadinessCheck[],
  criticalIds: ReadonlySet<string>,
): boolean {
  const critical = checks.filter((entry) => criticalIds.has(entry.id));
  if (new Set(critical.map((entry) => entry.id)).size !== criticalIds.size) return false;
  if (!critical.every((entry) => entry.status === "operational" || entry.status === "simulated")) {
    return false;
  }
  const publication = checks.find((entry) => entry.id === "publication");
  return publication?.status === "operational" || publication?.status === "simulated";
}
