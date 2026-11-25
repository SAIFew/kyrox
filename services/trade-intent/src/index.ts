export { IntentError, prepareTradeIntent } from "./intent.js";
export type { CanonicalObservation, CanonicalObservationReader } from "./observation.js";
export type {
  IntentErrorCode,
  PrepareTradeIntentParams,
  PreparedTradeIntent,
  SepoliaTokenReader,
} from "./intent.js";

export const TRADE_INTENT_SERVICE = {
  name: "kyrox-trade-intent",
  chainEnv: "base-sepolia",
  status: "phase-1-unsigned-intent-preparation",
} as const;

export { InMemoryIssuedQuoteStore, QuoteService, QuoteServiceError } from "./quotes.js";
export type {
  AuthenticatedSession,
  IssueQuoteParams,
  IssuedQuoteRecord,
  IssuedQuoteResult,
  IssuedQuoteStore,
  PrepareIssuedIntentParams,
  PreparedIssuedIntent,
  TrustedPolicySource,
} from "./quotes.js";
