# AIKINGBOT — Product Experience Recovery & Nightly Parity
**P0 execution brief · 2026-10-15 · Primary audience: Vietnamese nontechnical users**

## 0. Non-negotiable goal

Turn the working AIKINGBOT engineering components into **one complete, discoverable, accessible product**, learning from the end-user UX of **OpenBot Nightly** while preserving the valuable, license-compatible **OpenMausBot OSS** features and the existing **AIKINGBOT R&D account/cloud infrastructure**. This is **not** a rebrand-only task.

User-accepted journey:
1. Visit `https://aikingbot.srv1866690.hstgr.cloud/` → choose Download Windows or Use on Web.
2. Enter email → receive a single-use email OTP from the existing first-party Auth API → verify; don't show a raw host pairing code to normal users.
3. See the user's permitted workspace(s), including the pre-existing staging VPS where explicitly authorized; optionally create a personal workspace, or choose real local/offline use on desktop.
4. Select a model/provider: **Codex, Claude Code, Grok/xAI, Antigravity/Gemini**. Press **Connect** → the app prepares required runtime automatically as allowed → opens the **official provider-owned** authorization → user confirms login → app verifies model ready.
5. Create/open agents, team map, workspaces and Marketplace; give a real task and get a response.
6. Reopen desktop/browser without repeated signup or losing bots/chats/config. Updates arrive from the AIKINGBOT domain without reinstalling from GitHub.

The business owner reported multiple failures **inside the packaged Windows EXE**:
- Marketplace Apps displays `forbidden: this change must come from the desktop app or a paired device`.
- Provider Setup → Install Codex shows `codex CLI not found` then the same `forbidden`.
- Settings → Remote access → Create pairing code also shows the same `forbidden`.
These are **P0 packaged-desktop authorization and onboarding failures**, not excuses to tell customers to install Node/npm, run commands, enter model API keys or type technical pairing codes.

## 1. Preserve capabilities; audit, don't throw them away

The user **values the original Maus/OSS features** — particularly voice call — and wants to **see, understand, and use** them from the product UI. Don't strip them to simplify the patch. Classify each feature into: `working in packaged Windows`, `working only in fixtures`, `requires first-party service/credentials`, `requires OS permission/connected device`, `broken`, or `not built`, with test evidence.

Minimum feature inventory (derive precise capability from source, do not infer more than it supports):
- **Agents/workspaces:** agent creation, team map, chats and streamed replies, multi-agent/groups, model selection/change, threads/memories, message/image attachments, tool permissions/approvals, schedules/routines, background tasks where supported, durable local/host storage, recovery.
- **Marketplace:** agents, apps and skills; browse/search/details, install, authorize, update, remove, status, version checks; built-in MCP servers, externally configured MCP/Composio, Gmail/Google Drive/Calendar etc. with each connector's required OAuth or configuration; marketplace operations must be properly authorized and usable, not a dead catalog.
- **Computer/remote:** file and browser operations, computer control, permissions and platform differences; HTTPS/WebRTC remote access, device connections, teams/roles/whitelists, collaboration/approval, server/account administration, reconnect and error reporting.
- **Voice & media:** microphone input, voice call, live audio capture, voice activity detection, barge-in/interrupt, transcripts, speech output, reconnection, optional genuine realtime providers where supported; display mic/speaker/provider/service readiness, clear call state; image input and other existing media support.
- **Operations and polish:** secure sign-in, session restoration/logout, backup/restore, settings, agent identity, themes, error recovery, logging, installer, auto-updates, parity across desktop/web when technically feasible. Keep existing upstream attribution and third-party licenses.

For anything present upstream but currently inaccessible after the AIKINGBOT fork, create a **Capability Parity Matrix** with: upstream behavior/reference, AIKINGBOT code location, current real status, user entry point, dependency, E2E test, and decision (retain/restore/adapt with reason). Preserve the original Nightly interaction model, while adapting the brand and domain; do not blindly copy code/assets if license doesn't permit.

## 2. Voice is a product feature, not a fake universal model feature

**Voice Call** must stay visible in the agent interface and work when the selected authenticated provider + speech backend actually supports the necessary execution path. Do not assume an OAuth-connected text model automatically has native realtime audio, or that voice is categorically impossible with a text-only model.

Distinguish two legitimate pipelines and label them honestly:
- **Speech-to-text → selected text-capable AI provider → text-to-speech:** can offer conversation with models lacking native audio when STT/TTS services and permissions are configured. Show service/provider dependencies, latency and any extra costs.
- **Provider-native realtime voice:** enable only if explicitly implemented, supported, authorized and tested for that provider/model/account/plan and transport.

