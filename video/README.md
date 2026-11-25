# KYROX product demo production

This directory preserves the production assets for `kyrox-product-demo.mp4`.

- `record-kyrox-demo.mjs` records the deployed public preview from Chromium at 1920 × 1080. It follows only real website navigation, search, chart, public-preview, quote, simulated-fill, activity, and MCP-playground interactions. It adds only a presentation cursor and restrained caption layer; every product surface is rendered from the live site.
- `raw/` holds the source WebM screen recording.
- `captions/kyrox-product-demo.ass` preserves the caption copy and styling reference; the capture script embeds the cues because the available FFmpeg build has no subtitle-overlay filter.
- `render-kyrox-demo.sh` creates the 30 fps H.264 final MP4 and mixes the repository's existing instrumental score at a low level.

The capture intentionally selects **Continue with preview account** after displaying the actual non-custodial wallet interface. The public deployment is labelled simulated: no wallet key, signing credential, real balance, or blockchain transaction is used or portrayed.

To reproduce:

```sh
node video/record-kyrox-demo.mjs
bash video/render-kyrox-demo.sh
```
