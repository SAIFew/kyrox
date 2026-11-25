export type RuntimeMode = "local-anvil" | "base-sepolia";

export const LOCAL_DEFAULT_APP_ORIGIN = "http://127.0.0.1:3000";

export class OriginError extends Error {
  override readonly name = "OriginError";
}

export function runtimeMode(): RuntimeMode {
  return (process.env["KYROX_ENVIRONMENT"] ?? "local-anvil").trim() === "base-sepolia"
    ? "base-sepolia"
    : "local-anvil";
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "[::1]"
  );
}

/**
 * Parse a canonical application origin. Paths, queries, fragments, credentials
 * and non-loopback HTTP origins are rejected. Production requires HTTPS.
 */
export function canonicalAppOrigin(raw: string | undefined, mode: RuntimeMode): string {
  const value = raw?.trim() ?? "";
  if (value.length === 0) {
    if (mode === "local-anvil") return LOCAL_DEFAULT_APP_ORIGIN;
    throw new OriginError("APP_ORIGIN is required in production.");
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new OriginError("APP_ORIGIN must be a valid absolute origin.");
  }

  if (url.username !== "" || url.password !== "") {
    throw new OriginError("APP_ORIGIN must not contain credentials.");
  }
  if (url.pathname !== "/" || url.search !== "" || url.hash !== "") {
    throw new OriginError("APP_ORIGIN must not contain a path, query or fragment.");
  }
  if (mode === "base-sepolia" && url.protocol !== "https:") {
    throw new OriginError("APP_ORIGIN must use HTTPS in production.");
  }
  if (mode === "local-anvil" && url.protocol !== "http:" && url.protocol !== "https:") {
    throw new OriginError("APP_ORIGIN must use HTTP or HTTPS locally.");
  }
  if (mode === "local-anvil" && !isLoopbackHostname(url.hostname)) {
    throw new OriginError("Local APP_ORIGIN must use a loopback hostname.");
  }

  return url.origin;
}

/**
 * Resolve the approved origin for a server request.
 *
 * A configured APP_ORIGIN (or the existing public metadata URL as a migration
 * fallback) is authoritative. Preview mode without either value falls back to
 * the request origin so the simulated venue keeps working without extra
 * configuration; live mode still requires APP_ORIGIN through loadEnvironment().
 */
export function appOriginForRequest(req: Request): string {
  const configured =
    process.env["APP_ORIGIN"]?.trim() || process.env["NEXT_PUBLIC_APP_URL"]?.trim();
  if (configured !== undefined && configured.length > 0) {
    // A public HTTPS origin is a deployed origin even when the preview keeps
    // KYROX_ENVIRONMENT at its local default. Validate it under the production
    // rules (HTTPS required, no path/query/fragment) instead of rejecting the
    // documented Vercel preview as a non-loopback local origin. Plain HTTP is
    // still only accepted for loopback development.
    const mode = configured.toLowerCase().startsWith("https:") ? "base-sepolia" : runtimeMode();
    return canonicalAppOrigin(configured, mode);
  }
  if (runtimeMode() === "base-sepolia") {
    return canonicalAppOrigin(undefined, "base-sepolia");
  }
  return new URL(req.url).origin;
}

/** SIWE domain and URI values derived only from the approved origin. */
export function siweOriginValues(origin: string): { host: string; uri: string } {
  const url = new URL(origin);
  return { host: url.host, uri: url.origin };
}

/** True only when a supplied Origin header exactly matches the approved origin. */
export function isApprovedOrigin(candidate: string | null, approvedOrigin: string): boolean {
  if (candidate === null || candidate.length === 0 || candidate === "null") return false;
  try {
    return new URL(candidate).origin === approvedOrigin;
  } catch {
    return false;
  }
}

/** Missing Origin is tolerated only for a loopback developer origin. */
export function allowsMissingOrigin(approvedOrigin: string): boolean {
  try {
    return isLoopbackHostname(new URL(approvedOrigin).hostname);
  } catch {
    return false;
  }
}
