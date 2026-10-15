# Shipping feature matrix

Updated 2026-10-15. `Working` means the stated local/fixture flow passed; it does not imply a paid provider
or physical device was tested. Stage 5 release evidence will extend this matrix.

| Feature | Status | Evidence / remaining configuration |
| --- | --- | --- |
| Core streaming, MCP tools, approval/deny, cancel | Working | Real Core runtime and stdio/HTTP MCP; scripted offline model; Chromium UI E2E |
| Core sessions, branch reset, recovery, room turn sequencing | Working | Atomic transcripts, six driver tests; interrupted approval requires explicit retry |
| Live AI replies | Requires Credentials | Anthropic key in Connections or server instance; existing original engines retained |
| Model/account management and key routing | Working | Engine/account/key-flow and routing regressions; separate endpoint never inherits shared key |
| Marketplace catalog/search/install/update/uninstall/status | Working | Persistent backend, immutable reviewed skill update, per-target versions, nine-flow E2E |
| Stage 2 Marketplace migration | Working | Live-target filtering and no-downgrade E2E; legacy browser copy retained |
| Catalog publishing | Requires Server | Set validated JSON path with `AIKING_CATALOG_FILE`; restart server |
| MCP and connector setup | Working | Existing host configuration, stdio/HTTP/SSE, scope and approvals preserved |
| Composio/OAuth app connections | Requires Credentials | Composio project and provider OAuth; no external account connected here |
| Voice devices/capture/VAD/barge-in/reconnect/local backend | Working | JFK PCM16 16 kHz Chromium fixture, WebSocket/Core/transcript/audio pipeline |
| Speech recognition and natural speech output | Requires Server | Configure STT/TTS adapters; current E2E transcript/tone are explicit offline fixtures |
| Realtime/WebRTC providers | Requires Credentials | Existing provider implementation retained; paid provider/OS audio not verified |
| Groups/multi-agent management | Working | Host group/task/routing tests; Core room sequencing; UI tour continues in Stage 5 |
| Schedules/routines | Working | Manager, scheduling and restart recovery regressions; external model needs credentials |
| Computer/browser panels and control state | Working | Fixture panel/selection/control regressions; original native implementations retained |
| Physical computer/browser/phone operation | Remaining Issues | Requires target OS permissions/native runtime validation; no physical device provisioned |
| Remote authorization and session/viewer state | Working | 19 remote-session tests, auth/CSRF checks and panel fixtures |
| Real remote workspace, hosted management | Requires Server | Deploy own server/TLS and pair/enroll; no production host changed |
| Encrypted backup/restore | Working | Actual export/import, Core and Marketplace files restored; destination pairing identity preserved |
| Avatars, themes, onboarding, settings, files/media UI | Working | Existing Stage 2 coverage retained; Stage 5 fresh-profile/light/dark validation pending |
| Core images / guest confinement | Remaining Issues | Choose another retained engine; Core rejects unsupported input explicitly |
| Voice after backend restart | Remaining Issues | Network reconnect resumes within the same server process; start a new call after server restart |
| Windows installer, release identity, CI artifacts | Remaining Issues | Stage 5 work next; no Windows build claimed yet |
| Vietnamese interface | Remaining Issues | English complete; full Vietnamese localization not implemented |

No production credentials, paid API calls or newer PolyForm OpenBot code were used.
