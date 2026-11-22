import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  decodeFunctionData,
  encodeDeployData,
  encodeFunctionData,
  http,
  keccak256,
  toHex,
  type Abi,
  type Address,
  type Hex,
} from "viem";

import {
  SECONDS_PER_UTC_DAY,
  TESTNET_TRADE_POLICY,
  createQuote,
  type AssetDefinition,
  type AssetFreshnessConfig,
  type PolicyContext,
  type PriceBounds,
  type PriceObservation,
} from "@kyrox/core";

import { prepareTradeIntent } from "../src/intent.js";

const RUN = process.env["KYROX_ANVIL_E2E"] === "1";
const ANVIL_BIN = process.env["ANVIL_BIN"] ?? `${process.env["HOME"] ?? ""}/.foundry/bin/anvil`;

const EXCHANGE_ROLE = keccak256(toHex("KYROX_EXCHANGE_ROLE"));
const PRICE_UPDATER_ROLE = keccak256(toHex("KYROX_PRICE_UPDATER_ROLE"));
const PAUSER_ROLE = keccak256(toHex("KYROX_PAUSER_ROLE"));

const PRICE = 230_000_000n;
const FRESHNESS: AssetFreshnessConfig = {
  assetSymbol: "tAAPL",
  maxSourceAgeSeconds: 3_600,
  requireOpenMarket: false,
};
const BOUNDS: PriceBounds = {
  minPriceUsdcPerWholeToken: 1n,
  maxPriceUsdcPerWholeToken: 10n ** 12n,
};

interface Artifact {
  readonly abi: Abi;
  readonly bytecode: { readonly object: Hex };
}

