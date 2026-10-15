# Stage 5 — AIKINGBOT 0.3.0-rc.1

Branch: `stage3/shipping-candidate`. Stage 3: `e7ff535`; Stage 4: `0da04fb`.
Updated 2026-10-15. Local Linux packaging and final regression are in progress;
the Windows/Linux workflow will run on the shipping branch push. CI results are not yet claimed.

## Product and package

The release retains the pinned Apache-2.0 OSS engines and adds the Core adapter, persistent Marketplace
and authenticated local Voice backend. Installed app ID is `com.aikingcorp.aikingbot`, protocol `aikingbot`,
data root `~/.aikingbot`, executable `aikingbot` on Linux. There is no automatic adoption of OpenMausBot,
OpenBot or OpenGrok data. Development profiles remain under `.aikingbot-foundation/profiles/`.

AppImage and Debian installers are generated on Linux x64; Windows NSIS and ZIP builds use a Windows x64
runner because the original native CUA preparation explicitly requires that OS. Mac configuration/icons
are included but no Mac runner/build is qualified here. Installers are unsigned; signing/notarization and
Windows SmartScreen qualification require the release operator's certificates and target OS check.

Auto-update is disabled by default. `AIKING_UPDATE_FEED` enables an operator-controlled HTTPS generic
feed, without URL credentials. No default upstream update/account/Composio service is used.
`AIKING_CLOUD_ORIGIN` is an HTTPS origin for the retained hosted-account protocol;
`OMB_CONTROL_PLANE_URL` configures managed phone accounts and `OMB_COMPOSIO_BROKER_URL` configures the
Composio broker. These require compatible services, not merely a new DNS name. Direct MCP/Composio-key
and remote-workspace pairing flows remain available. Existing Android clients that accept only the upstream
pairing scheme need an AIKING client build accepting `aikingbot://`.

## Reproduce

Use Node 24+, Git, tar, npm and Bun 1.4.3 for Core tests. Setup installs frozen pnpm 10.33.0 dependencies.
Linux Electron must run as an ordinary user with sandbox enabled and a desktop session or Xvfb.

```sh
git submodule update --init vendor/openmausbot
npm ci --ignore-scripts
npm ci --prefix apps/desktop-foundation --ignore-scripts
node apps/desktop-foundation/setup.mjs
bun test ./test
npm run typecheck
npx --yes pnpm@10.33.0 exec node apps/desktop-foundation/build.mjs
AIKING_VERIFY_STAGE=shipping node apps/desktop-foundation/compatibility.mjs
node apps/desktop-foundation/security-checks.mjs
node apps/desktop-foundation/packaged-core.mjs
node apps/desktop-foundation/verify-shipping.mjs
node apps/desktop-foundation/verify-shipping.mjs --electron
node apps/desktop-foundation/packaged-desktop.mjs
```

For offline manual exploration: `node apps/desktop-foundation/dev.mjs --offline --core --production --desktop`.
For persistent local development: omit `--offline --core`; select **AIKING Core** or another retained engine
and configure the appropriate Connections credentials. The launcher prints its exact isolated profile/URLs.

Build outputs: `.aikingbot-foundation/source/release/AIKINGBOT-0.3.0-rc.1-*`.
SHA-256 manifest: `.aikingbot-foundation/evidence/shipping/build-artifacts.json`.
The workflow `.github/workflows/shipping-candidate.yml` runs tests, builds installers, checks the packaged
server/Core, and uploads installers plus evidence for 14 days. Linux additionally runs sandboxed Electron.
Source-only platforms and unfinished workflow jobs must not be described as tested installers.

First CI run `38668030797` exposed CRLF patch anchors on Windows and a missing globally callable pnpm in
the Linux package collector. Source patching now normalizes line endings, LF/CRLF regression tests pass,
and CI installs the pinned pnpm explicitly. Final results from the follow-up run are tracked in HANDOFF.

## Verification and security

Final reports live under `.aikingbot-foundation/evidence/shipping/`:

