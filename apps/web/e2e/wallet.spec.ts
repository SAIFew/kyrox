import { expect, test } from "@playwright/test";
import {
  createPublicClient,
  createWalletClient,
  hexToString,
  http,
  parseAbi,
  type Address,
  type Hex,
} from "viem";

import { expectNoRuntimeErrors, monitorRuntimeErrors } from "./helpers";

const RPC = process.env["BASE_SEPOLIA_RPC_URL"] ?? "http://127.0.0.1:8545";
const ERC20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);

test.skip(
  process.env["KYROX_ANVIL_E2E"] !== "1",
  "Set KYROX_ANVIL_E2E=1 against the disposable local-Anvil app to run the wallet journey.",
);

test("local-Anvil wallet can authenticate, approve exactly, trade, and see activity", async ({
  page,
}) => {
  const rpc = new URL(RPC);
  expect(rpc.protocol).toBe("http:");
  expect(rpc.hostname).toBe("127.0.0.1");

  const chain = {
    id: 84_532,
    name: "Base Sepolia",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [RPC] } },
  } as const;
  const client = createPublicClient({ chain, transport: http(RPC) });
  const wallet = createWalletClient({ chain, transport: http(RPC) });
  expect(await client.getChainId()).toBe(84_532);

  const accounts = (await client.request({ method: "eth_accounts" } as never)) as Address[];
  const trader = accounts[2];
  if (trader === undefined)
    throw new Error("Anvil needs at least three accounts for the wallet E2E.");

  await page.exposeBinding("__kyroxWalletRequest", async (_source, request) => {
    const method = request.method;
    const params = request.params ?? [];
    if (method === "eth_requestAccounts" || method === "eth_accounts") return [trader];
    if (method === "eth_chainId") return "0x14a34";
    if (
      method === "wallet_switchEthereumChain" ||
      method === "wallet_addEthereumChain" ||
      method === "wallet_revokePermissions"
    ) {
      return null;
    }
    if (method === "personal_sign") {
      return wallet.signMessage({
        account: trader,
        message: hexToString(params[0] as Hex),
      });
    }
    if (method === "eth_call") {
      const call = params[0] as { to: Address; data?: Hex; from?: Address };
      const result = await client.call({
        account: trader,
        to: call.to,
        ...(call.data === undefined ? {} : { data: call.data }),
      });
      return result.data;
    }
    if (method === "eth_getTransactionReceipt") {
      const receipt = await client.getTransactionReceipt({ hash: params[0] as Hex });
      return { status: receipt.status === "success" ? "0x1" : "0x0" };
    }
    if (method === "eth_sendTransaction") {
      const transaction = params[0] as { to: Address; data: Hex; value?: string };
      const hash = await wallet.sendTransaction({
        account: trader,
        to: transaction.to,
        data: transaction.data,
        value: transaction.value === undefined ? 0n : BigInt(transaction.value),
      });
      await client.waitForTransactionReceipt({ hash });
      for (let index = 0; index < 3; index += 1) {
        await client.request({ method: "evm_mine", params: [] } as never);
      }
      return hash;
    }
    throw new Error(`Unsupported wallet method ${method}`);
  });

  await page.addInitScript(() => {
    (window as unknown as { ethereum: unknown }).ethereum = {
      request: (args: unknown) =>
        (
          window as unknown as { __kyroxWalletRequest: (args: unknown) => Promise<unknown> }
        ).__kyroxWalletRequest(args),
    };
  });

  const errors = monitorRuntimeErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/portfolio");
  await expect(page.getByText(/Base Sepolia \(local Anvil\)/).first()).toBeVisible();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Sign in to KYROX" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /Connect wallet/ }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  await expect(page.locator(".account-tag")).toHaveCount(0);

  const faucet = page
    .locator("article", { hasText: "Welcome grant" })
    .getByRole("button", { name: "Claim", exact: true });
  await faucet.click();
  await expect(faucet).toBeEnabled();

  await page.goto("/markets/tAAPL");
  await expect(page.getByRole("heading", { name: "Test Apple", exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: /Amount in/ }).fill("1");
  const [quoteResponse] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/quotes") && response.request().method() === "POST",
    ),
    page.getByRole("button", { name: "Review order" }).click(),
  ]);
  expect(quoteResponse.ok()).toBe(true);
  const quotePayload = (await quoteResponse.json()) as {
    quote?: { quoteId?: string; simulated?: boolean; simulatedPrice?: boolean };
  };
  expect(quotePayload.quote?.quoteId).toEqual(expect.any(String));
  expect(quotePayload.quote?.simulated).toBe(true);
  expect(quotePayload.quote?.simulatedPrice).toBe(true);
  await expect(page.getByText("Minimum received", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Approve in wallet" }).click();
  await expect(page.getByRole("heading", { name: "Transaction submitted" })).toBeVisible({
    timeout: 60_000,
  });

  const assetsResponse = await page.request.get("/api/assets");
  expect(assetsResponse.ok()).toBe(true);
  const assets = (await assetsResponse.json()) as {
    assets: Array<{ symbol: string; stockToken: Address }>;
  };
  const apple = assets.assets.find((asset) => asset.symbol === "tAAPL");
  if (apple === undefined) throw new Error("tAAPL missing from the local deployment.");
  const balance = await client.readContract({
    address: apple.stockToken,
    abi: ERC20,
    functionName: "balanceOf",
    args: [trader],
  });
  expect(balance).toBeGreaterThan(0n);

  await page.goto("/activity");
  await expect(page.getByRole("heading", { name: "Order history" })).toBeVisible();
  await expect(page.locator(".activity-item").first()).toContainText("Apple");
  await expect(page.locator(".activity-item .side-badge").first()).toHaveText("buy");
  await expect(page.locator(".status-pill").first()).toContainText(/Submitted|Included|Verified/);
  expectNoRuntimeErrors(errors);
});
