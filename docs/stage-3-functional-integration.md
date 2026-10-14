# Stage 3 — desktop/Core integration

2026-10-14 · `stage3/shipping-candidate` · base `5037d24` · Apache-2.0 foundation pin unchanged.

The React/Electron app now has an `aiking-core` provider driver alongside all existing engines. Setup bundles
Core v0.2 for Electron's Node runtime; the Solid/Bun gateway remains available separately. The host still owns
model selection, turns, jobs, groups, tool approvals, MCP configuration and UI persistence.

Core streams into the existing activity/chat UI, uses reviewed enabled skill snapshots, applies tool scope
to discovery and execution, connects stdio/HTTP/SSE MCP, forwards permission cards, and cancels model/tool
requests. Instance/bot/thread IDs hash into private transcript/state files; reset uses a new generation.
Completed turns save atomically. Pending approvals after a crash are interrupted and must be retried;
they are never silently approved or replayed. Dangerous tools default to disabled; explicit instance
`allowDangerous` names still require an approval card. Images and guest confinement use the other engines.

Voice v1 is attached to the same authenticated server. A short-lived one-use ticket binds Origin, owner,
bot and task; resume also binds owner. Session revocation cancels work and closes sockets. Capture uses
PCM16 mono at 16 kHz/20 ms. STT calls a server-configured HTTP adapter, agent replies use the original
host dispatch, and TTS returns PCM16 audio. Cancellation propagates through the three stages; input,
provider body and connection counts are bounded. Desktop Viewer's upgrade handler excludes Voice paths.
Existing WebRTC/native call implementations remain accessible.

The local catalog serves Agents/Apps/Skills under `/api/aiking/v1/catalog`; installation uses the existing
agent/skill/MCP/Composio flows. Install records persist atomically under the server profile. Fresh browser
profiles see the same records. Older servers/non-owner sessions retain the bundled catalog. Catalog updates
and product recovery are the next Stage 4 work.

## Offline gate evidence

| Verification | Result |
| --- | --- |
| Core regression, including authenticated HTTP MCP | 84 pass |
| Core driver + owner services + Voice + catalog | 25 pass |
| Chromium UI → Core → approved MCP write → UI; deny without write; reload | Pass |
| Chromium Marketplace install with backend record | Pass |
| Chromium fake JFK microphone → local WebSocket → Core → transcript/audio | Pass |
| Foreign thread ticket and hostile Origin rejected | Pass |
| Core/shell, renderer/server typechecks; new code lint; UI production build | Pass |

Reports/screenshots: `.aikingbot-foundation/evidence/shipping/stage3-e2e.json`, `integration-tests.json`
and six PNGs. Root logs are under `/workspace/scratch/`; shipping evidence archive follows in Stage 5.
Real provider verification is explicitly false. Offline STT returns a fixture transcript and TTS a tone;
this proves transport/runtime wiring, not speech recognition quality or a paid model response.

## Run

```sh
npm ci --ignore-scripts
node apps/desktop-foundation/setup.mjs
npm ci --prefix apps/desktop-foundation --ignore-scripts
# Build the UI once; --production avoids compiling during browser/Electron tests.
cd .aikingbot-foundation/source
node node_modules/typescript/bin/tsc -b
node node_modules/typescript/bin/tsc -p tsconfig.server.json
node node_modules/vite/bin/vite.js build
cd ../..
node apps/desktop-foundation/dev.mjs --offline --core --production
# Separate terminal:
node apps/desktop-foundation/shipping-e2e.mjs
```

For a real Core instance, add driver `aiking-core` to the host's instance configuration with
`config: { "mode": "anthropic", "model": "<available Claude model ID>" }` and server-only
`ANTHROPIC_API_KEY`. The model picker distinguishes the offline verification engine.

Speech adapter environment: `AIKING_STT_URL`, optional `AIKING_STT_TOKEN`/`AIKING_STT_MODEL`;
`AIKING_TTS_URL`, optional `AIKING_TTS_TOKEN`/`AIKING_TTS_MODEL`/`AIKING_TTS_VOICE`.
STT accepts multipart WAV and returns `{ "text": "..." }`; TTS accepts JSON (`input`, `text`, `voice`,
`model`, `response_format: "pcm"`) and returns PCM16, with optional `x-sample-rate` (default 24000).
Endpoints require HTTPS or loopback HTTP. These settings remain unconfigured on this runner.
Voice never treats speech as tool approval; use the chat approval card while a call waits.

No production/VPS changes, credential access, paid calls, or newer PolyForm OpenBot source were used.
