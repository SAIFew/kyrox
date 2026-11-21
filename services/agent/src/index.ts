/**
 * Frozen Phase 0 agent boundary.
 *
 * The consumer assistant may read state and request quotes. It must never be
 * given a tool that signs, sends, executes, or builds arbitrary calldata. Any
 * future tool must be reviewed against this policy and the threat model.
 */
export const AGENT_TOOL_POLICY = {
  mode: "read-and-quote-only",
  canSign: false,
  canExecute: false,
  canBuildArbitraryCalldata: false,
  canTransfer: false,
} as const;

export const FORBIDDEN_AGENT_TOOL_NAMES = [
  "sign",
  "sign_transaction",
  "send",
  "send_transaction",
  "send_raw_transaction",
  "execute",
  "transfer",
  "prepare_transaction",
  "write_contract",
] as const;

export type AgentToolPolicy = typeof AGENT_TOOL_POLICY;
