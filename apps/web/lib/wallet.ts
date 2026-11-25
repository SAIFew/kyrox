"use client";

import { decodeFunctionResult, encodeFunctionData, isAddress, isHex, toHex } from "viem";

import type { EnvironmentInfo } from "./market-types";

export interface EthereumProvider {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
  on?(event: string, handler: (...args: unknown[]) => void): void;
  removeListener?(event: string, handler: (...args: unknown[]) => void): void;
}

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

export const BASE_SEPOLIA_CHAIN_ID = 84_532;
export const BASE_SEPOLIA_CHAIN_NAME = "Base Sepolia";
export const BASE_SEPOLIA_RPC_URL = "https://sepolia.base.org";
export const BASE_SEPOLIA_EXPLORER = "https://sepolia.basescan.org";
export const CHAIN_ID_HEX = "0x14a34";

export interface WalletNetwork {
  readonly chainId: number;
  readonly chainName: string;
  readonly rpcUrl: string;
  readonly explorerUrl: string | null;
  readonly nativeCurrency: {
    readonly name: string;
    readonly symbol: string;
    readonly decimals: number;
  };
}

export const BASE_SEPOLIA_NETWORK: WalletNetwork = {
  chainId: BASE_SEPOLIA_CHAIN_ID,
  chainName: BASE_SEPOLIA_CHAIN_NAME,
  rpcUrl: BASE_SEPOLIA_RPC_URL,
  explorerUrl: BASE_SEPOLIA_EXPLORER,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
};

export class WalletError extends Error {
  override readonly name = "WalletError";
}

