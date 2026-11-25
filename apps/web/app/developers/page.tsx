import type { Metadata } from "next";
import Link from "next/link";

import {
  DevelopersDataBadge,
  DevelopersEnvironmentMeta,
  DevelopersEnvironmentNote,
} from "../../components/environment-labels";
import { CopyButton, McpPlayground } from "../../components/mcp-playground";
import {
  ArrowUpRight,
  CodeIcon,
  InfoIcon,
  LayersIcon,
  ShieldIcon,
  SparkIcon,
  TerminalIcon,
} from "../../components/icons";
import { MCP_TOOLS } from "../../lib/mcp/server";
import { appUrl } from "../../lib/app-url";

export const metadata: Metadata = {
  title: "Developers & MCP",
  description:
    "Connect an AI agent to KYROX through a read-only MCP bridge: markets, history, deterministic quotes, and protocol status. No signing or transfer tools.",
};

export default function DevelopersPage() {
  const baseUrl = appUrl();
  const config = JSON.stringify(
    {
      mcpServers: {
        kyrox: {
          type: "http",
          url: `${baseUrl}/api/mcp`,
        },
      },
    },
    null,
    2,
  );
  const curl = `curl -s ${baseUrl}/api/mcp \\
  -H 'Content-Type: application/json' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`;

  return (
    <div className="page-width page-stack">
      <header className="page-head">
        <div>
          <p className="eyebrow">
            <CodeIcon size={14} /> Developers
          </p>
          <h1>Agent context without custody.</h1>
          <p className="page-lead">
            The KYROX MCP bridge speaks JSON-RPC over HTTP. It exposes read-only market data,
            deterministic quote previews, and honest environment status. It cannot sign, send, or
            transfer.
          </p>
        </div>
        <DevelopersEnvironmentMeta />
      </header>

      <div className="dev-grid">
        <section className="panel dev-card">
          <div className="panel-head">
            <div>
              <h2>Endpoint</h2>
              <p className="muted small">POST JSON-RPC 2.0. GET returns discovery metadata.</p>
            </div>
            <CopyButton value={`${baseUrl}/api/mcp`} label="Copy URL" />
          </div>
          <div className="endpoint-row">
            <span className="method-chip">POST</span>
            <code>{baseUrl}/api/mcp</code>
          </div>
          <div className="code-block">
            <div className="output-head">
              <span>tools/list</span>
              <CopyButton value={curl} />
            </div>
            <pre>
              <code>{curl}</code>
            </pre>
          </div>
          <ul className="mini-list">
            <li>No API key is required for read-only preview tools.</li>
            <li>GET returns server metadata and the tool catalogue.</li>
            <li>POST accepts JSON-RPC 2.0; notifications return 202.</li>
            <li>Responses include both text content and structured content.</li>
          </ul>
        </section>

        <section className="panel dev-card">
          <div className="panel-head">
            <div>
              <h2>Client configuration</h2>
              <p className="muted small">Add the bridge to an MCP-capable host.</p>
            </div>
            <CopyButton value={config} label="Copy config" />
          </div>
          <div className="code-block">
            <div className="output-head">
              <span>mcp.json</span>
            </div>
            <pre>
              <code>{config}</code>
            </pre>
          </div>
          <p className="muted small">
            Some hosts expect a top-level <code>mcpServers</code> object. No API key is required for
            read-only tools; the preview endpoint has no write capability.
          </p>
        </section>
      </div>

      <div className="callout callout-safe">
        <ShieldIcon size={17} />
        <p>
          <strong>Boundary:</strong> no signing, no transaction broadcast, no transfers, no
          arbitrary calldata. Quotes returned by the bridge are explicitly non-binding and never
          include a wallet intent.
        </p>
      </div>

      <section className="panel" id="tools">
        <div className="panel-head">
          <div>
            <h2>Available tools</h2>
            <p className="muted small">
              Read-only annotations: <code>readOnlyHint: true</code>,{" "}
              <code>destructiveHint: false</code>.
            </p>
          </div>
          <span className="sim-badge">{MCP_TOOLS.length} tools</span>
        </div>
        <div className="tool-list">
          {MCP_TOOLS.map((tool) => (
            <article className="tool-card" key={tool.name}>
              <div className="tool-head">
                <code>{tool.name}</code>
                <span className="pill">read-only</span>
              </div>
              <p>{tool.description}</p>
              {tool.inputSchema.required !== undefined && tool.inputSchema.required.length > 0 && (
                <div className="tool-args">
                  {tool.inputSchema.required.map((name) => (
                    <span key={name} className="pill pill-mono">
                      {name}
                    </span>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Try the bridge</h2>
            <p className="muted small">
              Calls the same JSON-RPC endpoint an agent would use. Responses reflect the current
              environment and retain per-observation simulation flags.
            </p>
          </div>
          <DevelopersDataBadge />
        </div>
        <McpPlayground />
      </section>

      <div className="dev-grid">
        <section className="panel dev-card">
          <h2>
            <TerminalIcon size={17} /> Local Python server
          </h2>
          <p className="muted small">
            The standalone <code>kyrox-mcp</code> package in <code>services/mcp-server</code> runs
            over STDIO with wallet reads, transaction preparation, simulation, and a deterministic
            safety policy. It is distributed separately from this web preview.
          </p>
          <div className="code-block">
            <div className="output-head">
              <span>terminal</span>
            </div>
            <pre>
              <code>{`cd services/mcp-server
python3 -m venv .venv
source .venv/bin/activate
python -m pip install ".[dev]"
kyrox-mcp`}</code>
            </pre>
          </div>
        </section>

        <section className="panel dev-card">
          <h2>
            <LayersIcon size={17} /> How the pieces fit
          </h2>
          <ul className="check-list">
            <li>
              <strong>Web app</strong> prepares quotes and wallet intents; the user signs.
            </li>
            <li>
              <strong>Quote engine</strong> is the same deterministic core used by the contracts
              tests.
            </li>
            <li>
              <strong>MCP bridge</strong> exposes read and quote tools only — no execution surface.
            </li>
            <li>
              <strong>Python MCP server</strong> adds local wallet reads and unsigned transaction
              preparation.
            </li>
            <li>
              <strong>Indexer and price service</strong> are scaffolded for a deployed venue; they
              are not running in the preview.
            </li>
          </ul>
          <Link className="text-link" href="/status">
            Inspect environment status <ArrowUpRight size={14} />
          </Link>
        </section>
      </div>

      <div className="callout">
        <InfoIcon size={16} />
        <p>
          <SparkIcon size={13} /> <DevelopersEnvironmentNote />
        </p>
      </div>

      <div className="inline-cta">
        <div>
          <strong>Building an agent integration?</strong>
          <span>Start with the read-only tools, then keep execution in the user's wallet.</span>
        </div>
        <Link className="button button-primary" href="/markets">
          Inspect a market <ArrowUpRight size={15} />
        </Link>
      </div>
    </div>
  );
}
