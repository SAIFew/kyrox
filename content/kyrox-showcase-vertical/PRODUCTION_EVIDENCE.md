# Production evidence

## Captured execution

The values below are copied from a single successful `pnpm local:e2e` run. The smoke flow returned them together in one JSON object after checking the local portfolio and activity. The Playwright test then passed its UI checks, including the simulated-price disclosure and `Verified` activity label.

```json
{
  "authenticated": "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
  "quote": "0.002896051759349126",
  "intentHash": "0x755159c05cc1a6931aee7b7bfda84ac46439f8c96ceb36f0de7d662952eb6449",
  "txHash": "0x0efe967e2ac27850996a28e5e12cde243ebc2503a0be2f9812e1481c002fe113",
  "activityStatus": "verified",
  "portfolioTAApl": "2896051759349126"
}
```

The quote is `0.002896051759349126 tAAPL` for `1 tUSDC`. `portfolioTAApl` is the corresponding 18-decimal raw token amount. The `intentHash`, `txHash`, quote, and verified activity status are from that same run. On-screen shortened hashes preserve the captured prefix and suffix; full values remain above.

## Run environment and test result

- Command: `pnpm local:e2e`
- Temporary PostgreSQL: 16.16, loopback only
- Chain: disposable Anvil configured with chain ID 84532
- App mode: `local-anvil`
- Price source: seeded simulated local reference observation, not Chainlink
- Wallet: deterministic Anvil account exposed through the test harness
- Result: local smoke completed; Playwright **7 passed**
- No Base Sepolia endpoint, deployed contract, or live trading environment was used.

## Scene mapping

| Scene | Rendered information | Evidence source |
|---|---|---|
| 0–4s | KYROX consumer dashboard, local mode, no deployment statement | `apps/web/app/page.tsx`; `scripts/local-e2e.sh` |
| 4–9s | One-time nonce authentication, faucet and approval events, abbreviated local test account | `scripts/local-smoke.ts` output and local E2E assertions |
| 9–15s | Exact quote for 1 tUSDC and local simulated reference label | `scripts/local-smoke.ts`; `scripts/local-bootstrap.ts`; `apps/web/e2e/consumer.spec.ts` |
| 15–20s | Unsigned intent, exact abbreviated intent hash, wallet-review notice | `scripts/local-smoke.ts`; `apps/web/app/page.tsx` |
| 20–25s | Test harness wallet submission and exact abbreviated local transaction hash | `scripts/local-smoke.ts`; `apps/web/e2e/consumer.spec.ts` |
| 25–30s | Verified local activity and matching portfolio token amount | `scripts/local-smoke.ts`; `apps/web/e2e/consumer.spec.ts` |

## Visual source and limitations

- Brand mark is copied from `apps/web/app/icon.svg` into this isolated project's `public/` folder.
- Colors and card structure follow `apps/web/app/globals.css` and the Balances, Trade, and Activity sections in `apps/web/app/page.tsx`.
- The interface is a deterministic video recreation of the current app surface, not a claim that the rendered dashboard is a live capture.
- Every price, balance, account, and transaction shown belongs to the disposable local test harness. No profits, market movement, live confirmation, or Base Sepolia deployment is claimed.

## Final render and inspection

- H.264 video stream: 1080 × 1920, 30/1 fps, 30.000 seconds (900 frames).
- AAC audio stream: stereo, 48 kHz. The MP4 container reports 30.058667 seconds because the final AAC packet extends slightly beyond the 30-second video stream.
- Audio analysis: integrated loudness −16.4 LUFS, peak −3.5 dBFS; the original generated score fades at both ends and retains headroom without clipped peaks.
- The complete MP4 was decoded with FFmpeg without decode errors. Screenshots at 3, 7, 12, 17, 22, and 27 seconds and a 15-frame contact sheet were visually inspected. The quote, intent hash, transaction hash, submitted state, and verified state appear only after their corresponding story beats.
- Poster is an extracted frame at 11 seconds, during quote generation.