type EnvironmentWithWalletFields = EnvironmentInfo & {
  readonly walletRpcUrl?: unknown;
  readonly walletNetworkName?: unknown;
  readonly walletNetwork?: unknown;
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function positiveInteger(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/** Resolve the wallet's target network without assuming Agent 2's optional fields exist yet. */
export function resolveWalletNetwork(
  environment: EnvironmentInfo | null | undefined,
): WalletNetwork {
  const source = environment as EnvironmentWithWalletFields | null | undefined;
  const walletNetwork = record(source?.walletNetwork);
  const chainId =
    positiveInteger(walletNetwork?.["chainId"]) ??
    positiveInteger(source?.chainId) ??
    BASE_SEPOLIA_CHAIN_ID;
  const local = environment?.mode === "local-anvil";
  const currency = record(walletNetwork?.["nativeCurrency"]);
  const currencyDecimals = positiveInteger(currency?.["decimals"]);

  return {
    chainId,
    chainName:
      nonEmptyString(source?.walletNetworkName) ??
      nonEmptyString(walletNetwork?.["name"]) ??
      nonEmptyString(walletNetwork?.["chainName"]) ??
      nonEmptyString(environment?.chainName) ??
      (local ? "Base Sepolia (local Anvil)" : BASE_SEPOLIA_CHAIN_NAME),
    rpcUrl:
      nonEmptyString(source?.walletRpcUrl) ??
      nonEmptyString(walletNetwork?.["rpcUrl"]) ??
      BASE_SEPOLIA_RPC_URL,
    explorerUrl:
      nonEmptyString(walletNetwork?.["explorerUrl"]) ??
      nonEmptyString(walletNetwork?.["blockExplorerUrl"]) ??
      (local ? null : BASE_SEPOLIA_EXPLORER),
    nativeCurrency: {
      name: nonEmptyString(currency?.["name"]) ?? "Ether",
      symbol: nonEmptyString(currency?.["symbol"]) ?? "ETH",
      decimals: currencyDecimals ?? 18,
    },
  };
}

export function provider(): EthereumProvider {
  if (typeof window === "undefined" || window.ethereum === undefined) {
    throw new WalletError("No injected wallet found. Install a wallet that supports this testnet.");
  }
  return window.ethereum;
}

export function isBaseSepolia(chainId: number | null | undefined): boolean {
  return chainId === BASE_SEPOLIA_CHAIN_ID;
}

export function isWalletNetwork(
  chainId: number | null | undefined,
  network: WalletNetwork,
): boolean {
  return chainId === network.chainId;
}

export async function getChainId(eth: EthereumProvider = provider()): Promise<number> {
  const value = await eth.request({ method: "eth_chainId" });
  const chainId = Number(value);
  if (!Number.isInteger(chainId) || chainId <= 0) {
    throw new WalletError("The wallet returned an invalid chain id.");
  }
  return chainId;
}

function errorCode(error: unknown): number | null {
  const source = record(error);
  if (source === null) return null;
  const direct = positiveInteger(source["code"]);
  if (direct !== null) return direct;
  const data = record(source["data"]);
  const nested = positiveInteger(data?.["code"]);
  if (nested !== null) return nested;
  const cause = record(source["error"]);
  return cause === null ? null : errorCode(cause);
}

export function walletErrorMessage(error: unknown): string {
  const code = errorCode(error);
  if (code === 4001 || code === 4080) return "Request rejected in the wallet.";
  if (error instanceof WalletError || error instanceof Error) return error.message;
  return "The wallet request failed.";
}

function walletRequestError(error: unknown, fallback: string): WalletError {
  if (error instanceof WalletError) return error;
  return new WalletError(
    walletErrorMessage(error) === "The wallet request failed."
      ? fallback
      : walletErrorMessage(error),
  );
}

function accountsFrom(value: unknown): `0x${string}`[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is `0x${string}` => typeof entry === "string" && isAddress(entry),
  );
}

export async function getActiveAccount(
  eth: EthereumProvider = provider(),
): Promise<`0x${string}` | null> {
  return accountsFrom(await eth.request({ method: "eth_accounts" }))[0] ?? null;
}

export async function connectWallet(): Promise<{ address: `0x${string}`; chainId: number }> {
  const eth = provider();
  const accounts = accountsFrom(await eth.request({ method: "eth_requestAccounts" }));
  const address = accounts[0];
  if (address === undefined) throw new WalletError("The wallet returned no account.");
  const chainId = await getChainId(eth);
  return { address, chainId };
}

export async function assertActiveAccount(
  expected: `0x${string}`,
  eth: EthereumProvider = provider(),
): Promise<`0x${string}`> {
  const active = await getActiveAccount(eth);
  if (active === null) {
    throw new WalletError("No active wallet account was found. Reconnect the signed-in wallet.");
  }
  if (active.toLowerCase() !== expected.toLowerCase()) {
    throw new WalletError(
      "The active wallet account does not match the signed-in account. Reconnect before sending.",
    );
  }
  return active;
}

/**
 * Verify or establish the environment's wallet network. A missing chain is added only
 * for the wallet's explicit unknown-chain (4902) response, never after user rejection.
 * This never sends a transaction.
 */
export async function ensureChain(
  network: WalletNetwork | string = BASE_SEPOLIA_NETWORK,
  eth: EthereumProvider = provider(),
): Promise<number> {
  const target: WalletNetwork =
    typeof network === "string" ? { ...BASE_SEPOLIA_NETWORK, rpcUrl: network } : network;
  const current = await getChainId(eth);
  if (isWalletNetwork(current, target)) return current;

  try {
    await eth.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: toHex(target.chainId) }],
    });
  } catch (error) {
    if (errorCode(error) !== 4902) {
      throw walletRequestError(error, `Could not switch to ${target.chainName}.`);
    }
    try {
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: toHex(target.chainId),
            chainName: target.chainName,
            nativeCurrency: target.nativeCurrency,
            rpcUrls: [target.rpcUrl],
            ...(target.explorerUrl === null ? {} : { blockExplorerUrls: [target.explorerUrl] }),
          },
        ],
      });
    } catch (addError) {
      throw walletRequestError(addError, `Could not add ${target.chainName} to the wallet.`);
    }
  }

  const after = await getChainId(eth);
  if (!isWalletNetwork(after, target)) {
    throw new WalletError(
      `This wallet is on chain ${after}. Switch to ${target.chainName} (${target.chainId}) to continue.`,
    );
  }
  return after;
}

/** Recheck both account and chain immediately before a transaction request. */
export async function verifyTransactionContext(
  expected: `0x${string}`,
  network: WalletNetwork,
  eth: EthereumProvider = provider(),
): Promise<void> {
  await assertActiveAccount(expected, eth);
  await ensureChain(network, eth);
  await assertActiveAccount(expected, eth);
}

export async function signMessage(address: `0x${string}`, message: string): Promise<`0x${string}`> {
  const eth = provider();
  try {
    const signature = await eth.request({
      method: "personal_sign",
      params: [toHex(message), address],
    });
    if (typeof signature !== "string" || !isHex(signature)) {
      throw new WalletError("The wallet returned an invalid signature.");
    }
    return signature as `0x${string}`;
  } catch (error) {
    throw walletRequestError(error, "The wallet could not sign this message.");
  }
}