UI behavior:
- A Voice action is discoverable on the chat/agent surface, not buried as an obscure setting.
- Before the first call, perform capability check: authenticated active engine, STT/TTS or realtime access, selected output voice if relevant, microphone/speaker permissions, transport availability, and supported client platform.
- Indicate `Ready`, `Requires speech service`, `Provider needs login`, `Microphone permission`, or `Unsupported mode` with one-click remediation where supported. Do not silently downgrade to a fake demo or show 'Connected' when not actually working.
- Verify actual microphone/audio and first model response; support clear start/end and interruption, stream reconnection, and error messages. Preserve transcript/state according to the current data model. If network/service restarts require new call, disclose that.
- Existing `docs/shipping-feature-matrix.md` states: voice local/WebSocket pipeline passed **fixture tests**, STT/TTS requires adapters, native Realtime/WebRTC requires credentials, physical OS tests remain pending. Treat those distinctions as launch truth.

## 3. Distinguish three authentications clearly

**A. AIKING account:** first-party email OTP signup/login. Use the previously implemented Auth API and persistent account record, not a new second user database. Source: earlier R&D tree `/srv/aikingbot-staging/AIKINGX_Bot`; `apps/auth-api/src/routes/v1/auth/email/{start,verify}.ts`; `src/main/central-auth-manager.ts`; deployed staging Worker `https://aikingbot-auth-staging.aiking-corp.workers.dev/`. Current Worker health was 200. Email OTP and Gmail SMTP are **account login**, not Google Gemini model OAuth.

**B. Workspace authorization:** an authenticated account must see/access *only* the servers where it is owner/member/invited. The R&D tree already has host-related tickets (`/v1/team-auth/ticket`) and remote control-plane. Reconcile or port these with the current shipping stack's host session model. Preserve signature/audience/expiry, whitelist, role, admin scopes, revocation, and browser CSRF protections. The current shipping embedded Cloud client expects an incompatible `/api/cloud/desktop/*` contract; **pointing `AIKING_CLOUD_ORIGIN` at the Worker is not enough**. Implement and test a compatible adapter or port the existing manager, with one account source of truth. Pairing code can remain in Advanced → Self-hosting / Emergency, not mandatory for ordinary signup or own hosted workspace.

**C. Provider/model authorization:** independent official login for each engine. Codex can use its supported ChatGPT-plan authorization; Claude Code its official login; Grok/xAI and Antigravity/Gemini via officially supported CLI/device/ACP mechanisms, subject to the provider's actual availability, ToS, region, account entitlement and OS. Don't assume one universal OAuth protocol or bypass plan restrictions. If official OAuth is not supported for a specific configuration, show the real compatible alternatives and mark unavailable rather than inventing one. Scope tokens/secrets to correct machine/account/host; never send local third-party OAuth credentials to VPS without a clearly designed user-approved path. Composio app connectors are distinct from AI model authentication.

## 4. Connect should actually connect

Required first-run packaged Win11 path, **no developer environment installed**:
1. The app owns any required runtime in its private directories; user does NOT manually install Node/npm, run commands or edit PATH.
2. For supported provider, click Connect/Install → managed provider CLI/ACP download with verified origin/version/signature/hash, progress and retry/cancel → provider official authorization in safe browser/device-code flow → OAuth completion → CLI/account/model smoke test → display Connected and allow agent task.
3. If installed already, reuse safely and detect its actual state.
4. A failed installation/auth clearly distinguishes network, missing runtime, provider account permissions, expired session and backend/system errors. Include `Try again` with logs safe from tokens.
5. Available models must be discovered from actual provider/account capability, not invented. Provider switching should not silently lose current thread context or agent workspace.
6. Browser-only experience routes compute/provider execution through an authorized workspace/server, not local CLI that cannot run in a regular browser. Explicitly describe OS-dependent limitations.

Prior work: commit `b0dfd203` attempted to package Node/npm runtime + one-click installation + Windows updater. CI job `38690305447` began on that commit. Its success, real packaged behavior and provider-specific auth are **NOT YET ACCEPTED** solely from patches. Check latest state before building further. Prior rc.1 is still installed by the owner.

## 5. Repair real packaged desktop mutation auth, not the security policy

