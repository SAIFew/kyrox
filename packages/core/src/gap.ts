/**
 * Weekend Gap Guard.
 *
 * Tokenized stocks can trade while the US reference market is closed. When the
 * executable pool price drifts from the Chainlink reference, the quote must warn
 * or block. Thresholds are basis points so no binary floating point is used.
 */

export const GAP_WARN_BPS = 200; // 2%
export const GAP_BLOCK_BPS = 500; // 5%

export type GapAction = "allow" | "warn" | "block";

export interface GapAssessment {
  readonly action: GapAction;
  /** Absolute deviation in basis points, or null when a price is invalid. */
  readonly gapBps: number | null;
  /** Signed deviation: positive means the pool is above the reference. */
  readonly signedGapBps: number | null;
  readonly message: string;
}

export function assessGap(
  poolPrice: bigint,
  referencePrice: bigint,
  warnBps = GAP_WARN_BPS,
  blockBps = GAP_BLOCK_BPS,
): GapAssessment {
  if (poolPrice <= 0n || referencePrice <= 0n) {
    return {
      action: "block",
      gapBps: null,
      signedGapBps: null,
      message: "A valid pool and reference price are required before trading.",
    };
  }
  if (warnBps < 0 || blockBps <= warnBps) {
    throw new Error("Gap thresholds must satisfy 0 <= warn < block.");
  }

  const difference = poolPrice - referencePrice;
  const absolute = difference < 0n ? -difference : difference;
  const gapBps = Number((absolute * 10_000n) / referencePrice);
  const signedGapBps = difference < 0n ? -gapBps : gapBps;

  if (gapBps >= blockBps) {
    return {
      action: "block",
      gapBps,
      signedGapBps,
      message: `The pool price is ${(gapBps / 100).toFixed(2)}% away from the reference price. Trading is blocked until the gap narrows.`,
    };
  }
  if (gapBps >= warnBps) {
    return {
      action: "warn",
      gapBps,
      signedGapBps,
      message: `The US reference market may be closed. The pool price is ${(gapBps / 100).toFixed(2)}% ${signedGapBps > 0 ? "above" : "below"} the last reference. Review before signing.`,
    };
  }
  return { action: "allow", gapBps, signedGapBps, message: "" };
}
