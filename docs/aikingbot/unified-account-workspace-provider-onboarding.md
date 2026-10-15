# AIKINGBOT — Unified Account → Workspace → Provider onboarding (P0)

Status: Engineering integration required. Reviewed 2026-10-15.
Scope: shipping branch `AIKINGBOT`, existing Cloudflare account API in prior R&D tree; preserve staging and OpenBot production.

## Product contract

A normal Vietnamese customer signs into AIKINGBOT with email and a one-time code, then opens their permitted workspace on Windows or web. No manual shell, Node/npm installation, CLI keys, host URL, or pairing code is required in the primary user journey. The desktop must also offer a genuinely local/offline mode that does not require an account.

Three distinct permissions are not interchangeable:
1. **AIKING account identity**: verified email and persistent device session issued by first-party Auth API.
2. **Workspace/host authorization**: host-specific permission, issued only to a user who owns the host or has an accepted membership/invitation.
3. **Model/app-provider authorization**: provider-specific OAuth/device-code/PKCE (Codex, Claude etc.) or API key where that service requires it; Gmail SMTP used to send AIKING account OTP is not Google model OAuth.

The manual host pairing code is relegated to **Advanced → Self-hosted / Emergency bootstrap**, not the default sign-in. Do not eliminate its safety properties or let successful email verification confer access to arbitrary servers.

## Source audit (verified)

- R&D tree `/srv/aikingbot-staging/AIKINGX_Bot`: Cloudflare Auth API (Workers/D1) with `POST /v1/auth/email/start`, `POST /v1/auth/email/verify`, `POST /v1/team-auth/ticket`. Auth Worker staging health: `https://aikingbot-auth-staging.aiking-corp.workers.dev/health/ready` responded HTTP 200. SMTP deployment logs indicate Gmail as sender; this alone does NOT prove desktop user login integration.
- R&D Electron implementation has `src/main/central-auth-manager.ts`, team protocol/client/host components and a separate host control plane. Reuse reviewed components instead of recreating identity/security logic.
- Shipping branch `AIKINGBOT`: React/Electron/OSS-based `apps/desktop-foundation`. Current `shipping-patches.mjs` disables AIKING Cloud sign-in unless `AIKING_CLOUD_ORIGIN` is set. The embedded cloud-account client expects `/api/cloud/desktop/authorize`, `token`, `session` and a `cloudContractVersion=1` grant. These routes do not exist in the deployed R&D Auth API, so changing the origin alone is **not** sufficient. A deliberately implemented, tested API adapter or client port is required.
- Shipping staging runs on `https://aikingbot-app.srv1866690.hstgr.cloud/`; website at `https://aikingbot.srv1866690.hstgr.cloud/`. Current self-host server uses pairing/session scopes.
- Packaged Windows report: `forbidden: this change must come from the desktop app or a paired device`, in `server/request-auth.ts`. If request originates inside packaged Electron, its private desktop-owner header is missing or not reaching the correct local server. This is a P0 reproducible bug: **do not remove the auth gate**. Smoke test must run inside the packaged Windows renderer and prove (a) desktop local mutation works, (b) direct external request remains 403.
- `b0dfd203` introduced work-in-progress rc.2 portable Windows provider Node/npm, one-click setup and built-in Windows update feed. Do not mark as shipped until Windows CI + packaging/real install succeeds.

## Target journey

1. User opens AIKINGBOT EXE or website → chooses `Sign in with email` (default) or `Use locally` (desktop only).
2. Enter email → OTP delivered through existing sender → enter code → Auth API validates (single-use and rate-limited) → create persistent account/device session. Desktop stores token using Electron `safeStorage` (OS credential store), web uses secure HttpOnly cookie.
3. App fetches the account's workspaces/hosts. If none exist, show **Create my workspace** and a safe host provisioning/claim procedure. If invited, the user sees only allowed teams. This host-binding step can use a privileged one-time bootstrap internally but should not require the end-user to type a pairing code in the normal hosted experience.
4. On selecting a workspace, desktop obtains short-lived, host/audience-bound ticket from account API `/v1/team-auth/ticket` (or the existing remote control-plane equivalent) and presents it to the target. Host checks signature/JWKS, expiry, audience, account UUID and actual membership/role; issues a host-scoped session. Do not let an OTP alone authorize an arbitrary host. Add explicit revocation/logout/session renewal behavior and reconnect without repeated OTP.
5. In workspace, user selects Codex or Claude → `Connect` installs any needed official provider CLI within app-controlled runtime if missing, then initiates provider's **own** OAuth flow; confirms account/model ready before showing Connected. Provider tokens are isolated per installation/account. No Node/npm or terminal prerequisite.
6. Marketplace / model settings return clear `Sign in`, `Awaiting permission`, or `Insufficient role` UX instead of raw `forbidden` strings; never mask a real 403 as success.
7. App's self-update checks self-hosted signed/verified release feed, preserving account, workspace, agents and provider configuration.

## Implementation order (gates)

P0-A. Reproduce the packaged Windows 403 with an E2E packaged renderer request; fix legitimate desktop capability injection while preserving external 403. Include remote-workspace vs local-workspace tests.

P0-B. Choose and document an explicit Auth API compatibility strategy: (1) port R&D central-auth-manager to shipping Electron and preserve existing `/v1/auth/email/*` and team tickets; or (2) build a first-party compatibility adapter for shipping `/api/cloud/desktop/*`, translating identity and host permissions, not billing assumptions. Avoid URL-only patches and avoid cloning a second account database.

P0-C. Wire first-party account OTP login UI to Desktop and Web. Configure environment-specific first-party host (dev/staging/prod), secure storage, restore/logout, user-visible states, and no unintended production signup. Reuse deployed Cloudflare service after confirming the exact staging contract.

P0-D. Enroll/claim own staging host and connect account to permitted workspace, requiring owner authorization; host ticket verification/whitelist and transport. Migrate existing pairing-based host access without data loss or silently promoting unclaimed users.

P0-E. Provider onboarding: package portable Node/npm, one-click install and provider OAuth; test fresh Windows machine without Node/npm installed. Keep model OAuth separate from AIKING account login.

P0-F. Keep fallback manual pairing only under Advanced / self-hosted recovery. Confirm revocation, token leakage defenses, CSRF, session isolation, web cookies and login rate limits.

## Mandatory acceptance tests

- Fresh Win11 x64, no Node/npm installed: install EXE → email OTP → authenticated account → own workspace without manual pairing → install Codex/Claude via Connect → legitimate provider OAuth → first real model reply.
- Browser: email OTP → same authorized workspace → marketplace install succeeds for an admin, denies unauthorized member, never raw 403 for an authorized operation.
- Pre-pairing untrusted browser, forged desktop-owner header, unmatched account/workspace ticket and expired/revoked session **remain denied**.
- Desktop local mode: Marketplace/install endpoint via real Electron UI not 403; external direct HTTP without capability 403.
- Close/reopen Windows: preserve account and host sessions; logout and revoke immediately remove access.
- On upgrade to rc.2+, all data and sign-ins persist. Confirm update feed, installer hashes and rollback.
- Production OpenBot and existing staging resources remain isolated and working throughout.

## Release safety

Do not claim unified auth is already delivered. In particular, email OTP existing in the older R&D source does not mean current shipping desktop uses it. Verify API contract, role enforcement and real-machine E2E before redirecting the live site to a new sign-in path. No credentials/tokens in log or repo. Keep `AIKINGBOT` branch as shipping source of truth.
