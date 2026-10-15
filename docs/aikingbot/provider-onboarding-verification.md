# Provider onboarding — continuation verification

Updated 2026-10-15. Shipping branch: `AIKINGBOT`; inherited HEAD: `e1f445b142b66141e7aff74c98b610c8f63140d8`.
The eight local Claude commits are preserved, in their original order. No reset, rebase, production deployment, or system permission change was performed.

## Source audit and implementation

The packaged mutation failure in CI run [38690305447](https://github.com/aikingcorp-spec/AIKINGX_Bot/actions/runs/38690305447)
was the renderer receiving 403 instead of the expected post-authorization 404, on both Windows and Linux.
Claude's `81a7721` preserves the desktop capability header's wire spelling through branding and checks the Electron/server names match.
That historical run predates all eight local commits; it is not evidence that the current checkout passes CI.

The continuation uses existing official CLI/ACP drivers, not a replacement authentication service:

| Provider | Installation and provider authentication | Continuation / remaining acceptance |
| --- | --- | --- |
| Codex | App-managed npm CLI and bundled Windows Node/npm; official CLI device-code login. The separate ChatGPT-plan browser-PKCE driver retains its local callback restrictions. | Auto-start is replay-safe; validated device challenge opens the official provider page. Actual account login, catalog and task response pending. |
| Claude Code | App-managed official CLI; CLI-owned login with browser/paste-code completion. | Installation continues into the official browser login once. Code/account validation remains in the existing CLI driver. Live subscription and task response pending. |
| Grok | Official x.ai binary download to app-owned tools directory, startup probe; CLI device-code login. | Web/remote no longer diverts to the API-key fallback when the workspace advertises managed installation. Existing API engine remains separate. Live login/task pending. |
| Antigravity / Gemini models | Existing managed official Google ACP runtime, per-instance profile, provider-generated Google OAuth link with state-bound loopback callback; model options discovered through ACP. | Verified install now starts Google sign-in automatically. Injection-only installation does not start subscription login. Model catalog refresh follows confirmed authentication. Live OAuth, catalog and task response pending. |
| Standalone Gemini CLI | Retained opt-in `geminiAgent` ACP driver; not the default in-app Google onboarding route. | Its comments assert a consumer retirement date while current official Gemini documentation still describes personal Google sign-in. That entitlement claim needs reconciliation; do not promise universal account eligibility or substitute an API key for available OAuth. |

Official references checked on 2026-10-15:
[Codex authentication](https://developers.openai.com/codex/auth),
[Claude Code authentication](https://code.claude.com/docs/en/authentication),
[Grok CLI reference](https://docs.x.ai/build/cli/reference),
[Google Antigravity ACP registry](https://github.com/agentclientprotocol/registry/blob/main/antigravity-acp/agent.json),
[Gemini CLI authentication](https://geminicli.com/docs/get-started/authentication/).

AIKINGBOT email OTP proves first-party account identity; workspace People/admin rules authorize access to a host.
Neither supplies Google, OpenAI, Anthropic or xAI model authorization. Provider credentials remain on the execution host.
A browser attached to a remote host cannot receive that host's loopback callback locally; the retained callback-forwarding UI is an explicit remote limitation.

## Offline verification and build

- First continuation commit: `d824c2e` (preserves the eight Claude commits).
- Provider/auth tests: 184 passed, including 12 new provider UI cases. Core: 89 passed. Full LF/CRLF integration/product/provider patch chain: 3 passed.
- Renderer, server and Core/shell typechecks passed for the provider continuation. A subsequent permission-cache fix adds file mode/UID/GID to the cache fingerprint so workspace membership does not stay cached across permission changes on filesystems with coarse timestamps; commit `f556118` passes server typecheck and the full shipping regression (1215/1215).
- Desktop security: 128 passed, 1 skipped. Electron main-process: 752 passed, 5 skipped (757 total).
- Actual managed CLI installations in isolated directories passed: Codex `0.162.1`, Claude Code `2.1.300`, Grok `1.0.52`.
  These ran `--version`; they did not borrow the coding session's provider credentials or submit a paid model prompt.
- Packaged Core → MCP → approval → persisted reply passed outside the checkout. Packaged server isolation, 13 proxies, MCP/CLI, encrypted backup, launcher and compile-cache restart passed.
- Browser Core/Marketplace/multi-agent/routine functional E2E, Voice fixture and all three clean-profile UI tours passed; standalone server smoke passed all 15 checks.
- Windows in run `38710665725` stopped before regression execution because the new multiline fixture match did not normalize CRLF. `1a911ea` repairs matching while preserving line endings. [Replacement Windows/Linux CI](https://github.com/aikingcorp-spec/AIKINGX_Bot/actions/runs/38712009756) is pending; do not count it as passed.
- Fresh Linux unpacked package built successfully. Packaged Electron launch on this VPS is blocked before renderer startup by the SUID sandbox helper lacking root ownership/mode 4755 with restricted user namespaces. No kernel/sandbox/ownership change was made; do not count this as a passed packaged renderer test. The existing CI Linux setup explicitly provisions its runner sandbox; fresh Windows remains a separate gate.
- Regression logs use per-run temp roots. The Linux hook traversal fixture targets the hook's real `/tmp` boundary; a nested TMPDIR must not change what the security assertion exercises.

## Real runtime and staging checks

- Google Antigravity pinned `agy_acp_server_1.1.1` Linux x64 downloaded from the existing official Google URL.
  Archive SHA-256 `38f62d01b32deb0907b3d39a71ec301fd36369f6ffd1cf262d4af385177f79df` matched; extracted executable sizes matched;
  real ACP initialize identity/version validation and process shutdown passed using an isolated temporary profile.
  This check did not authenticate Google or call a model. The registry now lists 1.4.0; updating all platform pins requires separately verified artifacts/protocol tests.
- Staging `/api/health`: HTTP 200. Public unauthenticated POST `/api/auth/pairing`: HTTP 403.
- Existing published Windows release remains rc.1, commit `8b98a366a099fbfed71ba23208d6e2c64c271149`, CI run `38678359992`.
  `AIKINGBOT-0.3.0-rc.1-setup.exe`: 251959193 bytes; actual file SHA-256
  `c3bd03ecbd32d2dfd2569a6c741c735086eb9ea306396856e160a1196f885ff9`, matching the live release manifest.
  HTTP Range 0–99 returned 206 and Content-Range `bytes 0-99/251959193`.
  This is the run-16 artifact; do not confuse it with the different run-17 hash in historical HANDOFF tables.
- Clean rc.2 server bundle `abb37980f93d` and latest VI/EN website are now deployed to the two isolated AIKINGBOT staging projects after a checksum-verified consistent data backup. Both containers are healthy and public stack checks pass. No installer/feed replacement or production service change was made. See the newest VPS handoff block for paths and rollback image.

## Required remaining release gates

Run regenerated renderer/server/Core typechecks, full shipping regression/security, packaged server/Core/Electron,
Windows/Linux CI for the final commit, and staging smoke. A successful runtime initialize or mocked OAuth UI test is not a live model acceptance test.
Fresh physical Windows acceptance must cover no global Node/npm, all three authorized mutations, provider authorization,
a real task reply, microphone/speaker/voice readiness, account restore/revocation and rc.1 → new installer data preservation.
Do not publish a new installer until its exact commit's CI, hashes and applicable acceptance gates are recorded.
