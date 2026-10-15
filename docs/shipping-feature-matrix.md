# Shipping feature matrix

Updated 2026-10-15 (Claude takeover). `Working` means the stated local/fixture flow passed; it does not imply a paid provider
or physical device was tested. Stage 5 local evidence is in `.aikingbot-foundation/evidence/shipping/`.

Current continuation evidence and exact limits are tracked in [Capability Parity Matrix](aikingbot/capability-parity-matrix.md) and
[provider onboarding verification](aikingbot/provider-onboarding-verification.md). These newer entries qualify historical Working labels below;
no current physical Windows, live OAuth/model response or real voice-call acceptance is implied.

| Feature | Status | Evidence / remaining configuration |
| --- | --- | --- |
| Core streaming, MCP tools, approval/deny, cancel | Working | Real Core runtime and stdio/HTTP MCP; scripted offline model; Chromium UI E2E |
| Core sessions, branch reset, recovery, room turn sequencing | Working | Atomic transcripts, six driver tests; interrupted approval requires explicit retry |
| Live AI replies | Requires Credentials | Anthropic key in Connections or server instance; existing original engines retained |
| Model/account management and key routing | Working | Engine/account/key-flow and routing regressions; separate endpoint never inherits shared key |
| Marketplace catalog/search/install/update/uninstall/status | Working | Persistent backend, immutable reviewed skill update, per-target versions, 11-flow shipping E2E |
| Stage 2 Marketplace migration | Working | Live-target filtering and no-downgrade E2E; legacy browser copy retained |
| Catalog publishing | Requires Server | Set validated JSON path with `AIKING_CATALOG_FILE`; restart server |
| MCP and connector setup | Working | Existing host configuration, stdio/HTTP/SSE, scope and approvals preserved |
| Composio/OAuth app connections | Requires Credentials | Composio project and provider OAuth; no external account connected here |
| Voice devices/capture/VAD/barge-in/reconnect/local backend | Working | JFK PCM16 16 kHz Chromium fixture, WebSocket/Core/transcript/audio pipeline |
| Speech recognition and natural speech output | Requires Server | Configure STT/TTS adapters; current E2E transcript/tone are explicit offline fixtures |
| Realtime/WebRTC providers | Requires Credentials | Existing provider implementation retained; paid provider/OS audio not verified |
| Groups/multi-agent management | Working | Two Core members complete replies in the actual group UI; host task/routing regressions |
| Schedules/routines | Working | Actual once-scheduled Core run plus manager/restart regressions; external model needs credentials |
| Computer/browser panels and control state | Working | Fixture panel/selection/control regressions; original native implementations retained |
| Physical computer/browser/phone operation | Remaining Issues | Requires target OS permissions/native runtime validation; no physical device provisioned |
| Remote authorization and session/viewer state | Working | 19 remote-session tests, auth/CSRF checks and panel fixtures |
| Standalone server bundle (Node 24) | Working | `server-bundle.mjs` archive + SHA256SUMS; `server-smoke.mjs` 15 checks outside the checkout (pairing, Core/Voice status, Marketplace, restart, backup/restore) |
| Docker / systemd deployment | Working | `deploy/aikingbot-server`: Caddy edge owns the namespace; local stack-check through the edge passes; full image with agent browser is built in CI; systemd unit verified with `systemd-analyze` |
| Production VPS rollout | Requires Server | Run preflight on the VPS, own hostname/TLS, separate data root; production OpenBot untouched |
| AIKINGBOT identity (names, links, hosted defaults) | Working | `branding-patches.mjs` over runtime source and translations; upstream portal/image defaults removed; attribution kept |
| Real remote workspace, hosted management | Requires Server | Deploy own server/TLS and pair/enroll; no production host changed |
| Encrypted backup/restore | Working | Actual export/import, Core and Marketplace files restored; destination pairing identity preserved |
| Avatars, themes, onboarding, settings, files/media UI | Working | Fresh-profile Chromium/Electron tours: dark/light 1440px and advanced 1000px; no renderer errors |
| Core image input | Working | PNG/JPEG/GIF/WebP (≤20, 5 MB each) reach the model for that turn; transcripts keep a note; driver + Core tests. Live vision replies need an Anthropic key |
| Core guest confinement | Remaining Issues | Guest-confined turns still need another retained engine |
| Voice after backend restart | Remaining Issues | Network reconnect resumes within the same server process; start a new call after server restart |
| Linux installer, release identity and profile isolation | Working | Actual AppImage/DEB; packaged desktop/Core checks; own profile/protocol/updates; dependency licenses included |
| Windows installer and CI artifacts | Current rc.2 pending CI | Historical rc.1 runs 38678359992 and 38680508700 green on Windows/Linux; setup.exe/zip/deb/AppImage + server bundle with SHA-256 in HANDOFF. Install on a physical Windows machine still to be qualified; unsigned |
| Signed releases and macOS qualification | Remaining Issues | Certificates/notarization and actual macOS runner not supplied; Linux packages are unsigned |
| Startup/reconnect/process recovery | Working | Packaged restart/worker smoke, bounded recovery tests, clean owner shutdown IPC; Vite cannot bypass cleanup |
| Vietnamese interface | Remaining Issues | English complete; full Vietnamese localization not implemented |

No production credentials, paid API calls or newer PolyForm OpenBot code were used.
