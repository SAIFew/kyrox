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

export async function connectWallet(): Promise<{ address: `0x${string}`; chainId: number }> {
  const eth = provider();
  const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
  const address = accounts[0];
  if (address === undefined) throw new WalletError("The wallet returned no account.");
  const chainId = Number(await eth.request({ method: "eth_chainId" }));
  return { address: address as `0x${string}`, chainId };
}

export async function ensureChain(rpcUrl: string): Promise<void> {
  const eth = provider();
  const current = Number(await eth.request({ method: "eth_chainId" }));
  if (current === 84_532) return;
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
          chainName: "Base Sepolia (KYROX local)",
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: [rpcUrl],
        },
      ],
    });
  }
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
