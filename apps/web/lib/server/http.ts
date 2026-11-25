import { randomUUID } from "node:crypto";

import { cookies } from "next/headers";

import { CoreError } from "@kyrox/core";
import { DeploymentError } from "@kyrox/protocol";
import { IntentError, QuoteServiceError } from "@kyrox/trade-intent";

import { AuthError, requireSession, type AuthStore } from "./auth.js";
import { EnvironmentError } from "./env.js";
import { allowsMissingOrigin, appOriginForRequest, isApprovedOrigin } from "./origin.js";
import { logEvent } from "./observability.js";
import { mapQuoteError } from "./quote-errors.js";
import { ApiError } from "./request.js";

const MAX_RATE_LIMIT_BUCKETS = 10_000;
const PRUNE_INTERVAL_MS = 60_000;
const buckets = new Map<string, { count: number; resetAt: number }>();
let lastPrunedAt = 0;

function pruneExpired(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
  lastPrunedAt = now;
}

function evictOldestBucket(): void {
  let oldestKey: string | undefined;
  let oldestResetAt = Number.POSITIVE_INFINITY;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt < oldestResetAt) {
      oldestKey = key;
      oldestResetAt = bucket.resetAt;
    }
  }
  if (oldestKey !== undefined) buckets.delete(oldestKey);
}

