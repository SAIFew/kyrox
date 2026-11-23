/**
 * Preview mode switch.
 *
 * Explicit opt-in wins. When no database is configured the application runs as
 * a clearly-labelled simulator instead of failing every request with a 503.
 */
export function isDemoMode(): boolean {
  const flag = (process.env["KYROX_DEMO_MODE"] ?? "").trim().toLowerCase();
  if (flag === "1" || flag === "true" || flag === "yes") return true;
  if (flag === "0" || flag === "false" || flag === "no") return false;
  return (process.env["DATABASE_URL"] ?? "").trim().length === 0;
}
