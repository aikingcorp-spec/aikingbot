# AIKINGBOT desktop 0.3.0-rc.3

A complete application based on the Apache-2.0 OpenMausBot OSS edition, pinned at `93b3c24cdade51e362e443d2387a9f37eb7e115c`. React 19, Electron and Node 24 now integrate AIKING Core v0.2 alongside the retained original engines. Core, Marketplace, Voice local, groups and routines have offline end-to-end verification. See [shipping delivery](../../docs/stage-5-shipping-candidate.md) and [feature matrix](../../docs/shipping-feature-matrix.md) for actual platform/provider limits.

## Run

Install Node.js 24 or newer, npm, Git and `tar`. Electron needs a desktop session on Linux. Use Git Bash or the system `tar` on Windows.

```sh
git clone --branch AIKINGBOT --recurse-submodules https://github.com/aikingcorp-spec/AIKINGX_Bot.git
cd AIKINGX_Bot
npm ci --ignore-scripts
npm ci --prefix apps/desktop-foundation --ignore-scripts
node apps/desktop-foundation/setup.mjs
node apps/desktop-foundation/dev.mjs --desktop
```

Setup checks the source pin, exports the complete source **without `enterprise/`**, applies the committed AIKING overrides, installs the upstream frozen lockfile with pnpm 10.33.0, and generates the original AIKING desktop icons. The immutable upstream checkout stays in `vendor/openmausbot` for source inspection and provenance. Restricted enterprise code is not loaded or exported into the application.

To run the same real renderer and harness in a browser:

```sh
node apps/desktop-foundation/dev.mjs
```

Open `http://127.0.0.1:5199`. The harness defaults to port 18799 and its webhook receiver to 18800. Set `AIKING_UI_PORT` and `AIKING_API_PORT` to use different ports. Stop with Ctrl+C; the launcher stops only its own children. Run one stack per port pair. The printed JSON gives the actual URLs and profile path.

Normal local data is in `.aikingbot-foundation/profiles/local`. Electron's isolated development profile is in `.aikingbot-foundation/profiles/electron`. Setup does not delete these profiles. The source export and dependencies are in `.aikingbot-foundation/source`, outside Core's `.aiking` data. Run setup after changing an override. Do not edit generated source as the permanent implementation.

In normal mode, select and authenticate a supported provider through Settings, or configure an OpenAI-compatible/local endpoint. The imported app retains its original provider drivers. This delivery does not provision provider accounts, Composio, cloud computers, native phone services or production hosted access.

## Offline verification

This runs the real app, API, store and queue with a deterministic model. `--core` adds the real AIKING Core runtime with a clearly named offline model. Tool calls, approvals, persisted turns and Voice transport execute locally; STT/transcripts and tones are fixtures. No paid model or speech provider is called.

```sh
node apps/desktop-foundation/dev.mjs --offline --core --desktop
```

Omit `--desktop` for a browser. The offline profile is removed when this owned stack stops; its screenshots and verification reports stay in `.aikingbot-foundation/evidence`.

For repeatable browser checks, install the small verification tool package and point it at an installed Chrome/Chromium binary:

```sh
npm ci --prefix apps/desktop-foundation --ignore-scripts
AIKING_CHROME=/usr/bin/chromium node apps/desktop-foundation/verify.mjs
```

For the real Electron renderer, start the offline desktop with an explicit loopback debug port, then run the verifier from another terminal:

```sh
AIKING_DESKTOP_DEBUG_PORT=9223 node apps/desktop-foundation/dev.mjs --offline --desktop
AIKING_VERIFY_CDP=http://127.0.0.1:9223 node apps/desktop-foundation/verify.mjs
```

On Windows PowerShell, set these variables with `$env:AIKING_DESKTOP_DEBUG_PORT='9223'` or `$env:AIKING_CHROME='C:\path\to\chrome.exe'` before the command. Linux server verification can use Xvfb via `DISPLAY`; sandboxing remains enabled. Debugging is enabled only when the explicit debug-port variable is present.

The restart check creates and owns a second disposable harness:

```sh
cd .aikingbot-foundation/source
node --experimental-strip-types aiking/verify-persistence.ts
```

## Build and shipping regression

```sh
npx --yes pnpm@10.33.0 exec node apps/desktop-foundation/build.mjs
# Run after the production UI build; each tour launches a fresh disposable stack.
AIKING_VERIFY_STAGE=shipping node apps/desktop-foundation/compatibility.mjs
node apps/desktop-foundation/security-checks.mjs
node apps/desktop-foundation/packaged-core.mjs
node apps/desktop-foundation/verify-shipping.mjs
node apps/desktop-foundation/verify-shipping.mjs --electron
node apps/desktop-foundation/packaged-desktop.mjs
```

Linux headless Electron commands need Xvfb/`DISPLAY` and an ordinary user with the sandbox enabled.
`build.mjs` creates installers for the current host; Windows native preparation requires a Windows x64 host.
The GitHub Actions shipping workflow supplies Windows/Linux runners. Outputs: `.aikingbot-foundation/source/release/`;
SHA-256 manifest: `.aikingbot-foundation/evidence/shipping/build-artifacts.json`.
`--reuse-native` reuses already prepared native bundles; `--package-only` packages existing compiled output for iterative packaging checks.
For a clean build use the command without either flag. The pnpm wrapper makes the pinned package manager available to electron-builder's dependency collector; CI installs the same version explicitly.

