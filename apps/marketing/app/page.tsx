const FLOW = [
  {
    step: "01",
    title: "Understand",
    body: "Market context and validated reference observations.",
  },
  {
    step: "02",
    title: "Quote",
    body: "Deterministic price, limits, and policy evaluation.",
  },
  {
    step: "03",
    title: "Review",
    body: "A readable intent before anything is signed.",
  },
  {
    step: "04",
    title: "Authorize",
    body: "Your wallet, your signature, your decision.",
  },
] as const;

const PRODUCT = [
  {
    title: "Financial data and market context",
    body: "Reference observations keep their original source timestamps and round ids. Weekend or stale data is presented as stale, not quietly refreshed into a confident number.",
    icon: "context",
  },
  {
    title: "Portfolio intelligence",
    body: "Balances and valuations use explicit decimal rules and reference prices. An unpriced position is marked as unpriced rather than folded into a reassuring total.",
    icon: "portfolio",
  },
  {
    title: "Transparent trade quotes",
    body: "A quote shows the reference price, expected output, minimum received, limits, source age, and expiry. It is recomputed when an intent is prepared.",
    icon: "quote",
  },
  {
    title: "Policy-constrained workflows",
    body: "Minimum and maximum size, daily limits, allowlists, freshness, and pause checks run in deterministic code. Preparation produces an unsigned intent, not an execution.",
    icon: "policy",
  },
] as const;

const PRINCIPLES = [
  {
    title: "User-held signing",
    body: "The user's wallet is the only signer. There is no service key that can move user funds.",
  },
  {
    title: "Read and quote only",
    body: "The agent boundary excludes signing, sending, transferring, and arbitrary calldata. Advice is not authority.",
  },
  {
    title: "Recomputation before preparation",
    body: "Price and policy are evaluated again at preparation time. A stale or mismatched quote fails closed.",
  },
  {
    title: "Provenance, not freshness theatre",
    body: "Source timestamps are preserved, and publication time is recorded separately from the original oracle update.",
  },
  {
    title: "Explicit environments",
    body: "Local development uses a loopback chain with simulated labels. Base Sepolia and mainnet are never interchangeable.",
  },
  {
    title: "Honest failure states",
    body: "A missing price, a closed market, or a paused venue blocks the path. The system does not invent a result.",
  },
] as const;

const STATUS = [
  {
    item: "Deterministic quote and policy engine",
    state: "Implemented locally",
    tone: "local",
  },
  {
    item: "Fixed-reference testnet exchange contracts",
    state: "Tested locally",
    tone: "local",
  },
  {
    item: "Wallet-authenticated consumer dashboard",
    state: "Local prototype",
    tone: "local",
  },
  {
    item: "Price ingestion and unsigned publication preparation",
    state: "Local implementation",
    tone: "local",
  },
  {
    item: "Event indexer",
    state: "Phase 2 · planned",
    tone: "planned",
  },
  {
    item: "AI agent tools",
    state: "Boundary defined · not orchestrated",
    tone: "planned",
  },
  {
    item: "Base Sepolia deployment",
    state: "Preparation ongoing",
    tone: "planned",
  },
  {
    item: "Mainnet live trading",
    state: "Not available",
    tone: "unavailable",
  },
] as const;

function CardIcon({ name }: { name: string }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.6,
  };
  return (
    <svg aria-hidden="true" className="card-icon" viewBox="0 0 32 32" {...common}>
      {name === "context" && (
        <>
          <path d="M5 22V10l7-4 7 4 8-4v16l-8 4-7-4-7 4Z" />
          <path d="M12 6v16M19 10v16" />
        </>
      )}
      {name === "portfolio" && (
        <>
          <path d="M5 25V15M12 25V9M19 25V13M26 25V6" />
          <path d="M3 25h26" />
        </>
      )}
      {name === "quote" && (
        <>
          <path d="M6 7h20M6 13h20M6 19h12" />
          <path d="M22 22l4 3-4 3" />
        </>
      )}
      {name === "policy" && (
        <>
          <path d="M16 4l10 4v7c0 6-4 10-10 13C10 25 6 21 6 15V8l10-4Z" />
          <path d="M11 16l4 4 7-8" />
        </>
      )}
    </svg>
  );
}

