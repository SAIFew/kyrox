import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AuthError,
  assertAuthenticationOrigin,
  issueNonce,
  parseAuthenticationMessage,
  verifyAuthentication,
  type AuthStore,
  type NonceRecord,
  type SessionRecord,
} from "../lib/server/auth.js";
import { evaluateSameOrigin, sameOrigin } from "../lib/server/http.js";
import {
  canonicalAppOrigin,
  isApprovedOrigin,
  LOCAL_DEFAULT_APP_ORIGIN,
  OriginError,
} from "../lib/server/origin.js";

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
const NOW = new Date("2026-11-25T10:00:00.000Z");
const APPROVED = "https://app.kyrox.example";
const LOCAL = "http://127.0.0.1:3000";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("canonical application origin", () => {
  it("accepts a canonical HTTPS production origin", () => {
    expect(canonicalAppOrigin(APPROVED, "base-sepolia")).toBe(APPROVED);
  });

  it("rejects insecure, malformed, credentialed, or path-bearing production origins", () => {
    for (const value of [
      "http://app.kyrox.example",
      "https://user:pass@app.kyrox.example",
      "https://app.kyrox.example/path",
      "https://app.kyrox.example/?x=1",
      "https://app.kyrox.example/#fragment",
      "not-a-url",
      "",
    ]) {
      expect(() => canonicalAppOrigin(value, "base-sepolia")).toThrow(OriginError);
    }
  });

  it("defaults local mode to loopback and rejects non-loopback local origins", () => {
    expect(canonicalAppOrigin(undefined, "local-anvil")).toBe(LOCAL_DEFAULT_APP_ORIGIN);
    expect(canonicalAppOrigin(LOCAL, "local-anvil")).toBe(LOCAL);
    expect(() => canonicalAppOrigin("https://app.kyrox.example", "local-anvil")).toThrow(
      OriginError,
    );
  });

  it("compares Origin headers exactly and rejects missing, null, and malformed values", () => {
    expect(isApprovedOrigin(APPROVED, APPROVED)).toBe(true);
    expect(isApprovedOrigin("https://evil.example", APPROVED)).toBe(false);
    expect(isApprovedOrigin("null", APPROVED)).toBe(false);
    expect(isApprovedOrigin(null, APPROVED)).toBe(false);
    expect(isApprovedOrigin("not-a-url", APPROVED)).toBe(false);
  });
});

describe("same-origin mutation policy", () => {
  const body = { method: "POST" };

  it("accepts the approved origin and rejects a different one", () => {
    expect(
      sameOrigin(
        new Request(`${APPROVED}/api/test`, { ...body, headers: { Origin: APPROVED } }),
        APPROVED,
      ),
    ).toBe(true);
    expect(
      sameOrigin(
        new Request(`${APPROVED}/api/test`, {
          ...body,
          headers: { Origin: "https://evil.example" },
        }),
        APPROVED,
      ),
    ).toBe(false);
  });

  it("fails closed for missing Origin in production and allows loopback API use", () => {
    vi.stubEnv("APP_ORIGIN", APPROVED);
    vi.stubEnv("KYROX_ENVIRONMENT", "base-sepolia");
    const productionRequest = new Request(`${APPROVED}/api/test`, body);
    expect(evaluateSameOrigin(productionRequest)).toEqual({ origin: APPROVED, allowed: false });

    vi.stubEnv("APP_ORIGIN", LOCAL);
    vi.stubEnv("KYROX_ENVIRONMENT", "local-anvil");
    const localRequest = new Request(`${LOCAL}/api/test`, body);
    expect(evaluateSameOrigin(localRequest)).toEqual({ origin: LOCAL, allowed: true });
  });

  it("uses APP_ORIGIN instead of trusting Host headers", () => {
    vi.stubEnv("APP_ORIGIN", APPROVED);
    vi.stubEnv("KYROX_ENVIRONMENT", "base-sepolia");
    const request = new Request(`${APPROVED}/api/test`, {
      method: "POST",
      headers: { Origin: APPROVED, Host: "evil.example" },
    });
    expect(evaluateSameOrigin(request)).toEqual({ origin: APPROVED, allowed: true });
  });

  it("accepts a public HTTPS preview origin without requiring KYROX_ENVIRONMENT", () => {
    vi.stubEnv("APP_ORIGIN", APPROVED);
    vi.stubEnv("KYROX_ENVIRONMENT", "");
    const request = new Request(`${APPROVED}/api/test`, {
      method: "POST",
      headers: { Origin: APPROVED },
    });
    expect(evaluateSameOrigin(request)).toEqual({ origin: APPROVED, allowed: true });
  });

  it("still rejects a non-loopback HTTP origin", () => {
    vi.stubEnv("APP_ORIGIN", "http://preview.example");
    vi.stubEnv("KYROX_ENVIRONMENT", "");
    expect(() =>
      evaluateSameOrigin(
        new Request("http://preview.example/api/test", {
          method: "POST",
          headers: { Origin: "http://preview.example" },
        }),
      ),
    ).toThrow(OriginError);
  });
});

describe("SIWE origin binding", () => {
  it("uses the configured origin in the challenge and verifies successfully", async () => {
    const store = new MemoryAuth();
    const message = await issueNonce(store, account.address, NOW, APPROVED);
    expect(message).toContain("app.kyrox.example wants you to sign in with Ethereum:");
    expect(message).toContain(`URI: ${APPROVED}`);
    expect(message).not.toContain("kyrox.local");

    const signature = await account.signMessage({ message });
    const session = await verifyAuthentication(store, message, signature, NOW, APPROVED);
    expect(session.address).toBe(account.address);
  });

  it("rejects a challenge presented for a different approved origin", async () => {
    const store = new MemoryAuth();
    const message = await issueNonce(store, account.address, NOW, APPROVED);
    const signature = await account.signMessage({ message });
    await expect(
      verifyAuthentication(store, message, signature, NOW, "https://other.kyrox.example"),
    ).rejects.toMatchObject({ code: "ORIGIN_MISMATCH" });
  });

  it("rejects host-header-style domain spoofing in a signed challenge", async () => {
    const store = new MemoryAuth();
    const message = await issueNonce(store, account.address, NOW, APPROVED);
    const spoofed = message.replace(
      "app.kyrox.example wants you to sign in with Ethereum:",
      "evil.example wants you to sign in with Ethereum:",
    );
    const signature = await account.signMessage({ message: spoofed });
    await expect(
      verifyAuthentication(store, spoofed, signature, NOW, APPROVED),
    ).rejects.toMatchObject({ code: "ORIGIN_MISMATCH" });
  });

  it("parses and binds host and URI independently", () => {
    const parsed = parseAuthenticationMessage(
      [
        "app.kyrox.example wants you to sign in with Ethereum:",
        account.address,
        "",
        `URI: ${APPROVED}`,
        "Version: 1",
        "Chain ID: 84532",
        "Nonce: abc",
        `Issued At: ${NOW.toISOString()}`,
        "Expiration Time: 2026-11-25T10:05:00.000Z",
      ].join("\n"),
    );
    expect(parsed.host).toBe("app.kyrox.example");
    expect(parsed.uri).toBe(APPROVED);
    expect(() => assertAuthenticationOrigin(parsed, APPROVED)).not.toThrow();
    expect(() => assertAuthenticationOrigin(parsed, "https://other.example")).toThrow(AuthError);
  });
});