| Report | Scope |
| --- | --- |
| `shipping-e2e.json` | 11 local Chromium flows: Core/MCP approval/deny/persistence, Marketplace lifecycle/migration, Voice, authorization, two Core group members and a scheduled Core run |
| `voice/chromium-voice-e2e.json` | JFK fake microphone, 16 kHz PCM, devices, barge-in, mute, reconnect/resume and permission denial |
| `ui-tour/*.json` and PNG | Fresh-profile dark/light 1440×900 and advanced 1000×900, Chromium/Electron |
| `compatibility.json` | Model/key/auth/tool, routine, group, computer/browser/remote, backup, credentials and updater regressions |
| `desktop-security.xml` | IPC, file containment, permissions, server auth, data leases and bounded recovery |
| `packaged-core.json` | Packaged Core → actual stdio MCP → approval → persisted reply, copied outside the checkout |
| `packaged-desktop.json` | Actual packaged Electron, renderer isolation, mutation/Origin protection and fresh data |

Compatibility adjustments are recorded separately and restored after each run. They adapt branding,
profile/protocol and Core key reload expectations; use a standard build umask; skip a procfs-only fixture
when the container omits its sysctl; allow 60 seconds for real encrypted-backup KDF batches. Assertions,
approval requirements and scheduler timings are retained.

The packaged server smoke verifies dependency-free startup, all 13 spawned proxies, public MCP stdio,
headless CLI, encrypted backup worker, shutdown and compile-cache restart. It caught and fixed a production
ESM/CommonJS `ws` bundling failure. Native release manifests/hashes remain validated. Package hooks keep
the Chromium sandbox and exact AppArmor policy; they do not disable system sandboxing. Loopback reads
retain the host's local-owner trust model; packaged mutations require its desktop capability. Remote
devices require pairing, Origin checks and scopes. A shared server must use the service-trust deployment
documented in the retained `docs/verification/shared-workspace-trust.md`, with OS-level user isolation.

Offline models, STT transcript and TTS tone are labeled fixtures. No live provider/OAuth credentials,
paid API calls, physical microphone quality, real VPS/VM/phone provisioning or production data were used.
Core images/guest confinement use another retained engine. A Voice call needs restarting after a backend
process restart; in-process network reconnect/resume is tested. Full Vietnamese localization is pending.

## Server deployment and next-day acceptance

The server bundle can run separately with Node 24. Preserve the full `dist-server/` tree and its package.json;
the UI is in `dist/`. Set `OMB_DATA_DIR` to a new dedicated directory, `OMB_STATIC_DIR` to the absolute UI
directory, `OMB_PORT` and `OMB_WEBHOOK_PORT` to unused ports, then run `node dist-server/index.js`.
It binds loopback; put your own TLS/authenticated reverse proxy in front, preserving the remote Host and
forwarded-source headers so a remote caller cannot inherit loopback-owner trust. Pair an admin device using
the retained local control CLI. Use service trust for shared/hosted deployments. Do not expose a raw local
owner API or move an existing production profile into this server.

1. Check Windows/Linux workflow status and artifact hashes. Install/uninstall on a disposable Windows
   machine and Debian/Ubuntu machine; approve only the physical device permissions intended for the app.
2. Configure own server/TLS, account/control-plane/Composio services only if those hosted flows are needed.
   Verify pairing, roles, remote workspace and revocation using a separate test account.
3. Add a scoped Anthropic key in Connections, select Core, then send one approved model → tool → UI turn;
   verify deny, Stop, restart recovery and two group members. Existing engines remain selectable.
4. Set `AIKING_STT_URL` / `AIKING_TTS_URL` and optional server-only token/model/voice variables. STT accepts
   multipart WAV and returns `{ "text": "..." }`; TTS accepts JSON `input/text/voice/model/response_format:pcm`
   and returns PCM16 (`x-sample-rate`, default 24000). Use HTTPS or loopback HTTP. Test real microphone,
   speaker, interruption and reconnect. Voice never grants tool approval itself.
5. Publish validated catalog JSON via `AIKING_CATALOG_FILE`; test install/update/remove for a real connector
   after granting its least required OAuth scopes. Confirm backup/export and restore into a fresh profile.
6. Supply signing certificates, qualify installer warnings and enable an own HTTPS update feed only after
   signed release artifacts and metadata have been uploaded and verified.

Production VPS/OpenBot, live credentials and existing data remain untouched. No newer PolyForm source
was imported; Apache pin and notices are preserved.
