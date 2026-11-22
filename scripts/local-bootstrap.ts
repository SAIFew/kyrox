import { readFileSync, writeFileSync } from "node:fs";

import {
  createPublicClient,
  createWalletClient,
  encodeDeployData,
  encodeFunctionData,
  http,
  keccak256,
  toHex,
  type Abi,
  type Address,
  type Hex,
} from "viem";

import { createDatabase } from "@kyrox/db";
import { DrizzleObservationStore } from "@kyrox/price";

const RPC = process.env["BASE_SEPOLIA_RPC_URL"] ?? "http://127.0.0.1:8545";
const DATABASE_URL = process.env["DATABASE_URL"] ?? "";
const MANIFEST = process.env["KYROX_DEPLOYMENT_MANIFEST"] ?? "deployments/local-anvil.json";

const ASSETS = [
  { symbol: "tAAPL", name: "Test Apple", price: 345_297_696n },
  { symbol: "tTSLA", name: "Test Tesla", price: 350_450_000n },
  { symbol: "tNVDA", name: "Test NVIDIA", price: 129_824_800n },
];

function artifact(name: string): { abi: Abi; bytecode: Hex } {
  const raw = JSON.parse(
    readFileSync(`packages/contracts/out/${name}.sol/${name}.json`, "utf8"),
  ) as { abi: Abi; bytecode: { object: Hex } };
  return { abi: raw.abi, bytecode: raw.bytecode.object };
}

async function main() {
  if (!/^http:\/\/127\.0\.0\.1:/.test(RPC))
    throw new Error("Local bootstrap requires loopback RPC.");
  if (DATABASE_URL.length === 0) throw new Error("DATABASE_URL is required.");

  const chain = {
    id: 84_532,
    name: "Base Sepolia",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [RPC] } },
  } as const;
  const publicClient = createPublicClient({ chain, transport: http(RPC) });
  const wallet = createWalletClient({ chain, transport: http(RPC) });
  const chainId = await publicClient.getChainId();
  if (chainId !== 84_532) throw new Error(`Anvil must run with chain id 84532 (got ${chainId}).`);

  const accounts = (await publicClient.request({ method: "eth_accounts" } as never)) as Address[];
  const deployer = accounts[0];
  if (!deployer) throw new Error("Anvil returned no account.");

  async function deploy(name: string, args: readonly unknown[]) {
    const art = artifact(name);
    const hash = await wallet.sendTransaction({
      account: deployer,
      data: encodeDeployData({ abi: art.abi, bytecode: art.bytecode, args }),
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success" || !receipt.contractAddress)
      throw new Error(`${name} deployment failed.`);
    return receipt.contractAddress;
  }
  function callData(abi: Abi, functionName: string, args: readonly unknown[]): Hex {
    return encodeFunctionData({ abi, functionName, args });
  }
  async function call(to: Address, data: Hex) {
    const hash = await wallet.sendTransaction({ account: deployer, to, data });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error("transaction failed");
    return receipt;
  }

  const usdc = await deploy("TestUSDC", [deployer]);
  const stocks: Record<string, Address> = {};
  const stockArtifacts: Record<string, Abi> = {};
  for (const asset of ASSETS) {
    const address = await deploy("TestStock", [asset.name, asset.symbol, 18, deployer]);
    stocks[asset.symbol] = address;
    stockArtifacts[asset.symbol] = artifact("TestStock").abi;
  }
  const exchange = await deploy("KyroxExchange", [usdc, deployer]);

  const usdcAbi = artifact("TestUSDC").abi;
  const exchangeAbi = artifact("KyroxExchange").abi;
  const role = keccak256(toHex("KYROX_EXCHANGE_ROLE"));
  const updaterRole = keccak256(toHex("KYROX_PRICE_UPDATER_ROLE"));
  const pauserRole = keccak256(toHex("KYROX_PAUSER_ROLE"));

  await call(usdc, callData(usdcAbi, "grantRole", [role, exchange]));
  for (const asset of ASSETS) {
    await call(
      stocks[asset.symbol],
      callData(stockArtifacts[asset.symbol], "grantRole", [role, exchange]),
    );
  }
  await call(exchange, callData(exchangeAbi, "grantRole", [updaterRole, deployer]));
  await call(exchange, callData(exchangeAbi, "grantRole", [pauserRole, deployer]));

  for (const asset of ASSETS) {
    await call(
      exchange,
      callData(exchangeAbi, "listAsset", [stocks[asset.symbol], 3_600, 1n, 10n ** 12n]),
    );
    await call(
      exchange,
      callData(exchangeAbi, "setPriceBounds", [stocks[asset.symbol], 1n, 10n ** 12n, 500]),
    );
  }

  const now = Math.floor(Date.now() / 1000);
  for (const [index, asset] of ASSETS.entries()) {
    await call(
      exchange,
      callData(exchangeAbi, "setPrice", [
        stocks[asset.symbol],
        asset.price,
        BigInt(index + 1),
        BigInt(now - 5),
        8_453n,
        "0x0000000000000000000000000000000000000000",
        true,
      ]),
    );
  }

  const db = createDatabase(DATABASE_URL);
  const store = new DrizzleObservationStore(db.db);
  for (const [index, asset] of ASSETS.entries()) {
    const result = await store.insertObservation({
      assetSymbol: asset.symbol,
      sourceChainId: 8_453,
      feedAddress: "0x0000000000000000000000000000000000000000",
      rawAnswer: asset.price,
      feedDecimals: 6,
      sourceRoundId: BigInt(index + 1),
      sourceUpdatedAt: now - 5,
      observedAt: now,
      referencePriceUsdcPerWholeToken: asset.price,
      sourceDescription: "Simulated local reference (not Chainlink)",
      status: "valid",
    });
    if (result === "inserted") console.log(`seeded ${asset.symbol}`);
  }
  await db.pool.end();

  writeFileSync(
    MANIFEST,
    `${JSON.stringify(
      {
        environment: "local-anvil",
        status: "local-anvil",
        chainId: 84_532,
        chain: "base-sepolia",
        rpc: { url: RPC, loopback: true },
        createdAt: new Date().toISOString(),
        warning:
          "LOCAL ANVIL ONLY. Simulated prices. Never use as a Base Sepolia or Mainnet manifest.",
        contracts: {
          TestUSDC: { address: usdc, verified: false },
          KyroxExchange: { address: exchange, verified: false },
        },
        assets: Object.fromEntries(
          ASSETS.map((asset) => [
            asset.symbol,
            {
              address: stocks[asset.symbol],
              verified: false,
              maxSourceAgeSeconds: 3_600,
              maxPriceDeviationBps: 500,
              minPriceUsdcPerWholeToken: "1",
              maxPriceUsdcPerWholeToken: "1000000000000",
            },
          ]),
        ),
      },
      null,
      2,
    )}\n`,
  );

  console.log(
    JSON.stringify(
      { environment: "local-anvil", usdc, exchange, stocks, manifest: MANIFEST },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
