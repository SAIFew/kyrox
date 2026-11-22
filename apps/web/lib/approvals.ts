/**
 * Return the exact base-unit amount the prepared intent will spend.
 *
 * The UI must approve this value, never an unlimited allowance. Values are
 * server-prepared strings; reject anything that is not a positive integer.
 */
export function exactApprovalAmount(amountIn: string): bigint {
  if (!/^\d+$/.test(amountIn)) {
    throw new Error("Approval amount must be a positive integer in base units.");
  }
  const amount = BigInt(amountIn);
  if (amount <= 0n) {
    throw new Error("Approval amount must be positive.");
  }
  return amount;
}
