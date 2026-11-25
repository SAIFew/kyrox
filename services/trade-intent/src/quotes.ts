import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import {
  BASE_SEPOLIA_CHAIN_ID,
  CoreError,
  DEFAULT_QUOTE_TTL_SECONDS,
  createQuote,
  isCoreError,
  type Address,
  type AssetDefinition,
  type AssetFreshnessConfig,
  type MarketSession,
  type PolicyContext,
  type PriceBounds,
  type PriceObservation,
  type Quote,
  type TradePolicyConfig,
  type TradeSide,
} from "@kyrox/core";
import { hashQuote } from "@kyrox/protocol";

import {
  IntentError,
  prepareTradeIntent,
  type PreparedTradeIntent,
  type SepoliaTokenReader,
} from "./intent.js";
import { assertCanonicalObservation } from "./observation.js";

export interface AuthenticatedSession {
  /** Wallet ownership established by the authentication layer, never by the client body. */
  readonly trader: Address;
}

export interface IssuedQuoteRecord {
  readonly id: string;
  readonly trader: Address;
  readonly assetSymbol: string;
  readonly quote: Quote;
  readonly observation: PriceObservation;
  readonly freshness: AssetFreshnessConfig;
  readonly priceBounds: PriceBounds;
  readonly session: MarketSession;
  readonly maxSlippageBps: number;
  readonly issuedAt: number;
  readonly expiresAt: number;
  used: boolean;
}

export interface IssuedQuoteStore {
  save(record: IssuedQuoteRecord): Promise<void>;
  get(id: string): Promise<IssuedQuoteRecord | null>;
  /** Atomically mark used; false if it was already used. */
  consume(id: string): Promise<boolean>;
}

export class InMemoryIssuedQuoteStore implements IssuedQuoteStore {
  readonly records = new Map<string, IssuedQuoteRecord>();

  async save(record: IssuedQuoteRecord): Promise<void> {
    this.records.set(record.id, record);
  }

  async get(id: string): Promise<IssuedQuoteRecord | null> {
    return this.records.get(id) ?? null;
  }

  async consume(id: string): Promise<boolean> {
    const record = this.records.get(id);
    if (record === undefined || record.used) return false;
    record.used = true;
    return true;
  }
}

/** Trusted server-side data. The public caller never supplies any of this. */
export interface TrustedPolicySource {
  nowSeconds(): number;
  dailySpentUsdc(trader: Address): Promise<bigint>;
  isExchangePaused(): Promise<boolean>;
  isAssetEnabled(symbol: string): Promise<boolean>;
  marketSession(symbol: string): Promise<MarketSession>;
  freshnessFor(symbol: string): AssetFreshnessConfig;
  priceBoundsFor(symbol: string): PriceBounds;
}

export interface IssueQuoteParams {
  readonly session: AuthenticatedSession;
  readonly asset: AssetDefinition;
  readonly observation: PriceObservation;
  readonly side: TradeSide;
  readonly amountIn: bigint;
  readonly maxSlippageBps: number;
}

export interface PrepareIssuedIntentParams {
  readonly session: AuthenticatedSession | null | undefined;
  readonly quoteId: string;
  readonly quoteToken: string;
  readonly asset: AssetDefinition;
  readonly exchange: Address;
  readonly deadline: number;
  readonly reader: SepoliaTokenReader;
}

export interface IssuedQuoteResult {
  readonly quoteId: string;
  readonly quoteToken: string;
  readonly quote: Quote;
  readonly expiresAt: number;
  readonly ttlSeconds: number;
}

export interface PreparedIssuedIntent extends PreparedTradeIntent {
  readonly quoteId: string;
}

export class QuoteServiceError extends Error {
  override readonly name = "QuoteServiceError";

  constructor(
    readonly code:
      | "UNAUTHENTICATED"
      | "QUOTE_NOT_FOUND"
      | "QUOTE_TOKEN_INVALID"
      | "QUOTE_EXPIRED"
      | "QUOTE_REPLAYED"
      | "QUOTE_ASSET_MISMATCH"
      | "QUOTE_TTL_TOO_LONG"
      | "POLICY_SOURCE_INVALID"
      | "TRADING_PAUSED"
      | "ACCOUNT_BANNED",
    message: string,
  ) {
    super(message);
  }
}

const MIN_SECRET_LENGTH = 32;
const MAX_TTL_SECONDS = 300;

