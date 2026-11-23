"use client";

import { toHex } from "viem";

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

export class WalletError extends Error {
  override readonly name = "WalletError";
}

export function provider(): EthereumProvider {
  if (typeof window === "undefined" || window.ethereum === undefined) {
    throw new WalletError("No injected wallet found. Install a wallet that supports Base Sepolia.");
  }
  return window.ethereum;
}

export function isBaseSepolia(chainId: number | null | undefined): boolean {
  return chainId === BASE_SEPOLIA_CHAIN_ID;
}

export async function getChainId(eth: EthereumProvider = provider()): Promise<number> {
  const value = await eth.request({ method: "eth_chainId" });
  const chainId = Number(value);
  if (!Number.isInteger(chainId) || chainId <= 0) {
    throw new WalletError("The wallet returned an invalid chain id.");
  }
  return chainId;
}

export async function connectWallet(): Promise<{ address: `0x${string}`; chainId: number }> {
  const eth = provider();
  const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
  const address = accounts[0];
  if (address === undefined) throw new WalletError("The wallet returned no account.");
  const chainId = await getChainId(eth);
  return { address: address as `0x${string}`, chainId };
}

/**
 * Verify or establish Base Sepolia. A wallet on another chain is asked to switch,
 * then offered the public Base Sepolia network if it has not been added yet.
 * This never sends a transaction.
 */
export async function ensureChain(rpcUrl: string = BASE_SEPOLIA_RPC_URL): Promise<number> {
  const eth = provider();
  const current = await getChainId(eth);
  if (isBaseSepolia(current)) return current;

  try {
    await eth.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: CHAIN_ID_HEX }],
    });
  } catch {
    await eth.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: CHAIN_ID_HEX,
          chainName: BASE_SEPOLIA_CHAIN_NAME,
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: [rpcUrl],
          blockExplorerUrls: [BASE_SEPOLIA_EXPLORER],
        },
      ],
    });
  }

  const after = await getChainId(eth);
  if (!isBaseSepolia(after)) {
    throw new WalletError(
      `This wallet is on chain ${after}. Switch to Base Sepolia (${BASE_SEPOLIA_CHAIN_ID}) to sign in.`,
    );
  }
  return after;
}

export async function signMessage(address: `0x${string}`, message: string): Promise<`0x${string}`> {
  const eth = provider();
  const signature = (await eth.request({
    method: "personal_sign",
    params: [toHex(message), address],
  })) as string;
  return signature as `0x${string}`;
}

export async function sendTransaction(input: {
  from: `0x${string}`;
  to: `0x${string}`;
  data: `0x${string}`;
  value?: string;
}): Promise<`0x${string}`> {
  const eth = provider();
  const hash = (await eth.request({
    method: "eth_sendTransaction",
    params: [
      {
        from: input.from,
        to: input.to,
        data: input.data,
        value: input.value ?? "0x0",
      },
    ],
  })) as string;
  return hash as `0x${string}`;
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
