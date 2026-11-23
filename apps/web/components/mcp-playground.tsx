"use client";

import { useState } from "react";

import { CodeIcon, CopyIcon, CheckIcon, ArrowRight } from "./icons";

const TOOL_OPTIONS = [
  { name: "kyrox_list_markets", args: {} },
  { name: "kyrox_get_market", args: { symbol: "tAAPL", range: "1W" } },
  { name: "kyrox_preview_quote", args: { symbol: "tAAPL", side: "buy", amount: "250" } },
  { name: "kyrox_get_protocol_status", args: {} },
] as const;

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="copy-button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1_600);
        } catch {
          setCopied(false);
        }
      }}
      type="button"
    >
      {copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
      {copied ? "Copied" : label}
    </button>
  );
}

export function McpPlayground() {
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
      const response = await fetch("/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: tool, arguments: args },
        }),
      });
      const payload = (await response.json()) as {
        result?: { structuredContent?: unknown; content?: Array<{ text?: string }> };
        error?: { message?: string };
      };
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
          <select value={tool} onChange={(event) => setTool(event.target.value)}>
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
            <select value={symbol} onChange={(event) => setSymbol(event.target.value)}>
              <option value="tAAPL">tAAPL</option>
              <option value="tTSLA">tTSLA</option>
              <option value="tNVDA">tNVDA</option>
            </select>
          </label>
        )}
        {tool === "kyrox_preview_quote" && (
          <>
            <label className="field">
              <span className="field-label">Side</span>
              <select value={side} onChange={(event) => setSide(event.target.value)}>
                <option value="buy">buy</option>
                <option value="sell">sell</option>
              </select>
            </label>
            <label className="field">
              <span className="field-label">Amount</span>
              <input value={amount} onChange={(event) => setAmount(event.target.value)} />
            </label>
          </>
        )}
        <button className="button button-primary" onClick={() => void run()} disabled={busy}>
          {busy ? "Calling…" : "Run tool"} <ArrowRight size={15} />
        </button>
      </div>
      <div className="playground-output">
        <div className="output-head">
          <span>
            <CodeIcon size={14} /> JSON-RPC response
          </span>
          <CopyButton value={output} label="Copy output" />
        </div>
        <pre>
          <code>
            {error.length > 0
              ? `// ${error}`
              : output.length > 0
                ? output
                : "// Choose a tool and run it to see a live response."}
          </code>
        </pre>
      </div>
    </div>
  );
}
