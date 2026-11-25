import { parseAbiItem, toEventSelector } from "viem";

/** Exchange trade event (must match `packages/contracts/src/KyroxExchange.sol`). */
export const TRADE_EVENT = parseAbiItem(
  "event Trade(address indexed trader, address indexed stockToken, bool indexed isBuy, uint256 usdcAmount, uint256 stockAmount, uint256 priceUsdcPerWholeToken, uint256 sourceRoundId, uint256 sourceUpdatedAt)",
);

/** TestUSDC welcome faucet event. */
export const WELCOME_CLAIMED_EVENT = parseAbiItem(
  "event WelcomeClaimed(address indexed account, uint256 amount)",
);

/** TestUSDC daily faucet event. */
export const DAILY_CLAIMED_EVENT = parseAbiItem(
  "event DailyClaimed(address indexed account, uint256 amount, uint256 nextClaimAt)",
);

export const TRADE_TOPIC = toEventSelector(TRADE_EVENT);
export const WELCOME_CLAIMED_TOPIC = toEventSelector(WELCOME_CLAIMED_EVENT);
export const DAILY_CLAIMED_TOPIC = toEventSelector(DAILY_CLAIMED_EVENT);
