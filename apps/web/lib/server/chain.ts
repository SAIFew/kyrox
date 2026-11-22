import { createPublicClient, http } from "viem";

import type { RuntimeEnvironment } from "./env.js";

export const ERC20_ABI = [
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
] as const;

export const EXCHANGE_VIEWS_ABI = [
  {
    type: "function",
    name: "paused",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "assetSettings",
    stateMutability: "view",
    inputs: [{ name: "stockToken", type: "address" }],
    outputs: [
      { name: "listed", type: "bool" },
      { name: "stockDecimals", type: "uint8" },
      { name: "maxSourceAgeSeconds", type: "uint32" },
      { name: "maxPriceDeviationBps", type: "uint16" },
      { name: "minPriceUsdcPerWholeToken", type: "uint256" },
      { name: "maxPriceUsdcPerWholeToken", type: "uint256" },
    ],
  },
] as const;

export const TRADE_EVENT_ABI = [
  {
    type: "event",
    name: "Trade",
    inputs: [
      { name: "trader", type: "address", indexed: true },
      { name: "stockToken", type: "address", indexed: true },
      { name: "isBuy", type: "bool", indexed: true },
      { name: "usdcAmount", type: "uint256", indexed: false },
      { name: "stockAmount", type: "uint256", indexed: false },
      { name: "priceUsdcPerWholeToken", type: "uint256", indexed: false },
      { name: "sourceRoundId", type: "uint256", indexed: false },
      { name: "sourceUpdatedAt", type: "uint256", indexed: false },
    ],
  },
] as const;

export function createChainClient(env: RuntimeEnvironment) {
  return createPublicClient({
    chain: {
      id: 84_532,
      name: "Base Sepolia",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [env.rpcUrl] } },
    },
    transport: http(env.rpcUrl, { timeout: 15_000, retryCount: 1 }),
  });
}

export type ChainClient = ReturnType<typeof createChainClient>;
