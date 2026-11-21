# ADR-0005: Agent tool boundary

- **Status:** Accepted
- **Date:** 2026-11-21
- **Phase:** 0

## Context

The existing MCP server exposes `prepare_transaction`, which builds an unsigned
transfer intent. That is acceptable for a developer-facing MCP client, but a
consumer-facing assistant must not be able to construct or submit transactions
on a user's behalf.

Prompt injection, tool confusion, and model error are realistic failure modes.
The audit recommended exposing only read and quote capabilities to the LLM.

## Decision

The consumer agent may use:

- read-only catalogue, portfolio, price, and status tools;
- quote-request tools that return a server-computed quote;
- explanatory tools that describe policy outcomes.

The agent must never receive tools that:

- sign or send transactions;
- build arbitrary calldata;
- transfer tokens;
- change policy, roles, or the kill switch;
- read secrets or raw credentials.

The user's wallet is the only signer. The server recomputes price and policy at
approval time and rejects a quote that no longer matches.

## Consequences

- The agent cannot execute even if prompt-injected.
- Trade execution lives in a deterministic, reviewed user flow.
- Tool schemas become a security boundary and need tests.
- Some conversational requests must be handed off to the UI rather than
  completed by the model.

## Alternatives considered

- **Give the agent the existing `prepare_transaction` tool.** Rejected:
  arbitrary recipient and amount are too powerful for a consumer surface.
- **Let the agent call a signed server endpoint.** Rejected: violates the rule
  that only the user's wallet signs.
