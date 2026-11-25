import type { TradeSide } from "../market-types.js";

export class ApiError extends Error {
  override readonly name: string = "ApiError";

  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export class RequestError extends ApiError {
  override readonly name = "RequestError";

  constructor(code: string, message: string, status = 400) {
    super(status, code, message);
  }
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === Object.prototype || prototype === null;
}

async function readBoundedText(request: Request, maximumBytes: number): Promise<string> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new RequestError("payload_too_large", "Request body is too large.", 413);
  }
  if (request.body === null) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new RequestError("payload_too_large", "Request body is too large.", 413);
      }
      chunks.push(value);
    }
  } catch (err) {
    if (err instanceof RequestError) throw err;
    throw new RequestError("bad_json", "Request body could not be read.");
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new RequestError("bad_json", "Request body must be valid UTF-8 JSON.");
  }
}

export async function readJson(
  request: Request,
  options: { maximumBytes?: number; allowEmpty?: boolean } = {},
): Promise<unknown> {
  const text = await readBoundedText(request, options.maximumBytes ?? 32_768);
  if (text.trim().length === 0 && options.allowEmpty === true) return {};
  if (text.trim().length === 0) {
    throw new RequestError("bad_json", "A JSON request body is required.");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new RequestError("bad_json", "Malformed JSON body.");
  }
}

export async function readJsonObject(
  request: Request,
  options: { maximumBytes?: number; allowEmpty?: boolean } = {},
): Promise<Record<string, unknown>> {
  const value = await readJson(request, options);
  if (!isPlainObject(value)) {
    throw new RequestError("invalid_body", "JSON body must be an object.");
  }
  return value;
}

export function stringField(
  body: Readonly<Record<string, unknown>>,
  name: string,
  options: { maximumLength?: number } = {},
): string {
  const value = body[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new RequestError("fields", `${name} is required and must be a non-empty string.`);
  }
  if (value.length > (options.maximumLength ?? 512)) {
    throw new RequestError("fields", `${name} is too long.`);
  }
  return value;
}

export function optionalStringField(
  body: Readonly<Record<string, unknown>>,
  name: string,
  options: { maximumLength?: number } = {},
): string | undefined {
  if (!(name in body)) return undefined;
  return stringField(body, name, options);
}

export function positiveBaseUnitField(
  body: Readonly<Record<string, unknown>>,
  name: string,
): string {
  const value = stringField(body, name, { maximumLength: 78 });
  if (!/^\d+$/.test(value)) {
    throw new RequestError("amount", `${name} must be a positive integer in base units.`);
  }
  let amount: bigint;
  try {
    amount = BigInt(value);
  } catch {
    throw new RequestError("amount", `${name} must be a positive integer in base units.`);
  }
  if (amount <= 0n || amount > 2n ** 256n - 1n) {
    throw new RequestError("amount", `${name} must be a positive uint256 in base units.`);
  }
  return amount.toString();
}

export function slippageField(body: Readonly<Record<string, unknown>>): number {
  const value = "slippageBps" in body ? body["slippageBps"] : 50;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 1_000) {
    throw new RequestError("slippage", "slippageBps must be an integer 0..1000.");
  }
  return value;
}

export function tradeSideField(body: Readonly<Record<string, unknown>>): TradeSide {
  const value = body["side"];
  if (value !== "buy" && value !== "sell") {
    throw new RequestError("side", "side must be buy or sell.");
  }
  return value;
}

export interface QuoteRequestInput {
  readonly symbol: string;
  readonly side: TradeSide;
  readonly amountIn: string;
  readonly slippageBps: number;
}

export function quoteRequestInput(body: Readonly<Record<string, unknown>>): QuoteRequestInput {
  return {
    symbol: stringField(body, "symbol", { maximumLength: 16 }),
    side: tradeSideField(body),
    amountIn: positiveBaseUnitField(body, "amountIn"),
    slippageBps: slippageField(body),
  };
}

const TRANSACTION_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;

export function isTransactionHash(value: unknown): value is `0x${string}` {
  return typeof value === "string" && TRANSACTION_HASH_PATTERN.test(value);
}

export function transactionHashField(body: Readonly<Record<string, unknown>>): `0x${string}` {
  const value = body["txHash"];
  if (!isTransactionHash(value)) {
    throw new RequestError("fields", "txHash must be an exact 32-byte hex transaction hash.");
  }
  return value;
}

export function signatureField(body: Readonly<Record<string, unknown>>): `0x${string}` {
  const value = body["signature"];
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value) || value.length % 2 !== 0) {
    throw new RequestError("fields", "signature must be a non-empty hex string.");
  }
  return value as `0x${string}`;
}
