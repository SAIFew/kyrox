import { encodeAbiParameters, encodeFunctionData, keccak256, type Hex } from "viem";

import type { Address } from "@kyrox/core";

import { PRICE_SET_EVENT_ABI, SET_PRICE_ABI, TRADE_ABI } from "./abi.js";

export interface SetPriceRequest {
  readonly stockToken: Address;
  readonly priceUsdcPerWholeToken: bigint;
  readonly sourceRoundId: bigint;
  readonly sourceUpdatedAt: number;
  readonly sourceChainId: number;
  readonly feedAddress: Address;
  readonly simulated: boolean;
}

export interface UnsignedTransaction {
  readonly to: Address;
  readonly data: Hex;
  readonly value: 0n;
}

/**
 * Encode `setPrice` exactly as the contract expects.
 *
 * This is construction only: nothing here signs, sends, or holds a key.
 */
export function encodeSetPrice(exchange: Address, request: SetPriceRequest): UnsignedTransaction {
  return {
    to: exchange,
    data: encodeFunctionData({
      abi: SET_PRICE_ABI,
      functionName: "setPrice",
      args: [
        request.stockToken,
        request.priceUsdcPerWholeToken,
        request.sourceRoundId,
        BigInt(request.sourceUpdatedAt),
        BigInt(request.sourceChainId),
        request.feedAddress,
        request.simulated,
      ],
    }),
    value: 0n,
  };
}

export interface TradeCalldataRequest {
  readonly side: "buy" | "sell";
  readonly stockToken: Address;
  readonly amountIn: bigint;
  readonly minAmountOut: bigint;
  readonly deadline: number;
}

export function encodeTrade(exchange: Address, request: TradeCalldataRequest): UnsignedTransaction {
  const functionName = request.side === "buy" ? "buy" : "sell";
  return {
    to: exchange,
    data: encodeFunctionData({
      abi: TRADE_ABI,
      functionName,
      args: [request.stockToken, request.amountIn, request.minAmountOut, BigInt(request.deadline)],
    }),
    value: 0n,
  };
}

export interface QuoteHashFields {
  readonly chainId: number;
  readonly stockToken: Address;
  readonly side: "buy" | "sell";
  readonly amountIn: bigint;
  readonly amountOut: bigint;
  readonly minAmountOut: bigint;
  readonly priceUsdcPerWholeToken: bigint;
  readonly sourceRoundId: bigint;
  readonly sourceUpdatedAt: number;
  readonly expiresAt: number;
}

/** Deterministic hash of the quote a user was shown. */
export function hashQuote(fields: QuoteHashFields): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "address" },
        { type: "bool" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
      ],
      [
        BigInt(fields.chainId),
        fields.stockToken,
        fields.side === "buy",
        fields.amountIn,
        fields.amountOut,
        fields.minAmountOut,
        fields.priceUsdcPerWholeToken,
        fields.sourceRoundId,
        BigInt(fields.sourceUpdatedAt),
        BigInt(fields.expiresAt),
      ],
    ),
  );
}

export interface TradeIntentFields {
  readonly chainId: number;
  readonly exchange: Address;
  readonly stockToken: Address;
  readonly trader: Address;
  readonly side: "buy" | "sell";
  readonly amountIn: bigint;
  readonly minAmountOut: bigint;
  readonly deadline: number;
  readonly priceUsdcPerWholeToken: bigint;
  readonly sourceRoundId: bigint;
  readonly sourceUpdatedAt: number;
}

/**
 * Deterministic intent hash binding every field a signer would authorise.
 *
 * The same fields always produce the same hash. The user's wallet signs the
 * transaction; this hash is an audit and display aid, not a signature.
 */
export function hashTradeIntent(fields: TradeIntentFields): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "address" },
        { type: "address" },
        { type: "address" },
        { type: "bool" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
      ],
      [
        BigInt(fields.chainId),
        fields.exchange,
        fields.stockToken,
        fields.trader,
        fields.side === "buy",
        fields.amountIn,
        fields.minAmountOut,
        BigInt(fields.deadline),
        fields.priceUsdcPerWholeToken,
        fields.sourceRoundId,
        BigInt(fields.sourceUpdatedAt),
      ],
    ),
  );
}

export interface PublicationArtifactInput {
  readonly exchange: Address;
  readonly stockToken: Address;
  readonly assetSymbol: string;
  readonly calldata: Hex;
  readonly calldataHash: Hex;
  readonly priceUsdcPerWholeToken: bigint;
  readonly sourceRoundId: bigint;
  readonly sourceUpdatedAt: number;
  readonly sourceChainId: number;
  readonly feedAddress: Address;
  readonly simulated: boolean;
}

export interface PublicationArtifact {
  readonly version: 1;
  readonly chainId: 84_532;
  readonly exchange: Address;
  readonly calldata: Hex;
  readonly value: "0";
  readonly assetSymbol: string;
  readonly stockToken: Address;
  readonly sourceRoundId: string;
  readonly sourceUpdatedAt: number;
  readonly calldataHash: Hex;
  readonly artifactHash: Hex;
  readonly expectedEvent: "PriceSet";
  readonly expectedObservation: {
    readonly priceUsdcPerWholeToken: string;
    readonly sourceRoundId: string;
    readonly sourceUpdatedAt: number;
    readonly sourceChainId: number;
    readonly feedAddress: Address;
    readonly simulated: boolean;
  };
}

/**
 * Deterministic, tamper-evident descriptor for an externally signed
 * publication. It contains no signature and no key material.
 */
export function createPublicationArtifact(input: PublicationArtifactInput): PublicationArtifact {
  const artifactHash = keccak256(
    encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "address" },
        { type: "address" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "address" },
        { type: "bool" },
        { type: "bytes32" },
      ],
      [
        84_532n,
        input.exchange,
        input.stockToken,
        input.priceUsdcPerWholeToken,
        input.sourceRoundId,
        BigInt(input.sourceUpdatedAt),
        BigInt(input.sourceChainId),
        input.feedAddress,
        input.simulated,
        input.calldataHash,
      ],
    ),
  );

  return {
    version: 1,
    chainId: 84_532,
    exchange: input.exchange,
    calldata: input.calldata,
    value: "0",
    assetSymbol: input.assetSymbol,
    stockToken: input.stockToken,
    sourceRoundId: input.sourceRoundId.toString(),
    sourceUpdatedAt: input.sourceUpdatedAt,
    calldataHash: input.calldataHash,
    artifactHash,
    expectedEvent: "PriceSet",
    expectedObservation: {
      priceUsdcPerWholeToken: input.priceUsdcPerWholeToken.toString(),
      sourceRoundId: input.sourceRoundId.toString(),
      sourceUpdatedAt: input.sourceUpdatedAt,
      sourceChainId: input.sourceChainId,
      feedAddress: input.feedAddress,
      simulated: input.simulated,
    },
  };
}

export { PRICE_SET_EVENT_ABI };