export function rateLimit(key: string, limit = 10, windowMs = 60_000): boolean {
  const now = Date.now();
  if (now - lastPrunedAt >= PRUNE_INTERVAL_MS || buckets.size >= MAX_RATE_LIMIT_BUCKETS) {
    pruneExpired(now);
  }
  const boundedKey = key.length > 256 ? key.slice(0, 256) : key;
  const current = buckets.get(boundedKey);
  if (current === undefined || current.resetAt <= now) {
    if (current === undefined && buckets.size >= MAX_RATE_LIMIT_BUCKETS) evictOldestBucket();
    buckets.set(boundedKey, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (current.count >= limit) return false;
  current.count += 1;
  return true;
}

function trustedProxyEnabled(): boolean {
  return ["KYROX_TRUST_PROXY", "KYROX_TRUSTED_PROXY", "TRUST_PROXY"].some((name) =>
    ["1", "true", "yes", "on"].includes((process.env[name] ?? "").trim().toLowerCase()),
  );
}

export function clientIp(req?: Request): string {
  if (req === undefined || !trustedProxyEnabled()) return "direct";
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded === undefined || forwarded.length === 0 || forwarded.length > 64) return "direct";
  return forwarded;
}

/**
 * Validate browser mutation evidence against the configured application origin.
 * Host and forwarded-host headers are never trusted for this decision.
 * Production fails closed when Origin is absent; loopback development may omit
 * Origin for non-browser API clients.
 */
export function sameOrigin(
  req: Request,
  approvedOrigin: string,
  allowMissingOrigin = false,
): boolean {
  const origin = req.headers.get("origin");
  if (origin === null || origin.length === 0) return allowMissingOrigin;
  return isApprovedOrigin(origin, approvedOrigin);
}

export interface SameOriginDecision {
  readonly origin: string;
  readonly allowed: boolean;
}

/**
 * Resolve the approved origin for this request and apply the same-origin policy.
 * The canonical origin is APP_ORIGIN (or NEXT_PUBLIC_APP_URL during migration);
 * only a loopback origin permits a missing Origin header.
 */
export function evaluateSameOrigin(req: Request): SameOriginDecision {
  const origin = appOriginForRequest(req);
  return { origin, allowed: sameOrigin(req, origin, allowsMissingOrigin(origin)) };
}

export function requestId(): string {
  return randomUUID();
}

export function json(data: unknown, status = 200): Response {
  const body = JSON.stringify(data, (_key, value) =>
    typeof value === "bigint" ? value.toString() : value,
  );
  return new Response(body, {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export function error(
  message: string,
  status = 400,
  code = "bad_request",
  correlationId = requestId(),
): Response {
  const response = json({ error: message, code, requestId: correlationId }, status);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("x-request-id", correlationId);
  return response;
}

export function isDependencyFailure(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (
    err instanceof EnvironmentError ||
    err instanceof DeploymentError ||
    (err instanceof TypeError && err.message === "fetch failed")
  ) {
    return true;
  }
  return [
    "PostgresError",
    "DrizzleQueryError",
    "QueryError",
    "RpcRequestError",
    "HttpRequestError",
    "TimeoutError",
    "TransactionReceiptNotFoundError",
    "TransactionNotFoundError",
    "BaseError",
  ].includes(err.name);
}

function coreErrorResponse(err: CoreError, correlationId: string): Response {
  const code = err.code.toLowerCase();
  if (err.code === "QUOTE_EXPIRED") return error(err.message, 410, code, correlationId);
  if (err.code === "UNSUPPORTED_ASSET") return error(err.message, 404, code, correlationId);
  if (
    err.code === "ASSET_DISABLED" ||
    err.code === "EXCHANGE_PAUSED" ||
    err.code === "MARKET_CLOSED" ||
    err.code === "STALE_PRICE" ||
    err.code === "QUOTE_MISMATCH"
  ) {
    return error(err.message, 409, code, correlationId);
  }
  if (
    err.code === "TRADE_BELOW_MINIMUM" ||
    err.code === "TRADE_ABOVE_MAXIMUM" ||
    err.code === "DAILY_LIMIT_EXCEEDED" ||
    err.code === "ZERO_OUTPUT"
  ) {
    return error(err.message, 422, code, correlationId);
  }
  return error(err.message, 400, code, correlationId);
}

function intentErrorResponse(err: IntentError, correlationId: string): Response {
  const code = err.code.toLowerCase();
  if (err.code === "EXPIRED") return error(err.message, 410, code, correlationId);
  if (err.code === "POLICY_REJECTED") return error(err.message, 422, code, correlationId);
  if (
    err.code === "WRONG_CHAIN" ||
    err.code === "TOKEN_MISMATCH" ||
    err.code === "DECIMALS_MISMATCH" ||
    err.code === "QUOTE_MISMATCH" ||
    err.code === "STALE_OBSERVATION"
  ) {
    return error(err.message, 409, code, correlationId);
  }
  return error(err.message, 400, code, correlationId);
}

function redactedCause(cause: unknown): Record<string, string> {
  return {
    errorType: cause instanceof Error ? cause.name : typeof cause,
  };
}

/**
 * Map validation, domain, configuration, and dependency failures consistently.
 * Expected typed failures keep their public message. Unexpected infrastructure
 * failures are logged with a correlation id and never echo raw driver, RPC, SQL
 * or filesystem details to the client.
 */
export async function routeError(
  err: unknown,
  fallbackCode = "request_failed",
  correlationId = requestId(),
): Promise<Response> {
  if (err instanceof ApiError) return error(err.message, err.status, err.code, correlationId);
  if (err instanceof AuthError) return error(err.message, 401, err.code, correlationId);
  if (
    err instanceof Error &&
    (err.name === "SignatureInvalidError" || err.name === "InvalidSignatureError")
  ) {
    return error("Signature verification failed.", 401, "SIGNATURE_INVALID", correlationId);
  }
  if (err instanceof QuoteServiceError) {
    const mapped = mapQuoteError(err);
    return error(mapped.message, mapped.status, mapped.code, correlationId);
  }
  if (err instanceof CoreError) return coreErrorResponse(err, correlationId);
  if (err instanceof IntentError) return intentErrorResponse(err, correlationId);
  if (
    err instanceof Error &&
    err.name === "DemoQuoteError" &&
    "code" in err &&
    typeof err.code === "string" &&
    "status" in err &&
    typeof err.status === "number"
  ) {
    return error(err.message, err.status, err.code, correlationId);
  }
  if (isDependencyFailure(err)) {
    await logEvent("error", fallbackCode, "Dependency failure.", {
      requestId: correlationId,
      ...redactedCause(err),
    });
    return error(
      "A required service is temporarily unavailable.",
      503,
      "unavailable",
      correlationId,
    );
  }
  await logEvent("error", fallbackCode, "Unexpected request failure.", {
    requestId: correlationId,
    ...redactedCause(err),
  });
  return error("The request could not be completed.", 503, fallbackCode, correlationId);
}

export async function sessionFromCookies(store: AuthStore) {
  const storeCookies = await cookies();
  return requireSession(store, storeCookies.get("kyrox_session")?.value);
}

export function requireWallet(
  session: Awaited<ReturnType<typeof requireSession>>,
): asserts session is NonNullable<typeof session> {
  if (session === null) {
    throw new ApiError(401, "auth", "Authentication required.");
  }
}

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char,
  );
}