/**
 * Server-controlled quote issuance and intent preparation.
 *
 * A public client receives only an opaque quote id/token. Expiry, trader,
 * observation, policy context and clock are server-controlled; none can be
 * supplied or extended by the caller.
 */
export class QuoteService {
  readonly #secret: string;
  readonly #store: IssuedQuoteStore;
  readonly #policy: TrustedPolicySource;
  readonly #policyConfig: TradePolicyConfig;
  readonly #maxTtlSeconds: number;
  readonly #exchange: Address;
  readonly #reader: SepoliaTokenReader;

  constructor(deps: {
    secret: string;
    store: IssuedQuoteStore;
    policy: TrustedPolicySource;
    policyConfig: TradePolicyConfig;
    exchange: Address;
    reader: SepoliaTokenReader;
    maxTtlSeconds?: number;
  }) {
    if (deps.secret.length < MIN_SECRET_LENGTH) {
      throw new QuoteServiceError(
        "POLICY_SOURCE_INVALID",
        "Quote secret must be at least 32 characters.",
      );
    }
    const maxTtl = deps.maxTtlSeconds ?? DEFAULT_QUOTE_TTL_SECONDS;
    if (!Number.isInteger(maxTtl) || maxTtl <= 0 || maxTtl > MAX_TTL_SECONDS) {
      throw new QuoteServiceError(
        "QUOTE_TTL_TOO_LONG",
        `Quote TTL must be between 1 and ${MAX_TTL_SECONDS} seconds.`,
      );
    }
    this.#secret = deps.secret;
    this.#store = deps.store;
    this.#policy = deps.policy;
    this.#policyConfig = deps.policyConfig;
    this.#maxTtlSeconds = maxTtl;
    this.#exchange = deps.exchange;
    this.#reader = deps.reader;
  }

  async issueQuote(params: IssueQuoteParams): Promise<IssuedQuoteResult> {
    const now = this.#policy.nowSeconds();
    if (!Number.isInteger(now) || now <= 0) {
      throw new QuoteServiceError("POLICY_SOURCE_INVALID", "Trusted clock is invalid.");
    }
    if (params.asset.stockToken === null) {
      throw new QuoteServiceError(
        "QUOTE_ASSET_MISMATCH",
        `Asset ${params.asset.symbol} has no deployed token.`,
      );
    }
    const stockToken = params.asset.stockToken;

    const chainId = await this.#reader.getChainId();
    if (chainId !== BASE_SEPOLIA_CHAIN_ID) {
      throw new IntentError("WRONG_CHAIN", `RPC is on chain ${chainId}, expected 84532.`);
    }
    const stockDecimals = await this.#reader.getTokenDecimals(stockToken);
    if (stockDecimals !== params.asset.stockDecimals) {
      throw new IntentError(
        "DECIMALS_MISMATCH",
        `Token reports ${stockDecimals} decimals but the asset declares ${params.asset.stockDecimals}.`,
      );
    }
    const canonical = await this.#reader.readObservation(this.#exchange, stockToken);
    assertCanonicalObservation({
      observation: params.observation,
      canonical,
      asset: params.asset,
      stockDecimals,
      nowSeconds: now,
    });

    const freshness = this.#policy.freshnessFor(params.asset.symbol);
    const priceBounds = this.#policy.priceBoundsFor(params.asset.symbol);
    const session = await this.#policy.marketSession(params.asset.symbol);

    let quote: Quote;
    try {
      quote = createQuote(
        {
          assetSymbol: params.asset.symbol,
          side: params.side,
          amountIn: params.amountIn,
          maxSlippageBps: params.maxSlippageBps,
        },
        params.asset,
        params.observation,
        {
          nowSeconds: now,
          chainId: 84_532,
          freshnessConfig: freshness,
          session,
          priceBounds,
          quoteTtlSeconds: this.#maxTtlSeconds,
        },
      );
    } catch (error) {
      if (isCoreError(error)) throw error;
      throw error;
    }

    const id = randomUUID();
    const token = this.#sign(id, params.session.trader, quote);
    const record: IssuedQuoteRecord = {
      id,
      trader: params.session.trader,
      assetSymbol: params.asset.symbol,
      quote,
      observation: params.observation,
      freshness,
      priceBounds,
      session,
      maxSlippageBps: params.maxSlippageBps,
      issuedAt: now,
      expiresAt: quote.expiresAt,
      used: false,
    };
    await this.#store.save(record);
    return {
      quoteId: id,
      quoteToken: token,
      quote,
      expiresAt: quote.expiresAt,
      ttlSeconds: this.#maxTtlSeconds,
    };
  }

