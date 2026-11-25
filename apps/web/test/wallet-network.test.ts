import { describe, expect, it } from "vitest";

import {
  BASE_SEPOLIA_CHAIN_ID,
  BASE_SEPOLIA_NETWORK,
  CHAIN_ID_HEX,
  WalletError,
  ensureChain,
  getChainId,
  isBaseSepolia,
  isWalletNetwork,
  resolveWalletNetwork,
  walletErrorMessage,
  type EthereumProvider,
} from "../lib/wallet.js";
import type { EnvironmentInfo } from "../lib/market-types.js";

class FakeProvider implements EthereumProvider {
  chainId: unknown = CHAIN_ID_HEX;
  readonly calls: Array<{ method: string; params?: unknown[] | object }> = [];
  switchError: unknown = null;

  async request(args: { method: string; params?: unknown[] | object }): Promise<unknown> {
    this.calls.push(args);
    if (args.method === "eth_chainId") return this.chainId;
    if (args.method === "wallet_switchEthereumChain") {
      if (this.switchError !== null) throw this.switchError;
      this.chainId = CHAIN_ID_HEX;
      return null;
    }
    if (args.method === "wallet_addEthereumChain") {
      this.chainId = CHAIN_ID_HEX;
      return null;
    }
    throw new Error(`Unexpected provider method ${args.method}`);
  }
}

const baseEnvironment: EnvironmentInfo = {
  mode: "base-sepolia",
  simulated: false,
  chainId: 84_532,
  chainName: "Base Sepolia",
  walletRpcUrl: "https://sepolia.base.org",
  walletNetworkName: "Base Sepolia",
  contracts: "deployed",
  pricePublication: "configured",
  appVersion: "test",
  walletConnect: true,
};

describe("wallet network pure logic", () => {
  it("recognizes only the canonical Base Sepolia chain 84532", () => {
    expect(BASE_SEPOLIA_CHAIN_ID).toBe(84_532);
    expect(CHAIN_ID_HEX).toBe("0x14a34");
    expect(isBaseSepolia(84_532)).toBe(true);
    expect(isBaseSepolia(84_532n as unknown as number)).toBe(false);
    expect(isBaseSepolia(1)).toBe(false);
    expect(isBaseSepolia(null)).toBe(false);
    expect(isBaseSepolia(undefined)).toBe(false);
    expect(isWalletNetwork(84_532, BASE_SEPOLIA_NETWORK)).toBe(true);
    expect(isWalletNetwork(1, BASE_SEPOLIA_NETWORK)).toBe(false);
  });

  it("resolves local wallet RPC metadata without requiring optional API fields", () => {
    expect(resolveWalletNetwork(null)).toEqual(BASE_SEPOLIA_NETWORK);
    expect(resolveWalletNetwork(baseEnvironment)).toEqual(BASE_SEPOLIA_NETWORK);
    const local = {
      ...baseEnvironment,
      mode: "local-anvil",
      chainName: "Base Sepolia (KYROX local)",
      walletRpcUrl: "http://127.0.0.1:8545",
      walletNetworkName: "Base Sepolia (KYROX local)",
      walletNetwork: {
        chainId: 84_532,
        name: "Base Sepolia (KYROX local)",
        rpcUrl: "http://127.0.0.1:9999",
      },
    } as EnvironmentInfo;
    expect(resolveWalletNetwork(local)).toEqual({
      ...BASE_SEPOLIA_NETWORK,
      chainName: "Base Sepolia (KYROX local)",
      rpcUrl: "http://127.0.0.1:8545",
      explorerUrl: null,
    });
  });

  it("parses decimal and hex chain ids and rejects invalid values", async () => {
    const provider = new FakeProvider();
    expect(await getChainId(provider)).toBe(84_532);
    provider.chainId = "0x1";
    expect(await getChainId(provider)).toBe(1);
    for (const invalid of [undefined, null, "not-a-chain", 0, -1, 1.5]) {
      provider.chainId = invalid;
      await expect(getChainId(provider)).rejects.toBeInstanceOf(WalletError);
    }
  });

  it("does not request a switch when the wallet is already on Base Sepolia", async () => {
    const provider = new FakeProvider();
    expect(await ensureChain(BASE_SEPOLIA_NETWORK, provider)).toBe(84_532);
    expect(provider.calls.map((call) => call.method)).toEqual(["eth_chainId"]);
  });

  it("switches or adds Base Sepolia with canonical network metadata", async () => {
    const provider = new FakeProvider();
    provider.chainId = "0x1";
    expect(await ensureChain("http://127.0.0.1:8545", provider)).toBe(84_532);
    expect(provider.calls[1]).toEqual({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: CHAIN_ID_HEX }],
    });

    const missingNetwork = new FakeProvider();
    missingNetwork.chainId = "0x1";
    missingNetwork.switchError = { code: 4902 };
    expect(await ensureChain("http://127.0.0.1:8545", missingNetwork)).toBe(84_532);
    expect(missingNetwork.calls[2]).toEqual({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: CHAIN_ID_HEX,
          chainName: "Base Sepolia",
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: ["http://127.0.0.1:8545"],
          blockExplorerUrls: ["https://sepolia.basescan.org"],
        },
      ],
    });
  });

  it("does not add a chain after user rejection and fails clearly on a wrong chain", async () => {
    const rejected = new FakeProvider();
    rejected.chainId = "0x1";
    rejected.switchError = { code: 4001 };
    await expect(ensureChain(BASE_SEPOLIA_NETWORK, rejected)).rejects.toThrow(
      "Request rejected in the wallet.",
    );
    expect(rejected.calls.map((call) => call.method)).toEqual([
      "eth_chainId",
      "wallet_switchEthereumChain",
    ]);

    const stillWrong = new FakeProvider();
    stillWrong.chainId = "0x1";
    stillWrong.switchError = { code: 4902 };
    stillWrong.request = async (args) => {
      stillWrong.calls.push(args);
      if (args.method === "eth_chainId") return stillWrong.chainId;
      return null;
    };
    await expect(ensureChain(BASE_SEPOLIA_NETWORK, stillWrong)).rejects.toThrow(
      /Switch to Base Sepolia \(84532\) to continue/,
    );
    expect(walletErrorMessage({ code: 4080 })).toBe("Request rejected in the wallet.");
  });
});
