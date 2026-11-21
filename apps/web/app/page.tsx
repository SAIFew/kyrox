const ARCHITECTURE = [
  {
    name: "packages/core",
    role: "Deterministic quote and policy logic. Application source of truth.",
  },
  {
    name: "packages/db",
    role: "Drizzle schema and PostgreSQL access.",
  },
  {
    name: "packages/contracts",
    role: "Foundry contracts. Nothing deployed in Phase 0.",
  },
  {
    name: "services/agent",
    role: "Read-only and quote-only LLM tools. No signing or execution.",
  },
  {
    name: "services/indexer",
    role: "Onchain event indexing with checkpoints and reorg handling.",
  },
  {
    name: "services/price",
    role: "Oracle ingestion that preserves source timestamps and round ids.",
  },
] as const;

const BOUNDARIES = [
  "Base Sepolia only (chainId 84532). No mainnet switching.",
  "The user wallet is the only transaction signer.",
  "The agent cannot sign, execute, or construct arbitrary calldata.",
  "Prices retain their original source timestamp and round id.",
  "No secrets are exposed through NEXT_PUBLIC variables.",
] as const;

export default function HomePage() {
  return (
    <main className="page">
      <header className="hero">
        <p className="eyebrow">Phase 0 · architecture freeze</p>
        <h1>KYROX</h1>
        <p className="lede">
          Consumer application scaffold for the Base Sepolia testnet MVP. This build contains no
          trading, no wallet connection, and no deployed contracts.
        </p>
        <p className="badge">TESTNET ONLY · NO REAL-MONEY TRADING</p>
      </header>

      <section aria-labelledby="architecture-heading">
        <h2 id="architecture-heading">Workspace</h2>
        <ul className="cards">
          {ARCHITECTURE.map((item) => (
            <li key={item.name} className="card">
              <code>{item.name}</code>
              <p>{item.role}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="boundaries-heading">
        <h2 id="boundaries-heading">Safety boundaries</h2>
        <ul className="list">
          {BOUNDARIES.map((boundary) => (
            <li key={boundary}>{boundary}</li>
          ))}
        </ul>
      </section>

      <footer className="footer">
        <p>Phase 0 scaffold. Features arrive only after an approved milestone.</p>
      </footer>
    </main>
  );
}
