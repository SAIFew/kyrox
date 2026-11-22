import { createPublicClient, http } from "viem";

import type { ChainIdentityProvider } from "./chain-identity.js";

/** Read-only viem adapter for chain identity checks. */
export function createViemChainIdentityProvider(
  name: string,
  rpcUrl: string,
): ChainIdentityProvider {
  const client = createPublicClient({
    chain: {
      id: 84_532,
      name: "Base Sepolia",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
    },
    transport: http(rpcUrl, { timeout: 20_000, retryCount: 1 }),
  });

  return {
    name,
    rpc: {
      getChainId: () => client.getChainId(),
      getBlockHash: async (blockNumber) => {
        const block = await client.getBlock({ blockNumber });
        if (block.hash === null) throw new Error(`Block ${blockNumber} has no hash.`);
        return block.hash;
      },
    },
  };
}
