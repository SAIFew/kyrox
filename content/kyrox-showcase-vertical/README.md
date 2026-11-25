# KYROX Vertical Product Showcase

Standalone Remotion project for a 30-second portrait KYROX product showcase. It uses the current consumer app's graphite/mint palette, KYROX mark, and actual dashboard patterns (Balances, Reference, Trade, Activity). It is video-only and is outside the pnpm workspace.

## Reproduce

Requirements: Node.js 20+, npm, Python 3, FFmpeg, and a local Chrome or Chromium browser.

```sh
npm ci
python3 scripts/generate_audio.py
export CHROME_BIN="/path/to/Google Chrome"
npm run render
npm run poster
npm run contact-sheet
```

The final H.264 file is `output/KYROX-Product-Showcase.mp4` (1080 × 1920, 30 fps, 900 frames). Preview with `npm run preview`.

## Evidence boundary

The transaction flow comes from one successful execution of the repository's existing `pnpm local:e2e` harness. It used disposable PostgreSQL and local Anvil (`chainId 84532`), plus a Playwright-injected test wallet. It did not use Base Sepolia. The reference price and all token balances are local simulated data. The persistent on-screen label says `LOCAL ANVIL · SIMULATED · NO LIVE SEPOLIA DEPLOYMENT`.

See [`PRODUCTION_EVIDENCE.md`](PRODUCTION_EVIDENCE.md) for the exact captured outputs, test run, source lineage, and scene-to-evidence mapping.
