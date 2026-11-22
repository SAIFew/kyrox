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

## Phase 0 completion film

`KyroxPhase0Film` is a separate 38-second, 1080 × 1800, 30 fps Remotion composition with six reusable scenes. The art direction uses graphite, muted electric cyan, original SVG geometry and deterministic frame-driven motion. The accompanying WAV score is synthesized locally from Python's standard library; it uses no samples or third-party music.

### Preview and reproduce

Requires Node.js, npm, Python 3, and a local Google Chrome or Chromium executable. Remotion uses `CHROME_BIN` when set; this avoids downloading its headless browser.

```sh
npm ci
python3 assets/generate_score.py
export CHROME_BIN="/path/to/Google Chrome"
npm run preview:phase0
# Open http://localhost:3000/KyroxPhase0Film
npm run render:phase0
npm run poster:phase0
```

The MP4 and poster are written to `final/`. The preview command starts Remotion Studio on port 3000; open the composition URL above to load the Phase 0 film.

### Phase 0 proof labels

The film uses the current workspace evidence: 78 tracked files, 7 architecture decisions recorded in `planning/DAILY_LOG.md`, and 394+ tests documented in the repository README. A GitHub Actions workflow is not present, so the scene labels CI as unconfigured instead of claiming a passing run. The agent-boundary scene says transfers without approval are blocked; KYROX can prepare and simulate unsigned transaction intents, but it cannot sign or broadcast them. Base mainnet read-only and Base Sepolia write-target are presented as accepted architecture, not live integrations.

The original brief supplied different figures (58 files and 12/12 tests) and requested “GitHub Actions passing” and read/quote-only behavior. Those claims do not match the repository state inspected for this render, so the film shows the workspace-backed labels above.
