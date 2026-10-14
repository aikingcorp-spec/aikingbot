# AIKINGBOT stage 1 desktop foundation

A complete application based on the Apache-2.0 OpenMausBot OSS edition, pinned at `93b3c24cdade51e362e443d2387a9f37eb7e115c`. The stack is React 19, Vite, Tailwind, Lucide, Electron and a Node 24 local harness. AIKING Core v0.2 remains separate in this stage.

## Run

Install Node.js 24 or newer, npm, Git and `tar`. Electron needs a desktop session on Linux. Use Git Bash or the system `tar` on Windows.

```sh
git clone --branch AIKINGBOT --recurse-submodules https://github.com/aikingcorp-spec/AIKINGX_Bot.git
cd AIKINGX_Bot
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

This runs the **real app, API, store, queue and provider protocol** with the upstream deterministic test CLI. It uses a disposable profile and makes no model call. It is not an AIKING Core integration.

```sh
node apps/desktop-foundation/dev.mjs --offline --desktop
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

## Delivery evidence

Verified on 2026-10-14 with Node 24.19.0, pnpm 10.33.0 and Electron 43.7.9 from the frozen lockfile:

- Real Electron startup under Xvfb; context isolation and renderer sandbox retained.
- OSS edition, no enterprise implementation in runtime source, AIKING brand.
- Agents created through the real control API; composer send and provider reply.
- Transcript restored after reload; identity and messages preserved after process restart.
- Settings open/close, persisted theme change, real Apps panel, no renderer errors.
- Normal local-mode harness startup with a persistent profile.
- Renderer and server TypeScript projects; focused lint and JavaScript syntax checks.

Artifacts are generated locally, not committed: `electron-{chat,workspace,settings,apps}.png`, `browser-{chat,workspace,settings,apps}.png`, `electron-verification.json`, `browser-verification.json` and `persistence.json`. JSON identifies offline verification and explicitly records that real provider calls, connector actions and Core integration were not verified. Screenshots show the running implementation.

Signed installers, cross-platform native permissions, real remote/computer sessions, provider installations and external OAuth/actions remain unverified. Full latest OpenBot UI and feature parity is a later stage; the exact gaps are in the source comparison.

## Reused source and boundaries

The complete OSS source is retained, including `src/App.tsx`, the state/store, chat/sidebar/composer, groups, routines, settings, provider/model controls, Apps/MCP/skills, computer/browser panels, `server/`, `shared/` and `electron/`. `LICENSE`, `NOTICE`, `LICENSING.md` and `third_party/` are preserved. AIKING overrides replace product marks, default avatars and active icons; upstream marketing analytics and email collection are disabled. The optional enterprise entitlement checks stay unchanged.

The current nightly-labs OpenBot 0.39.1 source was cloned and inspected as the product reference. Its PolyForm Noncommercial source is not imported into this commercially reusable foundation. Historical v0.1.11 Apache assets already present in Core's Solid shell stay in that separate shell.

- [Source comparison and decision](../../docs/stage-1-source-comparison.md)
- [Planned Core v0.2 integration](../../docs/stage-1-core-integration.md)
- [AIKING branding audit](BRANDING-AUDIT.md)
