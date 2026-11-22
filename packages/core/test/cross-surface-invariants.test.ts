import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  DeploymentError,
  assertSepoliaAddress,
  parseDeploymentManifest,
} from "../../protocol/src/deployments.js";
import {
  BASE_MAINNET_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_ID,
  CoreError,
  MAX_TOKEN_DECIMALS,
  PRODUCT_CHAIN_ENV,
  TESTNET_ASSETS,
  TESTNET_TRADE_POLICY,
  TokenAmountError,
  assertSafeDecimals,
  testnetAssetRegistry,
  toBaseUnits,
} from "../src/index.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const MCP_ROOT = path.join(REPO_ROOT, "services/mcp-server");

function resolveMcpPythonRuntime(): string | null {
  const candidates = [
    process.env.KYROX_MCP_PYTHON,
    path.join(MCP_ROOT, ".venv/bin/python"),
    path.resolve(REPO_ROOT, "../kyro-mcp/.venv/bin/python"),
    "python3",
    "python",
  ].filter((c): c is string => Boolean(c));

  for (const candidate of candidates) {
    if (candidate.includes("/") && !existsSync(candidate)) {
      continue;
    }
    try {
      execFileSync(
        candidate,
        [
          "-c",
          "import sys; sys.path.insert(0, sys.argv[1]); import tools.wallet, tools.policy, tools.errors, tools.stocks",
          MCP_ROOT,
        ],
        { stdio: "pipe" },
      );
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

const MCP_PYTHON = resolveMcpPythonRuntime();
if (process.env.KYROX_REQUIRE_CROSS_SURFACE_RUNTIME === "1" && MCP_PYTHON === null) {
  throw new Error(
    "KYROX_REQUIRE_CROSS_SURFACE_RUNTIME=1 was set, but no Python interpreter with services/mcp-server runtime dependencies (web3, python-dotenv, mcp) was found.",
  );
}

interface PythonRuntimeProbe {
  readonly baseSepoliaChainId: number;
  readonly baseSepoliaChainName: string;
  readonly chain84532Allowed: boolean;
  readonly chain8453Allowed: boolean;
  readonly chain8453ErrorCode: string | null;
  readonly approvedTickersCanonical: readonly string[];
  readonly loadedStockTickers: readonly string[];
  readonly validTickerResult: string;
  readonly invalidTickerErrorCode: string;
  readonly maxTokenDecimals: number;
  readonly decimals0BaseUnits: string;
  readonly decimals77Allowed: boolean;
  readonly decimals78ErrorCode: string;
  readonly decimalsNeg1ErrorCode: string;
  readonly oneAndHalf18dpBaseUnits: string;
  readonly errorCodes: readonly string[];
  readonly zeroAmountErrorCode: string | null;
  readonly aboveMaxErrorCode: string | null;
  readonly zeroAddressConstant: string;
  readonly zeroAddressErrorCode: string;
  readonly malformedAddressErrorCode: string;
  readonly emptyAddressErrorCode: string;
  readonly badChecksumErrorCode: string;
  readonly normalizedChecksumAddress: string;
  readonly mcpMaxTxAmountTokens: string;
  readonly amount50Allowed: boolean;
  readonly amount50RequiresHumanApproval: boolean;
  readonly amount50Point01Allowed: boolean;
  readonly amount50Point01RequiresHumanApproval: boolean;
}

function executePythonRuntimeProbe(pythonBin: string): PythonRuntimeProbe {
  const script = `
import json
import sys

mcp_root = sys.argv[1]
sys.path.insert(0, mcp_root)

import tools.errors as errors_mod
import tools.policy as policy_mod
import tools.stocks as stocks_mod
import tools.wallet as wallet_mod

# 1. Chain ID runtime evaluation
decision_84532 = policy_mod.evaluate_transaction_policy("tAAPL", "1", chain_id=84532, audit=False)
decision_8453 = policy_mod.evaluate_transaction_policy("tAAPL", "1", chain_id=8453, audit=False)

# 2. Asset allowlist runtime evaluation
valid_ticker = policy_mod.validate_approved_ticker("tAAPL")
try:
    policy_mod.validate_approved_ticker("tMSFT")
    invalid_ticker_code = "NONE"
except errors_mod.KyroxError as exc:
    invalid_ticker_code = exc.code.value

# 3. Token decimal bound runtime evaluation
_, dec0_units = errors_mod.validate_token_amount("1", decimals=0)
_, dec77_units = errors_mod.validate_token_amount("1", decimals=77)
_, one_half_units = errors_mod.validate_token_amount("1.5", decimals=18)

try:
    errors_mod.validate_token_amount("1", decimals=78)
    dec78_code = "NONE"
except errors_mod.KyroxError as exc:
    dec78_code = exc.code.value

try:
    errors_mod.validate_token_amount("1", decimals=-1)
    dec_neg1_code = "NONE"
except errors_mod.KyroxError as exc:
    dec_neg1_code = exc.code.value

# 4. Shared error codes runtime evaluation
decision_zero = policy_mod.evaluate_transaction_policy("tAAPL", "0", audit=False)
decision_above_max = policy_mod.evaluate_transaction_policy("tAAPL", "50.01", audit=False)

# 5. Address safety runtime evaluation
try:
    wallet_mod.validate_wallet_address("0x0000000000000000000000000000000000000000")
    zero_addr_code = "NONE"
except errors_mod.KyroxError as exc:
    zero_addr_code = exc.code.value

try:
    wallet_mod.validate_wallet_address("0x1234")
    malformed_addr_code = "NONE"
except errors_mod.KyroxError as exc:
    malformed_addr_code = exc.code.value

try:
    wallet_mod.validate_wallet_address("")
    empty_addr_code = "NONE"
except errors_mod.KyroxError as exc:
    empty_addr_code = exc.code.value

try:
    wallet_mod.validate_wallet_address("0x71c7656ec7ab88b098defb751b7401b5f6d8976F")
    bad_checksum_code = "NONE"
except errors_mod.KyroxError as exc:
    bad_checksum_code = exc.code.value

normalized_checksum = wallet_mod.validate_wallet_address("0x71c7656ec7ab88b098defb751b7401b5f6d8976f")

# 6. MCP 50-token policy surface boundary
decision_50 = policy_mod.evaluate_transaction_policy("tAAPL", "50", audit=False)

print(json.dumps({
    "baseSepoliaChainId": wallet_mod.BASE_SEPOLIA_CHAIN_ID,
    "baseSepoliaChainName": wallet_mod.BASE_SEPOLIA_CHAIN_NAME,
    "chain84532Allowed": decision_84532.allowed,
    "chain8453Allowed": decision_8453.allowed,
    "chain8453ErrorCode": decision_8453.error_code,
    "approvedTickersCanonical": list(policy_mod.get_approved_tickers_canonical()),
    "loadedStockTickers": [item["ticker"] for item in stocks_mod.load_stocks()],
    "validTickerResult": valid_ticker,
    "invalidTickerErrorCode": invalid_ticker_code,
    "maxTokenDecimals": errors_mod.MAX_TOKEN_DECIMALS,
    "decimals0BaseUnits": str(dec0_units),
    "decimals77Allowed": dec77_units == 10**77,
    "decimals78ErrorCode": dec78_code,
    "decimalsNeg1ErrorCode": dec_neg1_code,
    "oneAndHalf18dpBaseUnits": str(one_half_units),
    "errorCodes": [e.value for e in errors_mod.ErrorCode],
    "zeroAmountErrorCode": decision_zero.error_code,
    "aboveMaxErrorCode": decision_above_max.error_code,
    "zeroAddressConstant": wallet_mod.ZERO_ADDRESS,
    "zeroAddressErrorCode": zero_addr_code,
    "malformedAddressErrorCode": malformed_addr_code,
    "emptyAddressErrorCode": empty_addr_code,
    "badChecksumErrorCode": bad_checksum_code,
    "normalizedChecksumAddress": normalized_checksum,
    "mcpMaxTxAmountTokens": str(policy_mod.get_max_tx_amount()),
    "amount50Allowed": decision_50.allowed,
    "amount50RequiresHumanApproval": decision_50.requires_human_approval,
    "amount50Point01Allowed": decision_above_max.allowed,
    "amount50Point01RequiresHumanApproval": decision_above_max.requires_human_approval,
}))
`;
  const raw = execFileSync(pythonBin, ["-c", script, MCP_ROOT], { encoding: "utf8" });
  return JSON.parse(raw) as PythonRuntimeProbe;
}

describe.skipIf(MCP_PYTHON === null)(
  "Cross-surface runtime invariants (TypeScript @kyrox/core & @kyrox/protocol vs. Python MCP runtime)",
  () => {
    const py = MCP_PYTHON ? executePythonRuntimeProbe(MCP_PYTHON) : (null as never);

    it("enforces identical Base Sepolia chain ID (84532) and rejects Base Mainnet (8453) at runtime across both surfaces", () => {
      expect(BASE_SEPOLIA_CHAIN_ID).toBe(84532);
      expect(py.baseSepoliaChainId).toBe(BASE_SEPOLIA_CHAIN_ID);
      expect(py.baseSepoliaChainName).toBe(PRODUCT_CHAIN_ENV);

      const validManifest = parseDeploymentManifest({
        chainId: BASE_SEPOLIA_CHAIN_ID,
        chain: PRODUCT_CHAIN_ENV,
        environment: "base-sepolia",
        status: "unpopulated",
        contracts: {},
        assets: {},
      });
      expect(validManifest.chainId).toBe(py.baseSepoliaChainId);
      expect(py.chain84532Allowed).toBe(true);

      expect(() =>
        parseDeploymentManifest({
          chainId: BASE_MAINNET_CHAIN_ID,
          chain: "base-mainnet",
          environment: "base-mainnet",
          status: "unpopulated",
          contracts: {},
          assets: {},
        }),
      ).toThrowError(DeploymentError);
      expect(py.chain8453Allowed).toBe(false);
      expect(py.chain8453ErrorCode).toBe("UNSUPPORTED_CHAIN_ID");
    });

    it("enforces identical approved synthetic asset tickers (tAAPL, tTSLA, tNVDA) and rejects unapproved tickers at runtime", () => {
      const tsPolicyTickers = [...TESTNET_TRADE_POLICY.allowedAssets];
      const tsCatalogueTickers = TESTNET_ASSETS.map((a) => a.symbol);
      const tsTradableTickers = testnetAssetRegistry.listTradable().map((a) => a.symbol);

      expect(tsPolicyTickers).toEqual(["tAAPL", "tTSLA", "tNVDA"]);
      expect(tsCatalogueTickers).toEqual(tsPolicyTickers);
      expect(tsTradableTickers).toEqual(tsPolicyTickers);
      expect(py.approvedTickersCanonical).toEqual(tsPolicyTickers);
      expect(py.loadedStockTickers).toEqual(tsPolicyTickers);

      expect(testnetAssetRegistry.get("tAAPL").symbol).toBe(py.validTickerResult);
      expect(() => testnetAssetRegistry.get("tMSFT")).toThrowError(CoreError);
      expect(py.invalidTickerErrorCode).toBe("POLICY_REJECTED");
    });

    it("enforces identical token decimal bounds (0..77) and base-unit conversion behavior at runtime", () => {
      expect(MAX_TOKEN_DECIMALS).toBe(77);
      expect(py.maxTokenDecimals).toBe(MAX_TOKEN_DECIMALS);

      expect(assertSafeDecimals(0)).toBe(0);
      expect(assertSafeDecimals(77)).toBe(77);
      expect(py.decimals0BaseUnits).toBe(toBaseUnits("1", 0).toString());
      expect(py.decimals77Allowed).toBe(true);
      expect(py.oneAndHalf18dpBaseUnits).toBe(toBaseUnits("1.5", 18).toString());

      expect(() => assertSafeDecimals(78)).toThrowError(TokenAmountError);
      expect(() => assertSafeDecimals(-1)).toThrowError(TokenAmountError);
      expect(py.decimals78ErrorCode).toBe("DECIMAL_PRECISION_ERROR");
      expect(py.decimalsNeg1ErrorCode).toBe("DECIMAL_PRECISION_ERROR");
    });

    it("shares canonical error-code identifiers and semantic rejection codes at runtime", () => {
      const invalidAmountErr = new CoreError("INVALID_AMOUNT", "amount must be positive");
      expect(invalidAmountErr.code).toBe("INVALID_AMOUNT");
      expect(py.errorCodes).toContain("INVALID_AMOUNT");
      expect(py.zeroAmountErrorCode).toBe("INVALID_AMOUNT");

      expect(py.errorCodes).toContain("POLICY_REJECTED");
      expect(py.aboveMaxErrorCode).toBe("POLICY_REJECTED");
    });

    it("enforces zero-address and malformed-address rejection at runtime across both surfaces", () => {
      const zeroAddress = "0x0000000000000000000000000000000000000000";
      const validChecksumAddress = "0x71C7656EC7ab88b098defB751B7401B5f6d8976F";

      expect(py.zeroAddressConstant).toBe(zeroAddress);
      expect(() => assertSepoliaAddress(zeroAddress, "wallet")).toThrowError(DeploymentError);
      expect(py.zeroAddressErrorCode).toBe("ZERO_ADDRESS_NOT_ALLOWED");

      expect(() => assertSepoliaAddress("0x1234", "wallet")).toThrowError(DeploymentError);
      expect(() => assertSepoliaAddress("", "wallet")).toThrowError(DeploymentError);
      expect(py.malformedAddressErrorCode).toBe("INVALID_WALLET_ADDRESS");
      expect(py.emptyAddressErrorCode).toBe("EMPTY_INPUT");
      expect(py.badChecksumErrorCode).toBe("INVALID_ADDRESS_CHECKSUM");

      expect(assertSepoliaAddress(validChecksumAddress, "wallet")).toBe(validChecksumAddress);
      expect(py.normalizedChecksumAddress).toBe(validChecksumAddress);
    });

    it("preserves distinct consumer exchange trade limits (1/1,000/5,000 tUSDC) vs. developer MCP transfer limits (50 tokens) per ADR-0011", () => {
      expect(TESTNET_TRADE_POLICY.minTradeUsdc).toBe(1_000_000n);
      expect(TESTNET_TRADE_POLICY.maxTradeUsdc).toBe(1_000_000_000n);
      expect(TESTNET_TRADE_POLICY.dailyLimitUsdc).toBe(5_000_000_000n);

      expect(py.mcpMaxTxAmountTokens).toBe("50");
      expect(py.amount50Allowed).toBe(true);
      expect(py.amount50RequiresHumanApproval).toBe(true);
      expect(py.amount50Point01Allowed).toBe(false);
      expect(py.amount50Point01RequiresHumanApproval).toBe(true);
    });
  },
);
