import { describe, expect, it } from "vitest";

import { AGENT_TOOL_POLICY, FORBIDDEN_AGENT_TOOL_NAMES } from "../src/index.js";

describe("agent tool boundary", () => {
  it("freezes the agent to read and quote access only", () => {
    expect(AGENT_TOOL_POLICY.mode).toBe("read-and-quote-only");
    expect(AGENT_TOOL_POLICY.canSign).toBe(false);
    expect(AGENT_TOOL_POLICY.canExecute).toBe(false);
    expect(AGENT_TOOL_POLICY.canBuildArbitraryCalldata).toBe(false);
    expect(AGENT_TOOL_POLICY.canTransfer).toBe(false);
  });

  it("names the forbidden capability set explicitly", () => {
    expect(FORBIDDEN_AGENT_TOOL_NAMES).toContain("sign_transaction");
    expect(FORBIDDEN_AGENT_TOOL_NAMES).toContain("send_raw_transaction");
    expect(FORBIDDEN_AGENT_TOOL_NAMES).toContain("prepare_transaction");
    expect(FORBIDDEN_AGENT_TOOL_NAMES).toContain("write_contract");
  });
});
