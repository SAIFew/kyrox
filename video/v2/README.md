# Version 2 production

Version 2 keeps a real browser capture of the deployed KYROX public preview as its main visual, with restrained captions and quiet instrumental music. The current MP4 is music-only. The live deployment still shows the older `tAAPL` and `tUSDC` labels; the source changes that replace those display labels are local and need a deployment before they can appear in a new live-site capture.

The capture uses the preview account. Wallet authentication is shown, but no wallet key, real holding, real market price, or on-chain trade is used or claimed. The read-only MCP playground is exercised on the deployed site.

Files:

- `narration.md` — narration script and factual claims retained as production notes.
- `voiceover.txt` and `narration.aiff` — optional narration source assets; not mixed into the current MP4.
- `record-kyrox-demo-v2.mjs` — real Chromium capture and caption overlay.
- `raw/` — original browser recording.
- `render-kyrox-demo-v2.sh` — 30 fps H.264 MP4 export with narration and the existing low-level score.

The ready-to-send mainnet assistance message is in `../mainnet-guidance-request.md`. It is a draft only.
