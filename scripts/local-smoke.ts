import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  parseAbi,
  parseUnits,
  type Address,
  type Hex,
} from "viem";
import { loadDeploymentManifest, requireExchangeAddress } from "@kyrox/protocol";

const APP = process.env["APP_URL"] ?? "http://127.0.0.1:3000";
const RPC = process.env["BASE_SEPOLIA_RPC_URL"] ?? "http://127.0.0.1:8545";

const ERC20 = parseAbi([
  "function claimWelcome()",
  "function approve(address spender, uint256 amount)",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
]);
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const chain = {
    id: 84_532,
    name: "Base Sepolia",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [RPC] } },
  } as const;
  const client = createPublicClient({ chain, transport: http(RPC) });
  const wallet = createWalletClient({ chain, transport: http(RPC) });
  if ((await client.getChainId()) !== 84_532) throw new Error("Smoke test requires chain 84532.");

  const accounts = (await client.request({ method: "eth_accounts" } as never)) as Address[];
  const trader = accounts[1];
  if (!trader) throw new Error("Anvil needs at least two accounts.");

  const assetsResponse = await fetch(`${APP}/api/assets`);
  if (!assetsResponse.ok) throw new Error(`Assets API failed: ${assetsResponse.status}`);
  const assets = (await assetsResponse.json()) as {
    assets: Array<{ symbol: string; stockToken: Address }>;
    settlement: Address;
    mode: string;
  };
  if (assets.mode !== "local-anvil") throw new Error("Smoke test must run in local-anvil mode.");
  const asset = assets.assets.find((entry) => entry.symbol === "tAAPL");
  if (!asset) throw new Error("tAAPL is not available.");

  const nonceResponse = await fetch(`${APP}/api/auth/nonce`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: trader }),
  });
  const nonce = (await nonceResponse.json()) as { message?: string };
  if (!nonce.message) throw new Error("Nonce endpoint did not return a message.");
  const signature = await wallet.signMessage({ account: trader, message: nonce.message });
  const verify = await fetch(`${APP}/api/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: nonce.message, signature }),
  });
  if (!verify.ok) throw new Error(`Authentication failed: ${await verify.text()}`);
  const cookie = verify.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("No session cookie was issued.");
  console.log("✓ wallet authenticated with one-time nonce");

  async function authed(path: string, init?: RequestInit) {
    return fetch(`${APP}${path}`, { ...init, headers: { ...(init?.headers ?? {}), cookie } });
  }

  async function send(to: Address, data: Hex) {
    const hash = await wallet.sendTransaction({ account: trader, to, data });
    const receipt = await client.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`transaction ${hash} reverted`);
    return hash;
  }

  await send(assets.settlement, encodeFunctionData({ abi: ERC20, functionName: "claimWelcome" }));
  const manifest = loadDeploymentManifest(
    process.env["KYROX_DEPLOYMENT_MANIFEST"] ?? "deployments/local-anvil.json",
  );
  const exchangeAddress = requireExchangeAddress(manifest);
  await send(
    assets.settlement,
    encodeFunctionData({
      abi: ERC20,
      functionName: "approve",
      args: [exchangeAddress, 2n ** 256n - 1n],
    }),
  );
  console.log("✓ faucet claimed and exchange approved");

  const quoteResponse = await authed("/api/quotes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ symbol: "tAAPL", side: "buy", amountIn: "1000000", slippageBps: 50 }),
  });
  if (!quoteResponse.ok) throw new Error(`Quote failed: ${await quoteResponse.text()}`);
  const quote = (await quoteResponse.json()) as {
    quoteId: string;
    quoteToken: string;
    amountOut: string;
  };
  console.log(`✓ quote issued (${quote.amountOut} tAAPL for 1 tUSDC)`);

  const prepareResponse = await authed("/api/trades/prepare", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ quoteId: quote.quoteId, quoteToken: quote.quoteToken }),
  });
  if (!prepareResponse.ok) throw new Error(`Prepare failed: ${await prepareResponse.text()}`);
  const intent = (await prepareResponse.json()) as {
    intentId: string;
    to: Address;
    data: Hex;
    hash: Hex;
  };
  console.log("✓ unsigned intent prepared");

  const txHash = await send(intent.to, intent.data);
  const submitted = await authed("/api/trades/submitted", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ intentId: intent.intentId, txHash }),
  });
  if (!submitted.ok) throw new Error(`Submission record failed: ${await submitted.text()}`);
  console.log(`✓ wallet approved and submitted ${txHash}`);

  for (let i = 0; i < 3; i += 1) {
    await client.request({ method: "evm_mine", params: [] } as never);
  }

  let portfolioBalance = 0n;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const portfolioResponse = await authed("/api/portfolio");
    if (!portfolioResponse.ok)
      console.error("portfolio error", portfolioResponse.status, await portfolioResponse.text());
    if (portfolioResponse.ok) {
      const portfolio = (await portfolioResponse.json()) as {
        positions: Array<{ symbol: string; amount: string }>;
      };
      const position = portfolio.positions.find((entry) => entry.symbol === "tAAPL");
      portfolioBalance = parseUnits(position?.amount ?? "0", 18);
      if (portfolioBalance > 0n) break;
    }
    await sleep(300);
  }
  if (portfolioBalance === 0n) throw new Error("Portfolio did not reflect the executed trade.");

  const activityResponse = await authed("/api/activity");
  const activity = (await activityResponse.json()) as { activity: Array<{ status: string }> };
  if (activity.activity.length === 0) throw new Error("Activity was not recorded.");

  console.log(
    JSON.stringify(
      {
        authenticated: trader,
        quote: quote.amountOut,
        intentHash: intent.hash,
        txHash,
        activityStatus: activity.activity[0]?.status,
        portfolioTAApl: portfolioBalance.toString(),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