function transactionValue(value: string | undefined): `0x${string}` {
  if (value === undefined) return "0x0";
  const trimmed = value.trim();
  if (!/^(?:0x[0-9a-fA-F]+|\d+)$/.test(trimmed)) {
    throw new WalletError("The prepared transaction has an invalid value.");
  }
  const parsed = BigInt(trimmed);
  if (parsed < 0n) throw new WalletError("The prepared transaction has a negative value.");
  return toHex(parsed);
}

export async function sendTransaction(input: {
  from: `0x${string}`;
  to: `0x${string}`;
  data: `0x${string}`;
  value?: string;
  network: WalletNetwork;
}): Promise<`0x${string}`> {
  const eth = provider();
  if (!isAddress(input.to))
    throw new WalletError("The prepared transaction destination is invalid.");
  if (!isHex(input.data)) throw new WalletError("The prepared transaction data is invalid.");
  await verifyTransactionContext(input.from, input.network, eth);
  try {
    const hash = await eth.request({
      method: "eth_sendTransaction",
      params: [
        {
          from: input.from,
          to: input.to,
          data: input.data,
          value: transactionValue(input.value),
        },
      ],
    });
    if (typeof hash !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(hash)) {
      throw new WalletError("The wallet returned an invalid transaction hash.");
    }
    return hash as `0x${string}`;
  } catch (error) {
    throw walletRequestError(error, "The wallet could not send this transaction.");
  }
}

const ERC20_ALLOWANCE_ABI = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "value", type: "uint256" }],
  },
] as const;

export async function readErc20Allowance(input: {
  token: `0x${string}`;
  owner: `0x${string}`;
  spender: `0x${string}`;
  eth?: EthereumProvider;
}): Promise<bigint> {
  const eth = input.eth ?? provider();
  try {
    const result = await eth.request({
      method: "eth_call",
      params: [
        {
          to: input.token,
          data: encodeFunctionData({
            abi: ERC20_ALLOWANCE_ABI,
            functionName: "allowance",
            args: [input.owner, input.spender],
          }),
        },
        "latest",
      ],
    });
    if (typeof result !== "string" || !isHex(result)) {
      throw new WalletError("The wallet returned an invalid token allowance.");
    }
    const decoded = decodeFunctionResult({
      abi: ERC20_ALLOWANCE_ABI,
      functionName: "allowance",
      data: result,
    });
    if (typeof decoded !== "bigint") {
      throw new WalletError("The wallet returned an invalid token allowance.");
    }
    return decoded;
  } catch (error) {
    throw walletRequestError(error, "Could not verify the token allowance.");
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

/** Wait for a successful mined receipt. Pending or unverifiable receipts fail closed. */
export async function waitForTransactionReceipt(
  hash: `0x${string}`,
  options: {
    timeoutMs?: number;
    intervalMs?: number;
    eth?: EthereumProvider;
  } = {},
): Promise<void> {
  const eth = options.eth ?? provider();
  const timeoutMs = options.timeoutMs ?? 180_000;
  const intervalMs = options.intervalMs ?? 1_500;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    let receipt: unknown;
    try {
      receipt = await eth.request({ method: "eth_getTransactionReceipt", params: [hash] });
    } catch (error) {
      throw walletRequestError(error, "Could not retrieve the transaction receipt.");
    }
    if (receipt !== null && receipt !== undefined) {
      const row = record(receipt);
      const status = row?.["status"];
      if (status === "0x0" || status === 0 || status === "0x00") {
        throw new WalletError("The transaction reverted.");
      }
      if (status === "0x1" || status === 1 || status === "0x01") return;
      throw new WalletError("The transaction receipt did not confirm success.");
    }
    await delay(intervalMs);
  }
  throw new WalletError("The transaction is still pending. Check the wallet before retrying.");
}

/** Best-effort wallet disconnect. Not every wallet implements this method. */
export async function revokeWalletPermissions(): Promise<void> {
  if (typeof window === "undefined" || window.ethereum === undefined) return;
  try {
    await window.ethereum.request({
      method: "wallet_revokePermissions",
      params: [{ eth_accounts: {} }],
    });
  } catch {
    // The app session is cleared regardless; this only detaches the provider.
  }
}
