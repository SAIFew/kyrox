import { createHash, randomBytes, randomUUID } from "node:crypto";

import { verifyMessage, type Address, type Hex } from "viem";

export const NONCE_TTL_SECONDS = 300;
export const SESSION_TTL_SECONDS = 3_600;

export interface NonceRecord {
  nonce: string;
  address: string | null;
  issuedAt: Date;
  expiresAt: Date;
  usedAt: Date | null;
}

export interface SessionRecord {
  tokenHash: string;
  address: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
}

export interface AuthStore {
  createNonce(
    address: string | null,
    issuedAt: Date,
    expiresAt: Date,
    nonce: string,
  ): Promise<void>;
  getNonce(nonce: string): Promise<NonceRecord | null>;
  consumeNonce(nonce: string, now: Date): Promise<boolean>;
  createSession(record: SessionRecord): Promise<void>;
  getSession(tokenHash: string): Promise<SessionRecord | null>;
  deleteSession(tokenHash: string): Promise<void>;
}

export class AuthError extends Error {
  override readonly name = "AuthError";

  constructor(
    readonly code:
      | "INVALID_NONCE"
      | "NONCE_EXPIRED"
      | "NONCE_REPLAYED"
      | "INVALID_MESSAGE"
      | "SIGNATURE_INVALID"
      | "ADDRESS_MISMATCH"
      | "SESSION_EXPIRED",
    message: string,
  ) {
    super(message);
  }
}

export interface AuthMessageParts {
  address: Address;
  nonce: string;
  issuedAt: string;
  expirationTime: string;
  host: string;
  uri: string;
}

/** Build the exact SIWE-style message the wallet is asked to sign. */
export function authenticationMessage(parts: AuthMessageParts): string {
  return [
    `${parts.host} wants you to sign in with Ethereum:`,
    parts.address,
    "",
    `URI: ${parts.uri}`,
    "Version: 1",
    "Chain ID: 84532",
    `Nonce: ${parts.nonce}`,
    `Issued At: ${parts.issuedAt}`,
    `Expiration Time: ${parts.expirationTime}`,
  ].join("\n");
}

export function parseAuthenticationMessage(message: string): {
  address: Address;
  nonce: string;
  issuedAt: string;
  expirationTime: string;
} {
  const lines = message.split("\n");
  if (lines.length < 9) {
    throw new AuthError("INVALID_MESSAGE", "Authentication message has an unexpected shape.");
  }
  const get = (prefix: string): string | undefined =>
    lines
      .find((line) => line.startsWith(prefix))
      ?.slice(prefix.length)
      .trim();
  const address = lines[1];
  const uri = get("URI: ");
  const chainId = get("Chain ID: ");
  const nonce = get("Nonce: ");
  const issuedAt = get("Issued At: ");
  const expirationTime = get("Expiration Time: ");
  if (
    address === undefined ||
    nonce === undefined ||
    uri === undefined ||
    chainId === undefined ||
    issuedAt === undefined ||
    expirationTime === undefined
  ) {
    throw new AuthError("INVALID_MESSAGE", "Authentication message is missing required fields.");
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw new AuthError("INVALID_MESSAGE", "Authentication message address is invalid.");
  }
  if (chainId !== "84532") {
    throw new AuthError("INVALID_MESSAGE", "Authentication message chain id is not supported.");
  }
  return { address: address as Address, nonce, issuedAt, expirationTime };
}

export async function issueNonce(store: AuthStore, address: string | null, now = new Date()) {
  const nonce = randomBytes(16).toString("hex");
  const issuedAt = now;
  const expiresAt = new Date(now.getTime() + NONCE_TTL_SECONDS * 1000);
  await store.createNonce(address, issuedAt, expiresAt, nonce);
  return authenticationMessage({
    address: (address as Address | null) ?? "0x0000000000000000000000000000000000000000",
    nonce,
    issuedAt: issuedAt.toISOString(),
    expirationTime: expiresAt.toISOString(),
    host: "KYROX",
    uri: "https://kyrox.local/auth",
  });
}

const SHA = (s: string) => createHash("sha256").update(s).digest("hex");

export async function verifyAuthentication(
  store: AuthStore,
  message: string,
  signature: Hex,
  now = new Date(),
): Promise<SessionRecord & { token: string }> {
  const parsed = parseAuthenticationMessage(message);
  const nonce = await store.getNonce(parsed.nonce);
  if (nonce === null) throw new AuthError("INVALID_NONCE", "Nonce is not recognized.");
  if (nonce.usedAt !== null) throw new AuthError("NONCE_REPLAYED", "Nonce was already used.");
  if (now.getTime() > nonce.expiresAt.getTime()) {
    throw new AuthError("NONCE_EXPIRED", "Nonce has expired.");
  }
  if (nonce.address !== null && nonce.address.toLowerCase() !== parsed.address.toLowerCase()) {
    throw new AuthError("ADDRESS_MISMATCH", "Nonce belongs to a different address.");
  }

  // Consume first, so a signature cannot be replayed even if verification later fails.
  const consumed = await store.consumeNonce(parsed.nonce, now);
  if (!consumed) throw new AuthError("NONCE_REPLAYED", "Nonce was already consumed.");

  const recovered = await verifyMessage({ address: parsed.address, message, signature });
  if (!recovered) throw new AuthError("SIGNATURE_INVALID", "Signature verification failed.");

  const token = randomUUID().replace(/-/g, "") + randomBytes(16).toString("hex");
  const record: SessionRecord = {
    tokenHash: SHA(token),
    address: parsed.address,
    createdAt: now,
    lastSeenAt: now,
    expiresAt: new Date(now.getTime() + SESSION_TTL_SECONDS * 1000),
  };
  await store.createSession(record);
  return { ...record, token };
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function requireSession(
  store: AuthStore,
  token: string | undefined,
  now = new Date(),
) {
  if (token === undefined || token.length === 0) return null;
  const session = await store.getSession(hashSessionToken(token));
  if (session === null) return null;
  if (now.getTime() > session.expiresAt.getTime()) {
    await store.deleteSession(session.tokenHash);
    throw new AuthError("SESSION_EXPIRED", "Session expired. Please sign in again.");
  }
  return session;
}

export { SHA as sha256Hex };
