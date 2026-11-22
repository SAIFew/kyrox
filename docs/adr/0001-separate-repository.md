# ADR-0001: Separate `kyrox-app` repository

- **Status:** Superseded by [ADR-0011](0011-unified-monorepo-and-policy-surface-separation.md) (originally Accepted on 2026-11-21)
- **Date:** 2026-11-21
- **Phase:** 0

## Context

The existing `kyrox-mcp` repository is a Python, STDIO-only MCP server for AI
agents. The new product is a Next.js consumer application with a TypeScript
backend, PostgreSQL, an indexer, Foundry contracts, and a Vercel deployment.
The two have different runtimes, dependency ecosystems, secrets, release
cadences, and deploy targets.

The audit recommended preserving the Python package while building the
consumer product separately.

## Decision

Create a new sibling repository, `kyrox-app`, for the consumer application.

`kyrox-mcp` is not moved, rewritten, or modified by this repository. It remains
a distributable MCP package and will eventually become an adapter to the
`kyrox-app` API.

## Consequences

- Independent CI, dependencies, and releases.
- No Node tooling enters the Python package and no Python tooling enters the
  web application.
- The API boundary between the two repositories must be designed explicitly.
- Contract ABIs must be published as an artifact the MCP adapter can consume.
- Two repositories must be kept in sync at the contract and policy level via
  versioned packages and golden vectors.

## Alternatives considered

- **Monorepo combining Python and TypeScript.** Rejected: mixed toolchains,
  slower CI, and a higher risk of accidentally coupling the MCP server to the
  web app.
- **Extend `kyrox-mcp` into a web app.** Rejected: it would break the existing
  package's scope, tests, and portability.
