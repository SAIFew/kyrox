import Link from "next/link";

import { HeroMarket, LandingMarkets } from "../components/live-markets";
import {
  LandingEnvironmentDisclosure,
  LandingNetworkLabel,
  LandingStatusGrid,
} from "../components/environment-labels";
import {
  ArrowRight,
  ArrowUpRight,
  ChartIcon,
  CodeIcon,
  LayersIcon,
  LockIcon,
  ShieldIcon,
  SparkIcon,
} from "../components/icons";

const STEPS = [
  {
    step: "01",
    title: "Read the market",
    body: "Every instrument shows its reference price, source age, and explicit simulation status. Stale data is never dressed up as fresh.",
  },
  {
    step: "02",
    title: "Get a deterministic quote",
    body: "Integer-only maths, floor rounding, slippage bounds, size limits, and freshness checks run before you see a number.",
  },
  {
    step: "03",
    title: "Review the intent",
    body: "The exact destination, amount, minimum received, and deadline are prepared for review. Nothing is signed by KYROX.",
  },
  {
    step: "04",
    title: "Authorise in your wallet",
    body: "Your wallet is the only signer. The demo venue simulates the fill; a testnet venue settles on its configured chain.",
  },
] as const;

const PILLARS = [
  {
    icon: ChartIcon,
    title: "Reference-price venue",
    body: "No AMM, no routing, no hidden spread. Buy and sell against a published reference price with explicit bounds.",
  },
  {
    icon: ShieldIcon,
    title: "Policy before execution",
    body: "Minimum and maximum size, a 5,000 test USDC unit daily cap, asset allowlists, pause state, and fresh prices are enforced in code.",
  },
  {
    icon: LockIcon,
    title: "Non-custodial by construction",
    body: "No service key can move user funds. The interface prepares; the user authorises. Simulated fills are labelled as such.",
  },
  {
    icon: CodeIcon,
    title: "Agent-ready boundary",
    body: "A read-only MCP bridge exposes markets, history, quotes, and status. There is no sign, send, transfer, or arbitrary-calldata tool.",
  },
] as const;

