# KYROX Product Launch Film

A portrait Remotion film introducing KYROX's existing MCP tools and their current implementation status. Production source, brand asset, original soundtrack source, storyboard, and the H.264 deliverable live in this folder. No MCP server files or dependencies are changed.

## Preview and render

Requires Node.js 20+ and npm.

```powershell
npm install
npm run preview
npm run render
```

The final H.264 file is `final/KYROX_Product_Launch_Film.mp4` (1080 × 1920, 30 fps, 38 seconds). `npm run still` renders a single frame to `renders/preview/hero.png`.

The score is original synthesized audio. To regenerate it with Python's standard library:

```powershell
python assets/generate_score.py
```

See [STORYBOARD.md](STORYBOARD.md) for the timed scene breakdown and factual labels. Product values are local mock fixtures; wallet reads remain in progress pending verified Base Sepolia contract addresses. Transaction preparation, simulation, signing and broadcasting are not shown as implemented capabilities.
