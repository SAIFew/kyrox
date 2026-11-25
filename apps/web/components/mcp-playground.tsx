"use client";

import { useState } from "react";

import { api } from "../lib/api";
import { DEMO_ASSETS } from "../lib/demo/market";
import { assetDisplayName, environmentShortLabel, priceSourceLabel } from "../lib/presentation";
import { useAccount } from "./account-provider";
import { CodeIcon, CopyIcon, CheckIcon, ArrowRight } from "./icons";

const TOOL_OPTIONS = [
  { name: "kyrox_list_markets", args: {} },
  { name: "kyrox_get_market", args: { symbol: "tAAPL", range: "1W" } },
  { name: "kyrox_preview_quote", args: { symbol: "tAAPL", side: "buy", amount: "250" } },
  { name: "kyrox_get_protocol_status", args: {} },
] as const;

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <button
      className="copy-button"
      onClick={async () => {
        setFailed(false);
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1_600);
        } catch {
          setCopied(false);
          setFailed(true);
        }
      }}
      type="button"
      aria-live="polite"
    >
      {copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
      {failed ? "Copy failed" : copied ? "Copied" : label}
    </button>
  );
}

export function McpPlayground() {
  const { environment } = useAccount();
  const [tool, setTool] = useState<string>(TOOL_OPTIONS[0]?.name ?? "kyrox_list_markets");
  const [symbol, setSymbol] = useState("tAAPL");
  const [side, setSide] = useState("buy");
  const [amount, setAmount] = useState("250");
  const [output, setOutput] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    setBusy(true);
    setError("");
    setOutput("");
    const selected = TOOL_OPTIONS.find((entry) => entry.name === tool);
    const args: Record<string, unknown> = { ...(selected?.args ?? {}) };
    if (tool === "kyrox_get_market") {
      args["symbol"] = symbol;
    }
    if (tool === "kyrox_preview_quote") {
      Object.assign(args, { symbol, side, amount });
    }
    try {
      const payload = await api<{
        result?: { structuredContent?: unknown; content?: Array<{ text?: string }> };
        error?: { message?: string };
      }>("/api/mcp", {
        method: "POST",
        headers: { Accept: "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: tool, arguments: args },
        }),
      });
      if (payload.error !== undefined) {
        setError(payload.error.message ?? "Tool call failed.");
      } else {
        const value = payload.result?.structuredContent ?? payload.result?.content?.[0]?.text ?? "";
        setOutput(typeof value === "string" ? value : JSON.stringify(value, null, 2));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Tool call failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="playground">
      <div className="playground-controls">
        <label className="field">
          <span className="field-label">Tool</span>
          <select value={tool} onChange={(event) => setTool(event.target.value)} disabled={busy}>
            {TOOL_OPTIONS.map((option) => (
              <option key={option.name} value={option.name}>
                {option.name}
              </option>
            ))}
          </select>
        </label>
        {(tool === "kyrox_get_market" || tool === "kyrox_preview_quote") && (
          <label className="field">
            <span className="field-label">Symbol</span>
            <select
              value={symbol}
              onChange={(event) => setSymbol(event.target.value)}
              disabled={busy}
            >
              {DEMO_ASSETS.map((asset) => (
                <option key={asset.symbol} value={asset.symbol}>
                  {assetDisplayName(asset.symbol)} · {asset.underlying}
                </option>
              ))}
            </select>
          </label>
        )}
        {tool === "kyrox_preview_quote" && (
          <>
            <label className="field">
              <span className="field-label">Side</span>
              <select
                value={side}
                onChange={(event) => setSide(event.target.value)}
                disabled={busy}
              >
                <option value="buy">buy</option>
                <option value="sell">sell</option>
              </select>
            </label>
            <label className="field">
              <span className="field-label">Amount</span>
              <input
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                inputMode="decimal"
                disabled={busy}
              />
            </label>
          </>
        )}
        <button
          className="button button-primary"
          onClick={() => void run()}
          disabled={busy}
          type="button"
        >
          {busy ? "Calling…" : "Run tool"} <ArrowRight size={15} />
        </button>
      </div>
      <div className="playground-output">
        <div className="output-head">
          <span title={`${environmentShortLabel(environment)} · ${priceSourceLabel(environment)}`}>
            <CodeIcon size={14} /> JSON-RPC response
          </span>
          <CopyButton value={output} label="Copy output" />
        </div>
        {error.length > 0 && (
          <p className="form-error" role="alert" aria-live="assertive">
            {error}
          </p>
        )}
        <pre aria-live="polite">
          <code>
            {error.length > 0
              ? "// Request failed. See the error above."
              : output.length > 0
                ? output
                : `// ${environmentShortLabel(environment)} · choose a tool and run it to see the response.`}
          </code>
        </pre>
      </div>
    </div>
  );
}
