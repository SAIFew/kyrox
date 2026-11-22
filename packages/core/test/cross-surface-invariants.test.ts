import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  BASE_SEPOLIA_CHAIN_ID,
  MAX_TOKEN_DECIMALS,
  PRODUCT_CHAIN_ENV,
  TESTNET_ASSETS,
  TESTNET_TRADE_POLICY,
} from "../src/index.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const MCP_ROOT = path.join(REPO_ROOT, "services/mcp-server");

interface PythonSurfaceInvariants {
  readonly baseSepoliaChainId: number;
  readonly baseSepoliaChainName: string;
  readonly maxTokenDecimals: number;
  readonly canonicalApprovedTickers: readonly string[];
  readonly datasetTickers: readonly string[];
}

function loadPythonSurfaceInvariants(): PythonSurfaceInvariants {
  const script = `
import ast
import json
import pathlib

mcp_root = pathlib.Path(${JSON.stringify(MCP_ROOT)})

def extract_literals(rel_path: str) -> dict:
    tree = ast.parse((mcp_root / rel_path).read_text(encoding="utf-8"))
    values = {}
    for node in tree.body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            try:
                values[node.targets[0].id] = ast.literal_eval(node.value)
            except Exception:
                pass
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name) and node.value is not None:
            try:
                values[node.target.id] = ast.literal_eval(node.value)
            except Exception:
                pass
    return values

wallet_consts = extract_literals("tools/wallet.py")
policy_consts = extract_literals("tools/policy.py")
errors_consts = extract_literals("tools/errors.py")
stocks_data = json.loads((mcp_root / "data/stocks.json").read_text(encoding="utf-8"))

print(json.dumps({
    "baseSepoliaChainId": wallet_consts["BASE_SEPOLIA_CHAIN_ID"],
    "baseSepoliaChainName": wallet_consts["BASE_SEPOLIA_CHAIN_NAME"],
    "maxTokenDecimals": errors_consts["MAX_TOKEN_DECIMALS"],
    "canonicalApprovedTickers": list(policy_consts["CANONICAL_APPROVED_TICKERS"]),
    "datasetTickers": [item["ticker"] for item in stocks_data],
}))
`;
  const raw = execFileSync("python3", ["-c", script], { encoding: "utf8" });
  return JSON.parse(raw) as PythonSurfaceInvariants;
}

describe("Cross-surface policy invariants (TypeScript core vs. Python MCP server)", () => {
  const py = loadPythonSurfaceInvariants();

  it("enforces identical Base Sepolia chain ID and chain identifier across TypeScript and Python", () => {
    expect(BASE_SEPOLIA_CHAIN_ID).toBe(py.baseSepoliaChainId);
    expect(PRODUCT_CHAIN_ENV).toBe(py.baseSepoliaChainName);
  });

  it("enforces identical canonical approved ticker sets across TypeScript policy, asset catalogue, and Python MCP policy", () => {
    const tsPolicyTickers = [...TESTNET_TRADE_POLICY.allowedAssets];
    const tsCatalogueTickers = TESTNET_ASSETS.map((a) => a.symbol);

    expect(tsPolicyTickers).toEqual(py.canonicalApprovedTickers);
    expect(tsCatalogueTickers).toEqual(py.canonicalApprovedTickers);
    expect(py.datasetTickers).toEqual(py.canonicalApprovedTickers);
  });

  it("enforces identical upper token decimal safety bounds", () => {
    expect(MAX_TOKEN_DECIMALS).toBe(py.maxTokenDecimals);
  });
});
