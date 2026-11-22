import { expect, test } from "@playwright/test";
import {
  createPublicClient,
  createWalletClient,
  hexToString,
  http,
  type Address,
  type Hex,
} from "viem";

const RPC = process.env["BASE_SEPOLIA_RPC_URL"] ?? "http://127.0.0.1:8545";

test("consumer can authenticate, quote, prepare, sign, and see verified activity", async ({
  page,
}) => {
  const chain = {
    id: 84_532,
    name: "Base Sepolia",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [RPC] } },
  } as const;
  const client = createPublicClient({ chain, transport: http(RPC) });
  const wallet = createWalletClient({ chain, transport: http(RPC) });
  const accounts = (await client.request({ method: "eth_accounts" } as never)) as Address[];
  const trader = accounts[2] as Address;

  await page.exposeBinding(
    "__kyroxWalletRequest",
    async (_source, request: { method: string; params?: unknown[] }) => {
      const { method } = request;
      const params = request.params ?? [];
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [trader];
      if (method === "eth_chainId") return "0x14a34";
      if (method === "wallet_switchEthereumChain" || method === "wallet_addEthereumChain")
        return null;
      if (method === "personal_sign") {
        const message = hexToString(params[0] as Hex);
        return wallet.signMessage({ account: trader, message });
      }
      if (method === "eth_sendTransaction") {
        const tx = params[0] as { to: Address; data: Hex; value?: string };
        const hash = await wallet.sendTransaction({
          account: trader,
          to: tx.to,
          data: tx.data,
          value: tx.value ? BigInt(tx.value) : 0n,
        });
        await client.waitForTransactionReceipt({ hash });
        for (let i = 0; i < 3; i += 1) {
          await client.request({ method: "evm_mine", params: [] } as never);
        }
        return hash;
      }
      throw new Error(`Unsupported wallet method ${method}`);
    },
  );

  await page.addInitScript(() => {
    // Test-only injected provider backed by the Playwright binding.
    (window as unknown as { ethereum: unknown }).ethereum = {
      request: (args: unknown) =>
        (
          window as unknown as { __kyroxWalletRequest: (args: unknown) => Promise<unknown> }
        ).__kyroxWalletRequest(args),
    };
  });

  page.on("console", (message) => console.log("BROWSER", message.type(), message.text()));
  page.on("pageerror", (error) => console.log("PAGEERROR", error.message));
  page.on("requestfailed", (request) =>
    console.log("REQFAIL", request.url(), request.failure()?.errorText),
  );

  await page.goto("/");
  await expect(page.getByText("LOCAL ANVIL · SIMULATED")).toBeVisible();
  await expect(page.getByRole("button", { name: /Connect wallet|Sign in/ })).toBeVisible();

  await page.getByRole("button", { name: /Connect wallet/ }).click();
  await expect(page.getByText(/0x/).first()).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: /Claim 1,000 test tUSDC/ }).click();
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "Refresh" }).click();

  await page.getByPlaceholder("0.00").fill("1");
  await page.getByRole("button", { name: "Get quote" }).click();
  await expect(page.getByText("Minimum received")).toBeVisible();
  await expect(page.getByText(/Simulated reference price/)).toBeVisible();

  await page.getByRole("button", { name: "Prepare transaction" }).click();
  await expect(page.getByText("Unsigned transaction — review in your wallet.")).toBeVisible();
  await page.getByRole("button", { name: "Approve in wallet" }).click();
  await expect(page.getByText("Verified", { exact: true })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText("tAAPL").first()).toBeVisible();
});
