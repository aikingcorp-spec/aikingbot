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