  async prepareIntent(params: PrepareIssuedIntentParams): Promise<PreparedIssuedIntent> {
    if (params.session === null || params.session === undefined) {
      throw new QuoteServiceError(
        "UNAUTHENTICATED",
        "An authenticated wallet session is required.",
      );
    }
    const record = await this.#store.get(params.quoteId);
    if (record === null) {
      throw new QuoteServiceError("QUOTE_NOT_FOUND", "Quote was not issued by this service.");
    }
    if (record.trader !== params.session.trader) {
      throw new QuoteServiceError("UNAUTHENTICATED", "Quote belongs to a different wallet.");
    }
    if (!this.#verifyToken(record, params.quoteToken)) {
      throw new QuoteServiceError(
        "QUOTE_TOKEN_INVALID",
        "Quote token is invalid or was tampered with.",
      );
    }
    if (record.assetSymbol !== params.asset.symbol) {
      throw new QuoteServiceError("QUOTE_ASSET_MISMATCH", "Quote is for a different asset.");
    }

    const now = this.#policy.nowSeconds();
    if (now >= record.expiresAt) {
      throw new QuoteServiceError("QUOTE_EXPIRED", "Quote has expired.");
    }

    const dailySpent = await this.#policy.dailySpentUsdc(record.trader);
    const exchangePaused = await this.#policy.isExchangePaused();
    const assetEnabled = await this.#policy.isAssetEnabled(record.assetSymbol);
    const session = await this.#policy.marketSession(record.assetSymbol);
    const context: PolicyContext = {
      nowSeconds: now,
      utcDay: Math.floor(now / 86_400),
      dailySpentUsdc: dailySpent,
      exchangePaused,
      assetEnabled,
      session,
      freshness: record.freshness,
      priceBounds: record.priceBounds,
    };

    const intent = await prepareTradeIntent({
      quote: record.quote,
      observation: record.observation,
      request: {
        assetSymbol: record.assetSymbol,
        side: record.quote.side,
        amountIn: record.quote.amountIn,
        maxSlippageBps: record.maxSlippageBps,
      },
      asset: params.asset,
      trader: params.session.trader,
      exchange: params.exchange,
      deadline: params.deadline,
      nowSeconds: now,
      policyConfig: this.#policyConfig,
      policyContext: context,
      reader: params.reader,
    });

    const consumed = await this.#store.consume(record.id);
    if (!consumed) {
      throw new QuoteServiceError("QUOTE_REPLAYED", "Quote has already been used.");
    }

    return { ...intent, quoteId: record.id };
  }

  #sign(id: string, trader: Address, quote: Quote): string {
    // The protocol v1 quote hash is unchanged for golden-vector compatibility.
    // This server-only HMAC additionally binds decimals and full provenance.
    const payload = [
      id,
      trader.toLowerCase(),
      quote.assetSymbol,
      quote.side,
      quote.amountIn.toString(),
      quote.minAmountOut.toString(),
      quote.priceUsdcPerWholeToken.toString(),
      quote.sourceRoundId.toString(),
      quote.sourceUpdatedAt.toString(),
      quote.expiresAt.toString(),
      quote.stockDecimals.toString(),
      quote.sourceKind,
      quote.sourceChainId.toString(),
      (quote.feedAddress ?? "").toLowerCase(),
      hashQuote({
        chainId: quote.chainId,
        stockToken: quote.stockToken as Address,
        side: quote.side,
        amountIn: quote.amountIn,
        amountOut: quote.amountOut,
        minAmountOut: quote.minAmountOut,
        priceUsdcPerWholeToken: quote.priceUsdcPerWholeToken,
        sourceRoundId: quote.sourceRoundId,
        sourceUpdatedAt: quote.sourceUpdatedAt,
        expiresAt: quote.expiresAt,
      }),
    ].join("|");
    return createHmac("sha256", this.#secret).update(payload).digest("hex");
  }

  #verifyToken(record: IssuedQuoteRecord, token: string): boolean {
    const expected = this.#sign(record.id, record.trader, record.quote);
    const provided = Buffer.from(token, "utf8");
    const wanted = Buffer.from(expected, "utf8");
    return provided.length === wanted.length && timingSafeEqual(provided, wanted);
  }
}

/** Re-exported so callers can handle typed intent failures without importing both modules. */
export { CoreError, IntentError };
