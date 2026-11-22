import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import {
  createPublicClient,
  createWalletClient,
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

import { migrate } from "drizzle-orm/node-postgres/migrator";
import { sql } from "drizzle-orm";

import { createDatabase } from "@kyrox/db";
import { parseDeploymentManifest } from "@kyrox/protocol";

import { createSepoliaVerificationClient } from "../src/feeds/viem-client.js";
import { DrizzleObservationStore } from "../src/persistence/drizzle-store.js";
import { verifyPublication } from "../src/verification/verify.js";
import type { ObservationInsert } from "../src/persistence/types.js";
import { prepareSetPricePublication } from "../src/publication/prepare.js";

const RUN = process.env["KYROX_PUBLICATION_E2E"] === "1";
const DATABASE_URL = process.env["KYROX_TEST_DATABASE_URL"] ?? "";
const ANVIL_BIN = process.env["ANVIL_BIN"] ?? `${process.env["HOME"] ?? ""}/.foundry/bin/anvil`;

const EXCHANGE_ROLE = keccak256(toHex("KYROX_EXCHANGE_ROLE"));
const PRICE_UPDATER_ROLE = keccak256(toHex("KYROX_PRICE_UPDATER_ROLE"));

const SET_PRICE_ABI = [
  {
    type: "function",
    name: "setPrice",
    stateMutability: "nonpayable",
    inputs: [
      { name: "stockToken", type: "address" },
      { name: "priceUsdcPerWholeToken", type: "uint256" },
      { name: "sourceRoundId", type: "uint256" },
      { name: "sourceUpdatedAt", type: "uint256" },
      { name: "sourceChainId", type: "uint256" },
      { name: "feedAddress", type: "address" },
      { name: "simulated", type: "bool" },
    ],
    outputs: [],
  },
] as const satisfies Abi;

const OBSERVATION_ABI = [
  {
    type: "function",
    name: "observation",
    stateMutability: "view",
    inputs: [{ name: "stockToken", type: "address" }],
    outputs: [
      { name: "priceUsdcPerWholeToken", type: "uint256" },
      { name: "sourceRoundId", type: "uint256" },
      { name: "sourceUpdatedAt", type: "uint64" },
      { name: "publishedAt", type: "uint64" },
      { name: "sourceChainId", type: "uint64" },
      { name: "feedAddress", type: "address" },
      { name: "simulated", type: "bool" },
    ],
  },
] as const satisfies Abi;

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

function assertLoopback(url: string): void {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1") {
    throw new Error(`Refusing non-loopback RPC endpoint: ${url}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe.skipIf(!RUN)("Anvil publication rehearsal", () => {
  it("prepares, executes, and reads back a simulated observation", async () => {
    const port = 19_000 + Math.floor(Math.random() * 1_000);
    const rpcUrl = `http://127.0.0.1:${port}`;
    assertLoopback(rpcUrl);

    if (DATABASE_URL.length === 0) {
      throw new Error("KYROX_TEST_DATABASE_URL is required: the rehearsal now uses PostgreSQL.");
    }

    const handle = createDatabase(DATABASE_URL);
    await migrate(handle.db, {
      migrationsFolder: fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url)),
    });
    await handle.db.execute(
      sql`TRUNCATE TABLE "price_observations", "price_ingestion_events", "price_publications" RESTART IDENTITY CASCADE`,
    );
    const store = new DrizzleObservationStore(handle.db);

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
      let ready = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        try {
          if ((await client.getChainId()) !== 84_532) throw new Error("wrong chain");
          ready = true;
          break;
        } catch {
          await sleep(100);
        }
      }
      expect(ready).toBe(true);

      const accounts = (await client.request({
        method: "eth_accounts",
      } as never)) as readonly Address[];
      const deployer = accounts[0] as Address;

      const usdcArtifact = artifact("TestUSDC");
      const stockArtifact = artifact("TestStock");
      const exchangeArtifact = artifact("KyroxExchange");

      async function deploy(art: Artifact, args: readonly unknown[]): Promise<Address> {
        const hash = await wallet.sendTransaction({
          account: deployer,
          data: encodeDeployData({ abi: art.abi, bytecode: art.bytecode.object, args }),
        });
        const receipt = await client.waitForTransactionReceipt({ hash });
        expect(receipt.status).toBe("success");
        if (receipt.contractAddress === null || receipt.contractAddress === undefined) {
          throw new Error("deployment failed");
        }
        return receipt.contractAddress;
      }

      async function send(to: Address, data: Hex) {
        const hash = await wallet.sendTransaction({ account: deployer, to, data });
        return client.waitForTransactionReceipt({ hash });
      }

      const usdc = await deploy(usdcArtifact, [deployer]);
      const stock = await deploy(stockArtifact, ["Test Apple", "tAAPL", 18, deployer]);
      const exchange = await deploy(exchangeArtifact, [usdc, deployer]);

      await send(
        usdc,
        encodeFunctionData({
          abi: usdcArtifact.abi,
          functionName: "grantRole",
          args: [EXCHANGE_ROLE, exchange],
        }),
      );
      await send(
        stock,
        encodeFunctionData({
          abi: stockArtifact.abi,
          functionName: "grantRole",
          args: [EXCHANGE_ROLE, exchange],
        }),
      );
      await send(
        exchange,
        encodeFunctionData({
          abi: exchangeArtifact.abi,
          functionName: "grantRole",
          args: [PRICE_UPDATER_ROLE, deployer],
        }),
      );
      await send(
        exchange,
        encodeFunctionData({
          abi: exchangeArtifact.abi,
          functionName: "listAsset",
          args: [stock, 3_600, 1n, 10n ** 30n],
        }),
      );

      const block = await client.getBlock();
      const nowSeconds = Number(block.timestamp);
      const zeroFeed = "0x0000000000000000000000000000000000000000" as const;

      const observation: ObservationInsert = {
        assetSymbol: "tAAPL",
        sourceChainId: 8_453,
        feedAddress: zeroFeed,
        rawAnswer: 23_000_000_000n, // 230.00000000 at 8 decimals
        feedDecimals: 8,
        sourceRoundId: 1n,
        sourceUpdatedAt: nowSeconds - 5,
        observedAt: nowSeconds,
        referencePriceUsdcPerWholeToken: 230_000_000n,
        sourceDescription: "Simulated local reference (not a Chainlink feed)",
        status: "valid",
      };

      const manifest = parseDeploymentManifest({
        chainId: 84_532,
        chain: "base-sepolia",
        environment: "local-anvil",
        status: "local-anvil",
        rpc: { url: rpcUrl },
        contracts: { KyroxExchange: { address: exchange } },
        assets: { tAAPL: { address: stock } },
        notes: ["LOCAL ANVIL ONLY — not a Base Sepolia deployment"],
      });

      await store.insertObservation(observation);
      const persisted = await store.latestValidObservation("tAAPL");
      expect(persisted).not.toBeNull();
      expect(persisted?.sourceRoundId).toBe(observation.sourceRoundId);
      expect(persisted?.sourceUpdatedAt).toBe(observation.sourceUpdatedAt);
      expect(persisted?.referencePriceUsdcPerWholeToken).toBe(
        observation.referencePriceUsdcPerWholeToken,
      );

      const prepared = await prepareSetPricePublication({
        observation: persisted as ObservationInsert,
        stockToken: stock,
        manifest,
        store,
        nowSeconds,
        simulated: true,
      });

      const decoded = decodeFunctionData({ abi: SET_PRICE_ABI, data: prepared.data });
      expect(decoded.functionName).toBe("setPrice");
      const args = decoded.args ?? [];
      expect(String(args[0]).toLowerCase()).toBe(stock.toLowerCase());
      expect(args.slice(1)).toEqual([
        observation.referencePriceUsdcPerWholeToken,
        observation.sourceRoundId,
        BigInt(observation.sourceUpdatedAt),
        8_453n,
        zeroFeed,
        true,
      ]);

      const receipt = await send(prepared.to, prepared.data);
      expect(receipt.status).toBe("success");

      const stored = (await client.readContract({
        address: exchange,
        abi: OBSERVATION_ABI,
        functionName: "observation",
        args: [stock],
      })) as readonly [bigint, bigint, bigint, bigint, bigint, Address, boolean];

      expect(stored[0]).toBe(observation.referencePriceUsdcPerWholeToken);
      expect(stored[1]).toBe(observation.sourceRoundId);
      expect(stored[2]).toBe(BigInt(observation.sourceUpdatedAt));
      expect(stored[3]).toBeGreaterThan(0n);
      expect(stored[4]).toBe(8_453n);
      expect(stored[5].toLowerCase()).toBe(zeroFeed);
      expect(stored[6]).toBe(true);

      expect(await store.isPublished("tAAPL", 1n)).toBe(true);
      expect(await store.latestPublishedRoundId("tAAPL")).toBe(1n);
      const rows = await handle.pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM price_publications`,
      );
      expect(rows.rows[0]?.count).toBe("1");

      // 13. Read-only verification of the executed publication.
      const verifier = createSepoliaVerificationClient(rpcUrl);
      const verification = await verifyPublication({
        assetSymbol: "tAAPL",
        sourceRoundId: 1n,
        txHash: receipt.transactionHash,
        manifest,
        store,
        rpc: verifier,
        minConfirmations: 1,
        mode: "local",
      });
      expect(verification.state).toBe("verified");
      expect(verification.failures).toEqual([]);
      expect((await store.getPublication("tAAPL", 1n))?.status).toBe("verified");

      const repeated = await verifyPublication({
        assetSymbol: "tAAPL",
        sourceRoundId: 1n,
        txHash: receipt.transactionHash,
        manifest,
        store,
        rpc: verifier,
        minConfirmations: 1,
        mode: "local",
      });
      expect(repeated.state).toBe("verified");
      expect((await store.getPublication("tAAPL", 1n))?.status).toBe("verified");

      const wrongDestinationRpc = {
        ...verifier,
        getTransactionReceipt: async (hash: `0x${string}`) => {
          const real = await verifier.getTransactionReceipt(hash);
          return real === null
            ? null
            : { ...real, to: "0x9999999999999999999999999999999999999999" as const };
        },
      };
      const mismatch = await verifyPublication({
        assetSymbol: "tAAPL",
        sourceRoundId: 1n,
        txHash: receipt.transactionHash,
        manifest,
        store,
        rpc: wrongDestinationRpc,
        minConfirmations: 1,
        mode: "local",
      });
      expect(mismatch.state).toBe("mismatch");
      expect((await store.getPublication("tAAPL", 1n))?.status).toBe("verified");

      // Confirmation thresholds are covered by the unit suite without
      // attempting an illegal verified->included transition.

      // Local-only manifest, never the Sepolia manifest.
      const manifestPath = fileURLToPath(
        new URL("../../../deployments/local-anvil.json", import.meta.url),
      );
      writeFileSync(
        manifestPath,
        `${JSON.stringify(
          {
            environment: "local-anvil",
            chainId: 84_532,
            chainIdNote: "84532 here is a local Anvil chain id, NOT a Base Sepolia deployment",
            rpc: { url: rpcUrl, loopback: true },
            deployedAt: new Date().toISOString(),
            contracts: {
              TestUSDC: usdc,
              TestStock: stock,
              KyroxExchange: exchange,
            },
            assets: { tAAPL: { address: stock } },
            observation: {
              assetSymbol: observation.assetSymbol,
              sourceChainId: observation.sourceChainId,
              feedAddress: observation.feedAddress,
              rawAnswer: observation.rawAnswer.toString(),
              feedDecimals: observation.feedDecimals,
              sourceRoundId: observation.sourceRoundId.toString(),
              sourceUpdatedAt: observation.sourceUpdatedAt,
              observedAt: observation.observedAt,
              referencePriceUsdcPerWholeToken:
                observation.referencePriceUsdcPerWholeToken?.toString() ?? null,
              simulated: true,
            },
          },
          null,
          2,
        )}\n`,
      );

      expect(JSON.parse(readFileSync(manifestPath, "utf8"))).toMatchObject({
        environment: "local-anvil",
        chainId: 84_532,
      });
    } finally {
      process.removeListener("exit", killOnExit);
      anvil.kill("SIGKILL");
      await new Promise<void>((resolve) => {
        if (anvil.exitCode !== null) resolve();
        else anvil.once("exit", () => resolve());
      });
      await handle.pool.end().catch(() => undefined);
    }
  }, 120_000);
});