function artifact(name: string): Artifact {
  const path = fileURLToPath(
    new URL(`../../../packages/contracts/out/${name}.sol/${name}.json`, import.meta.url),
  );
  return JSON.parse(readFileSync(path, "utf8")) as Artifact;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe.skipIf(!RUN)("Anvil end-to-end trading path", () => {
  it("runs the complete lifecycle on an isolated local chain", async () => {
    const port = 18_000 + Math.floor(Math.random() * 1_000);
    const rpcUrl = `http://127.0.0.1:${port}`;

    const anvil: ChildProcess = spawn(
      ANVIL_BIN,
      ["--port", String(port), "--chain-id", "84532", "--silent"],
      { stdio: ["ignore", "pipe", "pipe"] },
    );

    const killOnExit = () => {
      anvil.kill("SIGKILL");
    };
    process.once("exit", killOnExit);

    const chain = {
      id: 84_532,
      name: "Anvil Base Sepolia",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
    } as const;
    const client = createPublicClient({ chain, transport: http(rpcUrl) });
    const wallet = createWalletClient({ chain, transport: http(rpcUrl) });

    try {
      // Wait for the local node, never a public endpoint.
      let ready = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        try {
          const id = await client.getChainId();
          if (id !== 84_532) throw new Error(`unexpected local chain id ${id}`);
          ready = true;
          break;
        } catch {
          await sleep(100);
        }
      }
      expect(ready).toBe(true);
      expect(rpcUrl.startsWith("http://127.0.0.1:")).toBe(true);
      expect(await client.getChainId()).toBe(84_532);

      const accounts = (await client.request({
        method: "eth_accounts",
      } as never)) as readonly Address[];
      const deployer = accounts[0] as Address;
      const alice = accounts[1] as Address;

      const usdcArtifact = artifact("TestUSDC");
      const stockArtifact = artifact("TestStock");
      const exchangeArtifact = artifact("KyroxExchange");

      async function deploy(
        art: Artifact,
        args: readonly unknown[],
        account: Address = deployer,
      ): Promise<Address> {
        const hash = await wallet.sendTransaction({
          account,
          data: encodeDeployData({ abi: art.abi, bytecode: art.bytecode.object, args }),
        });
        const receipt = await client.waitForTransactionReceipt({ hash });
        expect(receipt.status).toBe("success");
        if (receipt.contractAddress === null || receipt.contractAddress === undefined) {
          throw new Error("deployment failed");
        }
        return receipt.contractAddress;
      }

      async function send(account: Address, to: Address, data: Hex) {
        const hash = await wallet.sendTransaction({ account, to, data });
        return client.waitForTransactionReceipt({ hash });
      }

      async function expectRevert(account: Address, to: Address, data: Hex) {
        const response = await fetch(rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "eth_call",
            params: [{ from: account, to, data }, "latest"],
          }),
          signal: AbortSignal.timeout(10_000),
        });
        const body = (await response.json()) as { error?: unknown; result?: unknown };
        expect(body.error).toBeTruthy();
        expect(body.result).toBeUndefined();
      }

      async function call(
        to: Address,
        art: Artifact,
        functionName: string,
        args: readonly unknown[],
      ) {
        return client.readContract({
          address: to,
          abi: art.abi,
          functionName,
          args,
        } as never);
      }

      const usdc = await deploy(usdcArtifact, [deployer]);
      const stock = await deploy(stockArtifact, ["Test Apple", "tAAPL", 18, deployer]);
      const exchange = await deploy(exchangeArtifact, [usdc, deployer]);

      // Roles and asset configuration.
      await send(
        deployer,
        usdc,
        encodeFunctionData({
          abi: usdcArtifact.abi,
          functionName: "grantRole",
          args: [EXCHANGE_ROLE, exchange],
        }),
      );
      await send(
        deployer,
        stock,
        encodeFunctionData({
          abi: stockArtifact.abi,
          functionName: "grantRole",
          args: [EXCHANGE_ROLE, exchange],
        }),
      );
      await send(
        deployer,
        exchange,
        encodeFunctionData({
          abi: exchangeArtifact.abi,
          functionName: "grantRole",
          args: [PRICE_UPDATER_ROLE, deployer],
        }),
      );
      await send(
        deployer,
        exchange,
        encodeFunctionData({
          abi: exchangeArtifact.abi,
          functionName: "grantRole",
          args: [PAUSER_ROLE, deployer],
        }),
      );
      await send(
        deployer,
        exchange,
        encodeFunctionData({
          abi: exchangeArtifact.abi,
          functionName: "listAsset",
          args: [stock, 3_600, 1n, 10n ** 30n],
        }),
      );

      const block = await client.getBlock();
      const observedAt = Number(block.timestamp);

      // 3. Publish a mock reference observation (explicitly simulated).
      await send(
        deployer,
        exchange,
        encodeFunctionData({
          abi: exchangeArtifact.abi,
          functionName: "setPrice",
          args: [
            stock,
            PRICE,
            1n,
            BigInt(observedAt - 5),
            8_453,
            "0x0000000000000000000000000000000000000000",
            true,
          ],
        }),
      );

      // 4. Fund the disposable local account.
      await send(
        alice,
        usdc,
        encodeFunctionData({ abi: usdcArtifact.abi, functionName: "claimWelcome" }),
      );
      await send(
        alice,
        usdc,
        encodeFunctionData({
          abi: usdcArtifact.abi,
          functionName: "approve",
          args: [exchange, 2n ** 256n - 1n],
        }),
      );

      const asset: AssetDefinition = {
        symbol: "tAAPL",
        name: "Test Apple",
        stockToken: stock,
        stockDecimals: 18,
        priceSourceKind: "simulated",
        listed: true,
      };
      const observation: PriceObservation = {
        assetSymbol: "tAAPL",
        priceUsdcPerWholeToken: PRICE,
        sourceRoundId: 1n,
        sourceUpdatedAt: observedAt - 5,
        observedAt,
        sourceChainId: 8_453,
        feedAddress: null,
        sourceKind: "simulated",
      };

      function context(nowSeconds: number): PolicyContext {
        return {
          nowSeconds,
          utcDay: Math.floor(nowSeconds / SECONDS_PER_UTC_DAY),
          dailySpentUsdc: 0n,
          exchangePaused: false,
          assetEnabled: true,
          session: "open",
          freshness: FRESHNESS,
          priceBounds: BOUNDS,
        };
      }

      function quote(nowSeconds: number, side: "buy" | "sell", amountIn: bigint) {
        return createQuote(
          { assetSymbol: "tAAPL", side, amountIn, maxSlippageBps: 10 },
          asset,
          observation,
          {
            nowSeconds,
            chainId: 84_532,
            freshnessConfig: FRESHNESS,
            session: "open",
            priceBounds: BOUNDS,
            quoteTtlSeconds: 600,
          },
        );
      }

      const reader = {
        getChainId: () => client.getChainId(),
        getTokenDecimals: async (token: Address) =>
          (await call(token, stockArtifact, "decimals", [])) as number,
      };

      // 5-6. Prepare the buy intent and verify the exact unsigned calldata.
      const buyTimestamp = Number((await client.getBlock()).timestamp);
      const buyQuote = quote(buyTimestamp, "buy", 230_000_000n);
      const buyIntent = await prepareTradeIntent({
        quote: buyQuote,
        observation,
        request: {
          assetSymbol: "tAAPL",
          side: "buy",
          amountIn: 230_000_000n,
          maxSlippageBps: 10,
        },
        asset,
        trader: alice,
        exchange,
        deadline: buyTimestamp + 120,
        nowSeconds: buyTimestamp,
        policyConfig: TESTNET_TRADE_POLICY,
        policyContext: context(buyTimestamp),
        reader,
      });

      expect(buyIntent.to).toBe(exchange);
      const decodedBuy = decodeFunctionData({
        abi: exchangeArtifact.abi,
        data: buyIntent.data,
      });
      expect(decodedBuy.functionName).toBe("buy");
      const buyArgs = decodedBuy.args ?? [];
      expect(String(buyArgs[0]).toLowerCase()).toBe(stock.toLowerCase());
      expect(buyArgs.slice(1)).toEqual([
        230_000_000n,
        buyQuote.minAmountOut,
        BigInt(buyTimestamp + 120),
      ]);
      expect(buyQuote.amountOut).toBe(1_000_000_000_000_000_000n);

      // 7. Execute the buy from the disposable local account.
      const buyReceipt = await send(alice, buyIntent.to, buyIntent.data);
      expect(buyReceipt.status).toBe("success");

      expect(await call(stock, stockArtifact, "balanceOf", [alice])).toBe(buyQuote.amountOut);
      expect(await call(usdc, usdcArtifact, "balanceOf", [alice])).toBe(770_000_000n);

      const tradeLog = buyReceipt.logs
        .filter((log) => log.address.toLowerCase() === exchange.toLowerCase())
        .map((log) => {
          try {
            return decodeEventLog({
              abi: exchangeArtifact.abi,
              data: log.data,
              topics: log.topics,
            });
          } catch {
            return null;
          }
        })
        .find((decoded) => decoded?.eventName === "Trade");
      expect(tradeLog?.eventName).toBe("Trade");

      await send(
        alice,
        stock,
        encodeFunctionData({
          abi: stockArtifact.abi,
          functionName: "approve",
          args: [exchange, 2n ** 256n - 1n],
        }),
      );
      // 8-9. Sell half and verify settlement and rounding.
      const sellTimestamp = Number((await client.getBlock()).timestamp);
      const sellAmount = buyQuote.amountOut / 2n;
      const sellQuote = quote(sellTimestamp, "sell", sellAmount);
      const sellIntent = await prepareTradeIntent({
        quote: sellQuote,
        observation,
        request: {
          assetSymbol: "tAAPL",
          side: "sell",
          amountIn: sellAmount,
          maxSlippageBps: 10,
        },
        asset,
        trader: alice,
        exchange,
        deadline: sellTimestamp + 120,
        nowSeconds: sellTimestamp,
        policyConfig: TESTNET_TRADE_POLICY,
        policyContext: context(sellTimestamp),
        reader,
      });
      const sellReceipt = await send(alice, sellIntent.to, sellIntent.data);
      expect(sellReceipt.status).toBe("success");
      expect(sellQuote.amountOut).toBe(115_000_000n);
      expect(await call(usdc, usdcArtifact, "balanceOf", [alice])).toBe(885_000_000n);
      expect(await call(stock, stockArtifact, "balanceOf", [alice])).toBe(sellAmount);

      // 10. Minimum output rejection.
      const tooHigh = 1_000_000_000_000_000_001n;
      const farDeadline = 18_446_744_073_709_551_615n;
      await expectRevert(
        alice,
        exchange,
        encodeFunctionData({
          abi: exchangeArtifact.abi,
          functionName: "buy",
          args: [stock, 1_000_000n, tooHigh, farDeadline],
        }),
      );

      // 11. Expired deadline rejection.
      await expectRevert(
        alice,
        exchange,
        encodeFunctionData({
          abi: exchangeArtifact.abi,
          functionName: "buy",
          args: [stock, 1_000_000n, 0n, 1n],
        }),
      );

      // 12. Pause blocks trading, then unpause restores it.
      await send(
        deployer,
        exchange,
        encodeFunctionData({ abi: exchangeArtifact.abi, functionName: "pause" }),
      );
      await expectRevert(
        alice,
        exchange,
        encodeFunctionData({
          abi: exchangeArtifact.abi,
          functionName: "buy",
          args: [stock, 1_000_000n, 0n, farDeadline],
        }),
      );

      await send(
        deployer,
        exchange,
        encodeFunctionData({ abi: exchangeArtifact.abi, functionName: "unpause" }),
      );

      // 13. Stale observation rejection after the freshness window.
      await client.request({ method: "evm_increaseTime", params: [3_700] } as never);
      await client.request({ method: "evm_mine", params: [] } as never);
      await expectRevert(
        alice,
        exchange,
        encodeFunctionData({
          abi: exchangeArtifact.abi,
          functionName: "buy",
          args: [stock, 1_000_000n, 0n, farDeadline],
        }),
      );

      // The local configuration never points at a remote RPC.
      expect(rpcUrl).toContain("127.0.0.1");
    } finally {
      process.removeListener("exit", killOnExit);
      anvil.kill("SIGKILL");
      await new Promise<void>((resolve) => {
        if (anvil.exitCode !== null) resolve();
        else anvil.once("exit", () => resolve());
      });
    }
  }, 120_000);
});
