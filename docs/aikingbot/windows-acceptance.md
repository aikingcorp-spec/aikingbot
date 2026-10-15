# Physical Windows acceptance — AIKINGBOT rc.2+

Status: pending. This is an operator acceptance gate, not a claim that fixtures have passed on a physical PC.
Use the exact installer whose CI commit, SHA-256 and domain URL are recorded in the release manifest. Current public V2 beta is rc.2 (packaging ec89ae8, Windows qualification 38720168034); physical acceptance below remains pending.
Do not replace the working public installer with an unqualified build. Record OS version, installer version/commit, date, provider and pass/fail for every row.

## Fresh install: no Node/npm or developer terminal

Use a clean Windows 11 x64 machine/user without Node/npm, provider CLIs, or an AIKINGBOT profile.
All following product steps must work through normal UI, with no shell command, PATH edit or manual CLI setup.

1. Website: switch VI/EN; Download Windows fetches the qualified installer from the AIKINGBOT domain; Open Web reaches the app.
2. Install and launch: first-run welcome offers local use and AIKINGBOT workspace email sign-in. Note the unsigned/SmartScreen state if no signing certificate was supplied.
3. Email OTP: request a code for an invited account, enter the delivered single-use code, enter the permitted workspace without a pairing code. Invalid/reused code fails. An uninvited verified account does not gain access.
4. Restart: close/reopen the app. Account, workspace, agents and conversations restore without a repeated OTP.
5. Create an agent using a connected provider; give a real task. The answer must actually come from that selected provider. Record the task/result rather than accepting a connected badge.

## The three reported 403 failures

| Operation in the actual EXE | Valid account/owner result | Negative check |
| --- | --- | --- |
| Marketplace Install/Connect | Install a reviewed skill/app; reload; verify persistence; remove it. Connector OAuth is separately required where applicable. | Unpaired external request, wrong role and forged desktop-owner capability remain denied. CI API tests exercise the forged header; operator checks member-role UX. |
| Provider Install/Authorize | Connect prepares the official CLI/ACP automatically, opens official login, waits for authorization and verifies the catalog/first reply. | Cancel, expired login, unsupported entitlement, offline download and retry show errors and never become success. |
| Remote Access/Pairing | Workspace owner can create a scoped pairing invitation; invited device connects; revocation removes access. | Uninvited accounts/members without admin scope cannot create owner invitations. |

## Provider acceptance: run each independently

- **Codex:** Connect → app-owned official CLI → official device sign-in → select an account-offered model → first real task reply. Keep the separate ChatGPT-plan local browser flow and hosted restrictions distinct.
- **Claude Code:** Connect → app-owned official CLI → official Claude login → complete provider code if requested → first real task reply using an entitled account.
- **Grok:** Connect → x.ai binary → official device login → first real task reply. Do not count the separate API-key engine as subscription OAuth acceptance.
- **Antigravity/Gemini models:** Connect → SHA-256-verified Google ACP runtime → Google OAuth → actual account model discovery → first real task reply. On local Windows the callback terminates on that Windows host. For a browser attached to a VPS, verify the disclosed remote-callback completion path; local credentials must not silently migrate to the VPS.

Example harmless first task: “Calculate 17 × 23 and explain the result in one sentence.” Expected result: 391.
Then give a real workspace task, for example create a short welcome note, approve the file write through the normal approval UI, and read it back.
This consumes the provider account's normal quota; offline fixtures do not satisfy this gate.

## Preserve product capabilities

- Marketplace/Skills/MCP: install, toggle, update/remove a reviewed item; configured MCP executes a real allowed tool; denial/cancel prevents its side effect.
- Multi-agent: create a group with two connected agents, give a task and verify each selected engine's actual contribution.
- Computer Control: grant the necessary Windows permissions, open a browser/file through the UI and verify actual operation on the intended host.
- Remote: disconnect/reconnect the authorized device, revoke it and confirm loss of access; a remote session must not receive the local desktop-owner credential.
- Routines: schedule a small task, restart the host and verify execution/recovery with the selected provider.
- Backup: export encrypted backup, restore into a disposable destination and verify agents/chat/attachments; destination pairing identity remains its own.
- Voice: inspect readiness before calling. Missing mic/service/provider must remain a blocked state. With real STT, selected AI engine and TTS configured, speak, hear natural speech, interrupt, mute, reconnect and verify transcript. A fixture tone is not a pass. Native realtime is a separate provider/model/transport test.

## Upgrade and revocation

rc.1 has no default updater feed; qualify one manual installer upgrade to rc.2 while preserving the same user/profile.
The rc.2 payload lacks app-update.yml; automatic download/install is not qualified. Use manual upgrades for this beta. After fixing installed updater configuration, qualify a newer version through Settings → Check for updates and the normal restart action.
Before/after both upgrades compare agents, chat history, attachments, settings, workspace sessions, provider sign-ins, skills/MCP and backup access.
Keep a safety backup and verify the documented rollback behavior. Do not mark automatic updating/data preservation accepted from unit tests alone.
A prominent workspace logout UI is a known missing feature deferred to the big update. After it is implemented, sign out and confirm immediate revocation, including an already-open remote client. Reopen and require the proper sign-in again.

Record failures and exact reproduction in HANDOFF; keep the release gate pending until the actual machine and provider checks pass.