export default function HomePage() {
  return (
    <main className="site-main" id="main" tabIndex={-1}>
      <section className="hero" id="top" aria-labelledby="hero-title">
        <div className="wrap hero-grid">
          <div className="hero-copy">
            <p className="eyebrow">KYROX · in active development</p>
            <h1 id="hero-title">
              Onchain intelligence.
              <br />
              <span>Security by design.</span>
            </h1>
            <p className="hero-lead">
              KYROX is an AI-assisted onchain finance project. It is being built to turn market data
              into clear context, portfolio insight, and transparent trade quotes — while keeping
              every transaction under your review and your authorization.
            </p>
            <div className="hero-ctas">
              <a className="button" href="#how-it-works">
                See how it works
              </a>
              <a
                className="button button-ghost"
                href="https://x.com/Kyrox_io"
                rel="noopener noreferrer"
                target="_blank"
              >
                Follow the build
                <span aria-hidden="true">↗</span>
              </a>
            </div>
            <p className="hero-disclosure">
              Local consumer prototype. Base Sepolia preparation underway. No live trading, no
              mainnet deployment, and no real-world value on testnet.
            </p>
          </div>

          <div className="hero-visual" aria-label="Illustration of the KYROX authorization flow">
            <div className="workflow-card">
              <div className="workflow-head">
                <span>Authorization flow</span>
                <span className="workflow-tag">Design illustration</span>
              </div>
              <ol className="workflow-list">
                {FLOW.map((item) => (
                  <li key={item.step}>
                    <span className="workflow-step">{item.step}</span>
                    <div>
                      <strong>{item.title}</strong>
                      <p>{item.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
              <p className="workflow-foot">
                The AI is designed not to hold signing keys or independently authorize a
                transaction.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="section" id="product" aria-labelledby="product-title">
        <div className="wrap">
          <div className="section-head">
            <p className="eyebrow">Product</p>
            <h2 id="product-title">Built for decisions you can inspect.</h2>
            <p className="section-lead">
              Four parts of the same discipline: better context, clearer numbers, and no hidden
              execution between the recommendation and the wallet.
            </p>
          </div>
          <div className="product-grid">
            {PRODUCT.map((item) => (
              <article className="product-card" key={item.title}>
                <CardIcon name={item.icon} />
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section section-alt" id="how-it-works" aria-labelledby="how-title">
        <div className="wrap">
          <div className="section-head">
            <p className="eyebrow">Design</p>
            <h2 id="how-title">From raw data to a decision you authorize.</h2>
            <p className="section-lead">
              The intended workflow deliberately separates understanding, pricing, review, and
              authorization. Each step is inspectable on its own.
            </p>
          </div>
          <ol className="steps-grid">
            {FLOW.map((item) => (
              <li key={item.step}>
                <span className="step-number">{item.step}</span>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="section" id="security" aria-labelledby="security-title">
        <div className="wrap">
          <div className="section-head">
            <p className="eyebrow">Security philosophy</p>
            <h2 id="security-title">The assistant advises. Only you authorize.</h2>
            <p className="section-lead">
              KYROX treats authorization as a separate, user-owned boundary rather than a
              convenience feature the system can quietly absorb.
            </p>
          </div>
          <div className="principle-grid">
            {PRINCIPLES.map((item) => (
              <article className="principle" key={item.title}>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </article>
            ))}
          </div>
          <aside className="callout" aria-label="Agent execution boundary">
            <h3>No independent AI execution</h3>
            <p>
              The current agent boundary permits read and quote capabilities only. Agent
              orchestration is not yet implemented. When it is built, the wallet remains the only
              authorization point.
            </p>
          </aside>
        </div>
      </section>

      <section className="section section-alt" id="status" aria-labelledby="status-title">
        <div className="wrap">
          <div className="section-head">
            <p className="eyebrow">Development status</p>
            <h2 id="status-title">Where the work stands.</h2>
            <p className="section-lead">
              Straightforward status rather than roadmap theatre. “Local” means tested on a
              developer machine against a disposable chain and database. It does not mean deployed,
              audited, or open to the public.
            </p>
          </div>
          <div className="status-table" role="table" aria-label="KYROX development status">
            {STATUS.map((row) => (
              <div className="status-row" role="row" key={row.item}>
                <span role="cell">{row.item}</span>
                <span className={`status-pill status-${row.tone}`} role="cell">
                  {row.state}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section invitation" aria-labelledby="invitation-title">
        <div className="wrap invitation-inner">
          <div>
            <p className="eyebrow">Base ecosystem</p>
            <h2 id="invitation-title">Building toward Base Sepolia.</h2>
            <p className="section-lead">
              The next milestone is a verified Base Sepolia testnet deployment and a durable event
              indexer. Testnet assets will remain simulations with no cash value. If you are
              designing careful onchain products in the Base ecosystem, we would like to compare
              notes.
            </p>
          </div>
          <div className="invitation-action">
            <a
              className="button"
              href="https://x.com/Kyrox_io"
              rel="noopener noreferrer"
              target="_blank"
            >
              Follow @Kyrox_io
              <span aria-hidden="true">↗</span>
            </a>
            <p>An invitation to follow the work — not a partnership or endorsement claim.</p>
          </div>
        </div>
      </section>
    </main>
  );
}