The screenshot's literal 403 comes from shipping `server/request-auth.ts`. Desktop is supposed to attach a private `x-openmausbot-desktop-owner` capability only to app-owned local loopback requests. Investigate the packaged Electron main process, renderer session, actual destination URL (local vs remote), forwarded headers, and owner token wiring.

- Reproduce the user issue **inside real packaged Windows EXE**, with Marketplace/install, Provider Install, and Remote pairing operations. Test all three, not merely mock the API.
- Ensure those requests reach the correct local or paired/authorized host with their appropriate capability/session. Do **not** remove the header gate or make the public VPS trust arbitrary desktop claims.
- A direct external request and unauthorized member **must remain 403**. A legitimate, authorized desktop request must pass auth and execute its intended operation.
- Error UX should guide the user to the correct account/workspace/permissions, not show unexplained raw `forbidden`.

## 6. Website, desktop/web UI and hosted behavior

- Website on `https://aikingbot.srv1866690.hstgr.cloud/`: VI default + English selector, native AIKING branding and screenshots. Direct Windows download from own VPS domain; `Use on Web` reaches authenticated workspace. Don't send regular customers to GitHub Actions.
- Desktop and browser use the same AIKING account and rights, with seamless workspace selection. Desktop can also choose genuine local mode. Browser cannot directly control local OS resources without an appropriately authorized host/companion; show clear capability state.
- Preserve the useful OpenBot Nightly interaction patterns: obvious navigation, sensible empty states, first-use onboarding, helpful default agents/examples, visible installed/available capabilities, discoverability of voice/remote/Marketplace and model connection, actionable errors.
- Main desktop UI may remain English during current beta if necessary, but architecture must support Vietnamese localization and website MUST be bilingual. All core onboarding/permission messages should be accessible to nontechnical Vietnamese users.
- Web/desktop can display the same workspace but shouldn't misrepresent locally scoped credentials as cloud-synced credentials.

## 7. Reliability, updates, infrastructure

- Remain on official GitHub branch `AIKINGBOT`. Read `HANDOFF.md`, `docs/shipping-feature-matrix.md`, `docs/aikingbot/vps-staging-handoff.md`, and `docs/aikingbot/unified-account-workspace-provider-onboarding.md` before changes. Repo source of truth; commit/push compatible changes; no secret in code/logs.
- Keep Hostinger VPS services isolated from **OpenBot production**. Preserve backend volumes/data, existing staging web, Caddy, Turn, signal, and account Worker. Backups/rollback before risky migrations.
- Desktop updates through own verified HTTPS updater feed; **web deploy is instantaneous but EXE changes require packaged release/update/restart**. Test rc.1→rc.2+ preservation. Do not publish an unverified release, misstate code signing availability or overwrite working rc.1.
- Continue CI Windows + Linux, packaged Electron tests, release artifacts/hash, staging server smoke and actual Win11 manual gate. No invented green checks.
- Engineer may proactively fill small gaps needed for a cohesive journey, but must not destabilize a working service.

## 8. Execution plan & acceptance gates

First deliver a short evidence-grounded inventory and architecture decision (do not spend a whole iteration on reports). Then implement in small working vertical slices, with source, tests and real visual evidence:
- **Gate 1** — EXE operations usable: all three reported 403 failures fixed in packaged Windows, no security regression, bundled provider runtime verified on fresh Windows without Node/npm.
- **Gate 2** — Account/session: first-party email OTP working from Windows and browser; secure persisted auth and sign-out; right workspaces auto-visible without asking for ordinary pairing codes.
- **Gate 3** — Providers: real Codex, Claude, Grok and Antigravity/Gemini modes where official auth supported; clear unsupported/dependency states otherwise; at least one authenticated live reply.
- **Gate 4** — Preserve product power: voice call surfaced with actual capability diagnosis and successful call using supported pipeline; functional Marketplace/Apps/Skills, agents, routines, remote/device access, with screenshots and a feature-by-feature parity matrix.
- **Gate 5** — Ship: bilingual website, Windows download on VPS, updates, restart/session preservation, rollback and operator handoff.

For every gate report: what was tested and where (CI/fixture/physical Windows/VPS), what works, what needs credentials/permissions, remaining blockers, commit SHA, URL of builds, concrete next steps. No "done" based only on mocked smoke tests.

**Definition of Done:** A Vietnamese nontechnical user can, on a fresh Windows PC, follow the journey **website → install → email OTP → own workspace → connect model → give a task → optionally use voice and other capabilities when genuinely available**, without typing terminal commands or host pairing codes, and continue next day with preserved data.
