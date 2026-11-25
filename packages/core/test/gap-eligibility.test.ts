import { describe, expect, it } from "vitest";

import {
  CURRENT_ELIGIBILITY_TERMS_VERSION,
  describeEligibilityReason,
  evaluateEligibility,
} from "../src/eligibility.js";
import { assessGap } from "../src/gap.js";
import {
  TESTNET_POLICY_CEILING,
  resolveEditablePolicy,
  tradePolicyFromEditable,
} from "../src/policy.js";

const REFERENCE = 100_000_000_000n; // $100,000 in 6-decimal units

describe("Weekend Gap Guard", () => {
  it("allows small gaps, warns at 2%, and blocks at 5%", () => {
    expect(assessGap(REFERENCE, REFERENCE).action).toBe("allow");
    expect(assessGap((REFERENCE * 102n) / 100n, REFERENCE).action).toBe("warn");
    expect(assessGap((REFERENCE * 95n) / 100n, REFERENCE).action).toBe("block");
    expect(assessGap((REFERENCE * 105n) / 100n, REFERENCE).action).toBe("block");
  });

  it("fails closed on invalid prices", () => {
    expect(assessGap(0n, REFERENCE).action).toBe("block");
    expect(assessGap(REFERENCE, 0n).action).toBe("block");
  });
});

describe("eligibility mechanics", () => {
  const base = {
    countryCode: "IN",
    nonUsAttested: true,
    acceptedTermsVersion: CURRENT_ELIGIBILITY_TERMS_VERSION,
    requiredTermsVersion: CURRENT_ELIGIBILITY_TERMS_VERSION,
    blockedCountryCodes: [],
  };

  it("accepts a valid non-US attestation with current terms", () => {
    expect(evaluateEligibility(base)).toEqual({ eligible: true, reasons: [] });
  });

  it("blocks US persons, configured countries, and missing attestations", () => {
    expect(evaluateEligibility({ ...base, countryCode: "US" }).reasons).toContain(
      "COUNTRY_BLOCKED",
    );
    expect(
      evaluateEligibility({ ...base, countryCode: "KP", blockedCountryCodes: ["KP"] }).reasons,
    ).toContain("COUNTRY_BLOCKED");
    expect(
      evaluateEligibility({ ...base, countryCode: "KP", blockedCountryCodes: ["KP"] }).eligible,
    ).toBe(false);
    expect(evaluateEligibility({ ...base, nonUsAttested: false }).reasons).toContain(
      "US_PERSON_NOT_ATTESTED",
    );
    expect(evaluateEligibility({ ...base, acceptedTermsVersion: "old" }).reasons).toContain(
      "TERMS_NOT_ACCEPTED",
    );
    expect(describeEligibilityReason("COUNTRY_BLOCKED")).toContain("not available");
  });
});

describe("editable policy", () => {
  it("defaults to the launch policy", () => {
    const policy = resolveEditablePolicy({});
    expect(policy.maxTradeUsdc).toBe(TESTNET_POLICY_CEILING.maxTradeUsdc);
    expect(policy.tradingEnabled).toBe(true);
    expect(tradePolicyFromEditable(policy).allowedAssets).toHaveLength(7);
  });

  it("allows tightening but never widening", () => {
    const tightened = resolveEditablePolicy({
      minTradeUsdc: 2_000_000n,
      maxTradeUsdc: 500_000_000n,
      dailyLimitUsdc: 1_000_000_000n,
      allowedAssets: ["tAAPL", "tNVDA"],
      tradingEnabled: false,
    });
    expect(tightened.allowedAssets).toEqual(["tAAPL", "tNVDA"]);
    expect(tightened.tradingEnabled).toBe(false);

    expect(() => resolveEditablePolicy({ maxTradeUsdc: 2_000_000_000n })).toThrow(/launch maximum/);
    expect(() => resolveEditablePolicy({ allowedAssets: [] })).toThrow(/At least one/);
    expect(() => resolveEditablePolicy({ allowedAssets: ["tFAKE"] })).toThrow(/unlisted/);
  });
});
