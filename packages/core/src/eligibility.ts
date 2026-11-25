/**
 * Eligibility gate primitives for the future mainnet flow.
 *
 * The legal decision is BLOCKED: target countries, the exact blocked-country
 * list, and the terms text require counsel. These functions implement the
 * deterministic mechanism only, with the blocked list supplied by configuration
 * rather than invented here. Testnet does not use this gate.
 */

export interface EligibilityInput {
  readonly countryCode: string;
  readonly nonUsAttested: boolean;
  readonly acceptedTermsVersion: string | null;
  readonly requiredTermsVersion: string;
  readonly blockedCountryCodes: readonly string[];
}

export type EligibilityReason =
  "COUNTRY_BLOCKED" | "US_PERSON_NOT_ATTESTED" | "TERMS_NOT_ACCEPTED" | "INVALID_COUNTRY";

export interface EligibilityDecision {
  readonly eligible: boolean;
  readonly reasons: readonly EligibilityReason[];
}

/** ISO 3166-1 alpha-2, normalized to upper case. */
export function normalizeCountryCode(value: string): string | null {
  const code = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

export function evaluateEligibility(input: EligibilityInput): EligibilityDecision {
  const reasons: EligibilityReason[] = [];
  const country = normalizeCountryCode(input.countryCode);
  if (country === null) {
    reasons.push("INVALID_COUNTRY");
  } else {
    const blocked = new Set(input.blockedCountryCodes.map((code) => code.toUpperCase()));
    // The US-person restriction is a product rule, not a country-list option.
    if (country === "US" || blocked.has(country)) reasons.push("COUNTRY_BLOCKED");
  }
  if (!input.nonUsAttested) reasons.push("US_PERSON_NOT_ATTESTED");
  if (input.acceptedTermsVersion !== input.requiredTermsVersion) {
    reasons.push("TERMS_NOT_ACCEPTED");
  }
  return { eligible: reasons.length === 0, reasons };
}

export function describeEligibilityReason(reason: EligibilityReason): string {
  switch (reason) {
    case "COUNTRY_BLOCKED":
      return "Trading is not available where you live. Read-only market data remains available.";
    case "US_PERSON_NOT_ATTESTED":
      return "You must confirm that you are not a US person.";
    case "TERMS_NOT_ACCEPTED":
      return "Accept the current eligibility terms before trading.";
    case "INVALID_COUNTRY":
      return "Choose a valid country of residence.";
  }
}

/** Terms are versioned so a material change requires re-acceptance. */
export const CURRENT_ELIGIBILITY_TERMS_VERSION = "mainnet-eligibility-v1";
