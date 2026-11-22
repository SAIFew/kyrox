import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";

import {
  AuthError,
  authenticationMessage,
  issueNonce,
  requireSession,
  verifyAuthentication,
  type AuthStore,
  type NonceRecord,
  type SessionRecord,
} from "../lib/server/auth.js";

class MemoryAuth implements AuthStore {
  nonces = new Map<string, NonceRecord>();
  sessions = new Map<string, SessionRecord>();

  async createNonce(address: string | null, issuedAt: Date, expiresAt: Date, nonce: string) {
    this.nonces.set(nonce, { nonce, address, issuedAt, expiresAt, usedAt: null });
  }
  async getNonce(nonce: string) {
    return this.nonces.get(nonce) ?? null;
  }
  async consumeNonce(nonce: string, now: Date) {
    const record = this.nonces.get(nonce);
    if (record === undefined || record.usedAt !== null || record.expiresAt < now) return false;
    record.usedAt = now;
    return true;
  }
  async createSession(record: SessionRecord) {
    this.sessions.set(record.tokenHash, record);
  }
  async getSession(tokenHash: string) {
    return this.sessions.get(tokenHash) ?? null;
  }
  async deleteSession(tokenHash: string) {
    this.sessions.delete(tokenHash);
  }
}

const account = privateKeyToAccount(generatePrivateKey());
const other = privateKeyToAccount(generatePrivateKey());
const NOW = new Date("2026-11-22T10:00:00.000Z");

function messageFor(nonce: string, address = account.address) {
  return authenticationMessage({
    address,
    nonce,
    issuedAt: NOW.toISOString(),
    expirationTime: new Date(NOW.getTime() + 300_000).toISOString(),
    host: "KYROX",
    uri: "https://kyrox.local/auth",
  });
}

describe("wallet authentication", () => {
  it("verifies a signature and issues a session", async () => {
    const store = new MemoryAuth();
    const nonceMessage = await issueNonce(store, account.address.toLowerCase(), NOW);
    const nonce = /Nonce: ([a-f0-9]+)/.exec(nonceMessage)?.[1] as string;
    const message = messageFor(nonce);
    const signature = await account.signMessage({ message });
    const session = await verifyAuthentication(store, message, signature, NOW);
    expect(session.address.toLowerCase()).toBe(account.address.toLowerCase());
    expect(await requireSession(store, session.token, NOW)).not.toBeNull();
  });

  it("rejects a replay of the same nonce", async () => {
    const store = new MemoryAuth();
    const nonceMessage = await issueNonce(store, account.address.toLowerCase(), NOW);
    const nonce = /Nonce: ([a-f0-9]+)/.exec(nonceMessage)?.[1] as string;
    const message = messageFor(nonce);
    const signature = await account.signMessage({ message });
    await verifyAuthentication(store, message, signature, NOW);
    await expect(verifyAuthentication(store, message, signature, NOW)).rejects.toBeInstanceOf(
      AuthError,
    );
  });

  it("rejects an invalid signature and a mismatched wallet", async () => {
    const store = new MemoryAuth();
    const nonceMessage = await issueNonce(store, account.address.toLowerCase(), NOW);
    const nonce = /Nonce: ([a-f0-9]+)/.exec(nonceMessage)?.[1] as string;
    const message = messageFor(nonce);
    const signature = await other.signMessage({ message });
    await expect(verifyAuthentication(store, message, signature, NOW)).rejects.toMatchObject({
      code: "SIGNATURE_INVALID",
    });
  });

  it("rejects an expired nonce and an expired session", async () => {
    const store = new MemoryAuth();
    const nonceMessage = await issueNonce(store, account.address.toLowerCase(), NOW);
    const nonce = /Nonce: ([a-f0-9]+)/.exec(nonceMessage)?.[1] as string;
    const message = messageFor(nonce);
    const signature = await account.signMessage({ message });
    await expect(
      verifyAuthentication(store, message, signature, new Date(NOW.getTime() + 301_000)),
    ).rejects.toMatchObject({ code: "NONCE_EXPIRED" });

    const fresh = await issueNonce(store, account.address.toLowerCase(), NOW);
    const freshNonce = /Nonce: ([a-f0-9]+)/.exec(fresh)?.[1] as string;
    const freshMessage = messageFor(freshNonce);
    const freshSignature = await account.signMessage({ message: freshMessage });
    const session = await verifyAuthentication(store, freshMessage, freshSignature, NOW);
    await expect(
      requireSession(store, session.token, new Date(NOW.getTime() + 3_601_000)),
    ).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
  });

  it("rejects a nonce bound to another address", async () => {
    const store = new MemoryAuth();
    const nonceMessage = await issueNonce(store, other.address.toLowerCase(), NOW);
    const nonce = /Nonce: ([a-f0-9]+)/.exec(nonceMessage)?.[1] as string;
    const message = messageFor(nonce);
    const signature = await account.signMessage({ message });
    await expect(verifyAuthentication(store, message, signature, NOW)).rejects.toMatchObject({
      code: "ADDRESS_MISMATCH",
    });
  });
});
