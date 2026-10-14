# Stage 2 finalization — verification and handoff

2026-10-14 · `stage2/ui-parity` · foundation `93b3c24cdade51e362e443d2387a9f37eb7e115c` (Apache-2.0).
Node 24.19.0, frozen pnpm 10.33.0, Electron 43.7.9, Chromium on Linux.
No paid provider calls, live user data, production services or PolyForm OpenBot code were used.

## Results

| Check | Result | What it proves |
| --- | --- | --- |
| Voice unit tests | 15/15 | Streaming resample at 16/44.1/48 kHz, VAD, permission/hangup race, barge-in, mute, reconnect cap/token/stale events, device loss, PCM endian, pipeline cancellation, handshake timeout |
| Voice Chromium E2E | 5/5 | JFK WAV goes through real getUserMedia/AudioWorklet; device selection, loopback/playback graph, interrupt/mute/minimize, real loopback WebSocket + reconnect, denied browser microphone permission, track/context cleanup |
| Compatibility | 483/483, 18 files | Includes Voice 15 and Marketplace 5; detailed matrix below |
| UI tour Chromium | 37 pass, 0 skip, 0 renderer errors | Complete tour including new Voice screen |
| UI tour Electron | 36 pass + 1 expected Account skip, 0 renderer errors | Real Electron renderer with sandbox enabled, ordinary user, fresh offline profile |
| Stage 1 verifier | 12/12 per surface | Brand, OSS boundary, agent/chat/store/reload/settings/theme/apps |
| TypeScript | Renderer + server pass | Pinned generated source with AIKING overrides |
| Lint | New Voice code and verification scripts pass | oxlint, no warning suppression |

The upstream restart fixture repeatedly exceeded its 2-second per-request HTTP budget on this executor,
including when run alone. `compatibility.mjs` temporarily uses 10 seconds for that HTTP budget and replaces
three literal product-name expectations with AIKINGBOT. Scheduler timing and all behavior assertions stay
unchanged. It writes `compatibility-fixture-adjustments.json` and restores every original test file in `finally`.

## Compatibility matrix

| Area | Verification | Boundary |
| --- | --- | --- |
| Models | Picker in both tours; 36 default selection tests | New Voice does not write model selection. Core server must resolve the chosen bot/thread model; no live provider verified |
| Tool approval | Approval modes 26, peer approvals 18, summaries 12 tests | Existing chat approvals preserved. Protocol v1 has no approval event/action; Voice never automatically approves tools or treats a spoken transcript as approval |
| Schedules | 153 manager tests, 30 schedule tests, restart fixture, Routines tour | Real offline queue/persistence/recovery checked; no external job/provider |
| Computer | Panel tour, 4 view + 4 selection tests | No physical CUA, VM or cloud computer provisioned |
| Browser | 57 BrowserPanel tests, including password input isolation | UI/control/queue behavior checked with fixtures; no external browsing session |
| Remote | 19 remote-session tests + 5 desktop-panel tests | Authorization/session/viewer state checked with fixtures; no real remote host |
| Multi-agent | Group creation tour, 11 routing + 8 task tests, restart handoff recovery | Existing group calls remain on the original provider flow; protocol v1 targets one bot/thread |
| Existing voice | 76 live media + 3 turn-call tests; provider options reachable in tour | Existing WebRTC/native speech routes preserved; their real provider/OS audio not verified |

## Reproduce

```sh
node apps/desktop-foundation/setup.mjs
npm ci --prefix apps/desktop-foundation --ignore-scripts
node apps/desktop-foundation/dev.mjs --offline
# Second terminal; each Chromium script creates a fresh browser context:
AIKING_CHROME=/usr/bin/chromium node apps/desktop-foundation/ui-tour.mjs
AIKING_CHROME=/usr/bin/chromium node apps/desktop-foundation/voice-e2e.mjs
node apps/desktop-foundation/compatibility.mjs
node apps/desktop-foundation/verify.mjs
```

Electron, from an ordinary user with a desktop display (Xvfb also works):

```sh
DISPLAY=:97 AIKING_UI_PORT=5200 AIKING_DESKTOP_DEBUG_PORT=9223 node apps/desktop-foundation/dev.mjs --offline --desktop
AIKING_VERIFY_CDP=http://127.0.0.1:9223 node apps/desktop-foundation/ui-tour.mjs
AIKING_VERIFY_CDP=http://127.0.0.1:9223 node apps/desktop-foundation/verify.mjs
```

Run one owned stack at a time for reproducibility: verification scripts read the last `offline-runtime.json`.
Stop the UI stacks before running compatibility, and finish typecheck before that run; the restart fixture
has a bounded request budget and is sensitive to concurrent compiler/browser load.
The offline launcher creates a disposable harness profile and a new Electron `electron-verify-*` profile;
shutdown removes only the profiles it owns. No `--no-sandbox` flag was used. Process inspection confirmed
user `agent` and renderer `--enable-sandbox`.

## Handoff screenshots

Generated evidence remains outside Git, as in previous stages:

- `.aikingbot-foundation/evidence/stage2/browser-*.png` and `electron-*.png`: one image per completed tour step.
- `browser-ui-tour.json`, `electron-ui-tour.json`: actions, outcomes and renderer errors.
- `voice/{voice-devices,voice-loopback-audio,voice-mute-and-minimize,voice-websocket-reconnect,voice-permission-denied}.png`.
- `voice/chromium-voice-e2e.json`: wire input/output rates, cancel/reconnect/close, selected sinks and closed media resources.
- `compatibility.json` + `compatibility-fixture-adjustments.json`; Stage 1 reports in `evidence/`.
- `.aikingbot-foundation/evidence/stage2-finalization-handoff.zip`: successful screenshots and reports, with a SHA-256 manifest.

Screenshots were captured from a fresh Chromium context and fresh Electron offline profile at 1440×900.
The handoff archive excludes diagnostic screenshots from failed exploratory runs.

## Stage 3 boundaries

The Voice client and WebSocket transport are implemented. The E2E server, STT transcript, agent reply and
TTS tone are deterministic offline fixtures. Core must provide the production endpoint, authentication,
STT/TTS/realtime providers, model resolution, transcript persistence and server-side permission gate.
The current protocol needs an extension for approval notifications/actions and group routing.

Browser input/output and playback scheduling were measured; hearing the output through physical speakers
was not tested. Real providers, external connectors, remote/cloud computers, cross-platform native permissions
and Windows/macOS installers remain unverified. No light/Advanced/900px tour rerun is claimed for this pass.
