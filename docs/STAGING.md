# Staging

Staging is a running AIKINGBOT on the AIKING VPS (Docker, behind Caddy). It is where the developer agents work and where every change
is seen first: staging → desktop build → release.

## Deploy a build to staging
```sh
node scripts/prepare.mjs
(cd apps/desktop && npm run build && npm run build:server && node scripts/prepare-duckdb.mjs)
node scripts/server-bundle.mjs                 # .build/server-bundle/aikingbot-server-<version>-linux-x64.tar.gz
```
Unpack the archive into `/srv/aikingbot-staging/server/releases/<version>-<sha>`, build the image from its `deploy/` folder
(`AIKING_IMAGE=aikingbot-server:<version>-<sha>`), set `AIKING_IMAGE` in `/srv/aikingbot-staging/server/aikingbot.env`, point
`/srv/aikingbot-staging/platform/manager.json` `staticDir` at the release's `dist`, repoint `server/current`, and
`docker compose up -d --force-recreate aikingbot`. Check no agent turn is running first; keep the previous image for rollback.

## The agents' door to the host (`aiking-root`)
Agents run inside the container as user `aiking`. To work on the host they use one door:
`aiking-root <command>` → ssh key (`/run/agent-root`, read-only mount) → host user `aikingbot-agent` → `sudo` (root).
The owner creates the host user and key; without them the command says it is not enabled. Every command is logged by sudo
(`/var/log/aikingbot-agent-sudo.log`). Revoke: remove `/etc/sudoers.d/aikingbot-agent` and empty the user's `authorized_keys`.

Rules for agents: work in a git worktree on a `feature/*` or `fix/*` branch; never touch `/srv/aikingbot-staging/.secrets`, live data
(`/srv/aikingbot-staging/data`) or other services on the host; land changes on `main` through a pull request with the tests passing.

## Check the desktop app yourself

`node scripts/app-check.mjs <app executable> [out-dir]` starts a built desktop app, signs in through the app's own first-run screen
against a local stand-in for the account service (nothing real is contacted), walks the main screens and prints one line per check
(`PASS` or `FAIL`). It exits with 1 when a check fails and writes `report.json` plus a screenshot per screen to the out-dir.

- Build the app folder with `node scripts/build.mjs --dir`; the executable is `apps/desktop/release/linux-unpacked/aikingbot` (Windows: `win-unpacked\AIKINGBOT.exe`).
- On a machine without a screen run it under `xvfb-run -a`; in a container add `AIKING_CHECK_NO_SANDBOX=1`.
- When you change what a person sees, add a check to the script in the same change: one sentence, one assertion.
- A passing run proves what the checks say. Look at the screenshots too: a screen can pass every check and still be confusing.