export default function HomePage() {
  return (
    <>
      <section className="hero-section">
        <div className="page-width hero-layout">
          <div className="hero-copy">
            <p className="eyebrow">
              <span className="eyebrow-dot" />
              Tokenized equities · Base
            </p>
            <h1>
              Access the market.
              <br />
              <span className="gradient-text">Keep the proof.</span>
            </h1>
            <p className="hero-lead">
              KYROX turns tokenized equity exposure into a transparent, policy-constrained workflow.
              Source-timestamped prices, deterministic quotes, and a wallet that never leaves your
              hands.
            </p>
            <div className="hero-ctas">
              <Link className="button button-primary button-large" href="/markets">
                Explore markets <ArrowRight size={17} />
              </Link>
              <Link className="button button-ghost button-large" href="/developers">
                <CodeIcon size={16} /> Agent bridge
              </Link>
            </div>
            <LandingEnvironmentDisclosure />
            <p className="muted small">
              Test tokens. No real value. Not real shares. Not investment advice.
            </p>
            <dl className="hero-metrics">
              <div>
                <dt>Quote engine</dt>
                <dd>Integer-only</dd>
              </div>
              <div>
                <dt>Signing</dt>
                <dd>Wallet-held</dd>
              </div>
              <div>
                <dt>Agent tools</dt>
                <dd>Read-only</dd>
              </div>
            </dl>
          </div>
          <div className="hero-visual">
            <HeroMarket />
            <div className="float-card float-card-quote">
              <span className="float-icon">
                <LockIcon size={15} />
              </span>
              <div>
                <strong>Nothing signed by KYROX</strong>
                <small>Every fill requires your authorisation</small>
              </div>
            </div>
            <div className="float-card float-card-provenance">
              <span className="float-icon">
                <LayersIcon size={15} />
              </span>
              <div>
                <strong>Provenance preserved</strong>
                <small>Source timestamp ≠ observation time</small>
              </div>
            </div>
          </div>
        </div>
        <div className="page-width trust-strip">
          <LandingNetworkLabel />
          <span className="trust-sep" />
          <span>Deterministic policy engine</span>
          <span className="trust-sep" />
          <span>Model Context Protocol</span>
          <span className="trust-sep" />
          <span>User-held signing</span>
        </div>
      </section>

      <section className="section page-width" id="markets">
        <div className="section-head">
          <div>
            <p className="eyebrow">Reference markets</p>
            <h2>Seven instruments. One honest venue.</h2>
          </div>
          <Link className="text-link" href="/markets">
            View all markets <ArrowUpRight size={15} />
          </Link>
        </div>
        <LandingMarkets />
      </section>

      <section className="section page-width" id="how-it-works">
        <div className="section-head">
          <div>
            <p className="eyebrow">How it works</p>
            <h2>Clear steps, no black boxes.</h2>
          </div>
          <p className="section-note">
            A quote is a promise with an expiry. An intent is a request. Only a wallet signature is
            authority.
          </p>
        </div>
        <div className="steps-grid">
          {STEPS.map((item) => (
            <article className="step-card" key={item.step}>
              <span className="step-number">{item.step}</span>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section page-width" id="product">
        <div className="split-panel">
          <div className="split-copy">
            <p className="eyebrow">Designed for trust</p>
            <h2>A fintech surface with an engineering spine.</h2>
            <p>
              KYROX is built as one coherent product: a consumer application, a deterministic quote
              engine, a read-only agent bridge, and honest environment labels. Nothing is presented
              as live when it is simulated.
            </p>
            <Link className="button button-ghost" href="/status">
              Inspect system status <ArrowUpRight size={15} />
            </Link>
          </div>
          <div className="pillar-grid">
            {PILLARS.map((pillar) => {
              const Icon = pillar.icon;
              return (
                <article className="pillar" key={pillar.title}>
                  <span className="pillar-icon">
                    <Icon size={18} />
                  </span>
                  <h3>{pillar.title}</h3>
                  <p>{pillar.body}</p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="section page-width" id="agents">
        <div className="agent-panel">
          <div className="agent-copy">
            <p className="eyebrow">
              <SparkIcon size={14} /> For AI agents
            </p>
            <h2>Give an agent context, not custody.</h2>
            <p>
              The KYROX MCP bridge exposes read-only tools over JSON-RPC: markets, history,
              deterministic quotes, and environment status. No signing. No transfers. No arbitrary
              calldata.
            </p>
            <div className="agent-actions">
              <Link className="button button-primary" href="/developers">
                Open developer docs <ArrowRight size={16} />
              </Link>
              <a
                className="button button-ghost"
                href="/api/mcp"
                target="_blank"
                rel="noopener noreferrer"
              >
                Inspect endpoint <ArrowUpRight size={15} />
              </a>
            </div>
          </div>
          <div className="terminal">
            <div className="terminal-head">
              <span className="terminal-dots">
                <i />
                <i />
                <i />
              </span>
              <span>mcp · tools/list</span>
            </div>
            <pre>
              <code>{`{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "tools": [
      { "name": "kyrox_list_markets" },
      { "name": "kyrox_get_market" },
      { "name": "kyrox_preview_quote" },
      { "name": "kyrox_get_protocol_status" }
    ]
  }
}

// boundary
{ "canSign": false,
  "canSend": false,
  "canTransfer": false }`}</code>
            </pre>
          </div>
        </div>
      </section>

      <section className="section page-width" id="status">
        <div className="section-head">
          <div>
            <p className="eyebrow">Radical clarity</p>
            <h2>What is live, and what is not.</h2>
          </div>
          <Link className="text-link" href="/status">
            Full status page <ArrowUpRight size={15} />
          </Link>
        </div>
        <LandingStatusGrid />
      </section>

      <section className="section page-width">
        <div className="cta-panel">
          <div>
            <p className="eyebrow">Start with the workflow</p>
            <h2>See the full workflow today.</h2>
            <p>
              Use the simulated preview account where available, or connect a testnet wallet. Review
              quotes, follow the authorised flow, and inspect every provenance label.
            </p>
          </div>
          <div className="cta-actions">
            <Link className="button button-primary button-large" href="/portfolio">
              Open portfolio <ArrowRight size={17} />
            </Link>
            <Link className="button button-ghost button-large" href="/markets">
              Browse markets
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
