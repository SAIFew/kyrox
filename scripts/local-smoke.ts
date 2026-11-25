import { pathToFileURL } from "node:url";

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

const APP = (process.env["APP_URL"] ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const RPC = process.env["BASE_SEPOLIA_RPC_URL"] ?? "http://127.0.0.1:8545";
const REQUEST_TIMEOUT_MS = 30_000;

const ERC20 = parseAbi([
  "function claimWelcome()",
  "function approve(address spender, uint256 amount)",
]);

interface AssetsResponse {
  assets: Array<{ symbol: string; stockToken: Address; stockDecimals: number }>;
  settlement: Address;
  exchange: Address;
  mode: string;
  simulated?: boolean;
}

interface QuotePayload {
  quoteId: string;
  quoteToken: string;
  amountIn: string;
  amountOut: string;
  amountOutLabel?: string;
}

interface PreparedIntent {
  intentId: string;
  amountIn: string;
  to: Address;
  data: Hex;
  value?: string;
  hash: Hex;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${APP}${path}`, {
    ...init,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

async function json(response: Response, label: string): Promise<unknown> {
  const text = await response.text();
  if (!response.ok) throw new Error(`${label} failed (${response.status}): ${text}`);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${label} returned malformed JSON: ${text.slice(0, 200)}`);
  }
}

/**
 * The quote endpoint now returns `{ quote }`. Keep accepting the former flat
 * response so this smoke harness works against either side of a rolling deploy.
 */
export function quoteFrom(payload: unknown): QuotePayload {
  if (payload === null || typeof payload !== "object") {
    throw new Error("Quote response was not an object.");
  }
  const record = payload as Record<string, unknown>;
  const nested = record["quote"];
  const quote =
    nested !== null && typeof nested === "object" ? (nested as Record<string, unknown>) : record;
  if (
    typeof quote["quoteId"] !== "string" ||
    typeof quote["quoteToken"] !== "string" ||
    typeof quote["amountIn"] !== "string" ||
    typeof quote["amountOut"] !== "string"
  ) {
    throw new Error("Quote response did not contain the current quote fields.");
  }
  return {
    quoteId: quote["quoteId"],
    quoteToken: quote["quoteToken"],
    amountIn: quote["amountIn"],
    amountOut: quote["amountOut"],
    ...(typeof quote["amountOutLabel"] === "string"
      ? { amountOutLabel: quote["amountOutLabel"] }
      : {}),
  };
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
  const traderCandidate = accounts[1];
  if (!traderCandidate) throw new Error("Anvil needs at least two accounts.");
  const trader: Address = traderCandidate;

  const assets = (await json(await request("/api/assets"), "Assets API")) as AssetsResponse;
  if (assets.mode !== "local-anvil") throw new Error("Smoke test must run in local-anvil mode.");
  const asset = assets.assets.find((entry) => entry.symbol === "tAAPL");
  if (!asset) throw new Error("tAAPL is not available.");
  const zeroAddress = "0x0000000000000000000000000000000000000000";
  if (
    !/^0x[0-9a-fA-F]{40}$/.test(assets.settlement) ||
    assets.settlement.toLowerCase() === zeroAddress
  ) {
    throw new Error("Local deployment did not provide a settlement token.");
  }
  if (
    !/^0x[0-9a-fA-F]{40}$/.test(assets.exchange) ||
    assets.exchange.toLowerCase() === zeroAddress
  ) {
    throw new Error("Local deployment did not provide an exchange address.");
  }

  const nonceResponse = await request("/api/auth/nonce", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: trader }),
  });
  const nonce = (await json(nonceResponse, "Nonce request")) as { message?: string };
  if (typeof nonce.message !== "string" || nonce.message.length === 0) {
    throw new Error("Nonce endpoint did not return a message.");
  }
  const signature = await wallet.signMessage({ account: trader, message: nonce.message });
  const verifyResponse = await request("/api/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: nonce.message, signature }),
  });
  await json(verifyResponse, "Authentication");
  const cookieHeader = verifyResponse.headers.get("set-cookie")?.split(";")[0];
  if (!cookieHeader?.startsWith("kyrox_session="))
    throw new Error("No wallet session cookie was issued.");
  const cookie: string = cookieHeader;
  console.log("✓ wallet authenticated with one-time nonce");

  async function authed(path: string, init?: RequestInit) {
    const headers = new Headers(init?.headers);
    headers.set("cookie", cookie);
    return fetch(`${APP}${path}`, {
      ...init,
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  }

  async function send(to: Address, data: Hex) {
    const hash = await wallet.sendTransaction({ account: trader, to, data });
    const receipt = await client.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`transaction ${hash} reverted`);
    return hash;
  }

  await send(assets.settlement, encodeFunctionData({ abi: ERC20, functionName: "claimWelcome" }));
  console.log("✓ faucet claimed");

  const quoteResponse = await authed("/api/quotes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ symbol: "tAAPL", side: "buy", amountIn: "1000000", slippageBps: 50 }),
  });
  const quote = quoteFrom(await json(quoteResponse, "Quote request"));
  console.log(`✓ quote issued (${quote.amountOutLabel ?? quote.amountOut} tAAPL for 1 tUSDC)`);

  const prepareResponse = await authed("/api/trades/prepare", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ quoteId: quote.quoteId, quoteToken: quote.quoteToken }),
  });
  const intent = (await json(prepareResponse, "Prepare request")) as PreparedIntent;
  if (
    typeof intent.intentId !== "string" ||
    typeof intent.amountIn !== "string" ||
    !/^0x[0-9a-fA-F]{40}$/.test(intent.to) ||
    typeof intent.data !== "string" ||
    !intent.data.startsWith("0x") ||
    (intent.value !== undefined && intent.value !== "0")
  ) {
    throw new Error("Prepare endpoint returned an invalid intent.");
  }
  console.log("✓ unsigned intent prepared");

  // Approve only the exact base-unit input required by this intent.
  if (!/^\d+$/.test(intent.amountIn) || BigInt(intent.amountIn) <= 0n) {
    throw new Error("Prepared intent did not contain a positive base-unit amount.");
  }
  await send(
    assets.settlement,
    encodeFunctionData({
      abi: ERC20,
      functionName: "approve",
      args: [assets.exchange, BigInt(intent.amountIn)],
    }),
  );
  console.log("✓ exact allowance approved");

  const txHash = await send(intent.to, intent.data);
  const submittedResponse = await authed("/api/trades/submitted", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ intentId: intent.intentId, txHash }),
  });
  await json(submittedResponse, "Submission record");
  console.log(`✓ wallet approved and submitted ${txHash}`);

  for (let i = 0; i < 3; i += 1) {
    await client.request({ method: "evm_mine", params: [] } as never);
  }

  let portfolioBalance = 0n;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const portfolioResponse = await authed("/api/portfolio");
    if (portfolioResponse.ok) {
      const payload = (await json(portfolioResponse, "Portfolio request")) as {
        portfolio: { positions: Array<{ symbol: string; amount: string; decimals?: number }> };
      };
      const position = payload.portfolio.positions.find((entry) => entry.symbol === "tAAPL");
      if (position !== undefined) {
        portfolioBalance = parseUnits(position.amount, position.decimals ?? asset.stockDecimals);
        if (portfolioBalance > 0n) break;
      }
    }
    await sleep(300);
  }
  if (portfolioBalance === 0n) throw new Error("Portfolio did not reflect the executed trade.");

  const activityResponse = await authed("/api/activity");
  const activity = (await json(activityResponse, "Activity request")) as {
    activity: Array<{ status: string }>;
  };
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

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