Installed data defaults to `~/.aikingbot` and its own Electron profile/app ID. Existing OpenMausBot/OpenBot data is not migrated.
On Windows, the rc.2 app checks the AIKINGBOT VPS HTTPS updater feed by default; set AIKING_UPDATE_FEED=off to disable it or supply another HTTPS feed. Non-Windows remains opt-in. Windows installers include their own Node.js/npm runtime for on-demand CLI provider installation, so end users do not install those developer tools. CLI/provider credentials stay in app-owned user data. Cloud sign-in requires AIKING_CLOUD_ORIGIN;
managed account/Composio services require `OMB_CONTROL_PLANE_URL` / `OMB_COMPOSIO_BROKER_URL`. No upstream hosted service is selected by default.

## Historical Stage 1 evidence

Verified on 2026-10-14 with Node 24.19.0, pnpm 10.33.0 and Electron 43.7.9 from the frozen lockfile:

- Real Electron startup under Xvfb; context isolation and renderer sandbox retained.
- OSS edition, no enterprise implementation in runtime source, AIKING brand.
- Agents created through the real control API; composer send and provider reply.
- Transcript restored after reload; identity and messages preserved after process restart.
- Settings open/close, persisted theme change, real Apps panel, no renderer errors.
- Normal local-mode harness startup with a persistent profile.
- Renderer and server TypeScript projects; focused lint and JavaScript syntax checks.

Artifacts are generated locally, not committed: `electron-{chat,workspace,settings,apps}.png`, `browser-{chat,workspace,settings,apps}.png`, `electron-verification.json`, `browser-verification.json` and `persistence.json`. JSON identifies offline verification and explicitly records that real provider calls, connector actions and Core integration were not verified. Screenshots show the running implementation.

This section records the original Stage 1 checks. Current build results, signing/platform limits and remaining server/credential work are in the shipping delivery and feature matrix linked above.

## Stage 2 interface

The default look follows the OpenBot 0.39 reference with the AIKING brand: workspace rail, Agents/Routines sidebar, Marketplace (Agents, Apps, Skills), Settings → Connectors, tool activity cards and original agent avatars. See [Stage 2 UI parity](../../docs/stage-2-ui-parity.md). With an offline stack running:

```sh
AIKING_CHROME=/path/to/chrome node apps/desktop-foundation/ui-tour.mjs
AIKING_VERIFY_CDP=http://127.0.0.1:9223 node apps/desktop-foundation/ui-tour.mjs   # Electron
```

The tour writes one screenshot per screen and `<surface>-ui-tour.json` to `.aikingbot-foundation/evidence/stage2/`. On Linux, run Electron as a normal user; it refuses to start as root with its sandbox on.

## Voice and finalization checks

The composer phone button opens Voice: select the microphone/speaker, then choose **Offline test (scripted)**
or **Local backend** / **AIKING Core voice server**. The offline service captures real microphone input and plays a scripted tone;
it does not perform speech recognition or call an AI provider. The Core option requires a protocol v1 server
at `wss://…/v1/voice/sessions` (localhost `ws://` is accepted for testing). Local backend uses the same authenticated host and needs server STT/TTS configuration; `--offline --core` supplies labeled fixtures. Existing realtime/turns provider calls
remain under **Existing provider call options**. Group calls retain their existing provider flow.

With an owned offline stack running:

```sh
node apps/desktop-foundation/voice-e2e.mjs       # Chromium + fixtures/voice/jfk-16k.wav
node apps/desktop-foundation/compatibility.mjs # 18 selected compatibility test files
```

Voice evidence is under `.aikingbot-foundation/evidence/stage2/voice/`. The compatibility runner records its
three branding expectation changes and 10-second restart-fixture HTTP budget, then restores the upstream
test files. Offline Electron now uses a new `profiles/electron-verify-*` directory on each launch and removes
that owned profile when the launcher stops. The normal desktop profile remains `profiles/electron`.
See [finalization verification](../../docs/stage-2-finalization-verification.md) for results and backend limits.

## Reused source and boundaries

The complete OSS source is retained, including `src/App.tsx`, the state/store, chat/sidebar/composer, groups, routines, settings, provider/model controls, Apps/MCP/skills, computer/browser panels, `server/`, `shared/` and `electron/`. `LICENSE`, `NOTICE`, `LICENSING.md` and `third_party/` are preserved. AIKING overrides replace product marks, default avatars and active icons; upstream marketing analytics and email collection are disabled. The optional enterprise entitlement checks stay unchanged.

The current nightly-labs OpenBot 0.39.1 source was cloned and inspected as the product reference. Its PolyForm Noncommercial source is not imported into this commercially reusable foundation. Historical v0.1.11 Apache assets already present in Core's Solid shell stay in that separate shell.

- [Source comparison and decision](../../docs/stage-1-source-comparison.md)
- [Planned Core v0.2 integration](../../docs/stage-1-core-integration.md)
- [AIKING branding audit](BRANDING-AUDIT.md)
