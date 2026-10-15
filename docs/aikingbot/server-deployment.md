# AIKINGBOT server deployment

The AIKINGBOT server is the same backend the desktop app embeds (API, SSE, Voice WebSocket, AIKING Core,
Marketplace, routines, groups, MCP, remote pairing), packaged to run alone on a Linux x64 VPS with Node 24.
Files: [`deploy/aikingbot-server/`](../../deploy/aikingbot-server/). Build tool:
[`apps/desktop-foundation/server-bundle.mjs`](../../apps/desktop-foundation/server-bundle.mjs).

## Architecture

```
Internet ─TLS─▶ host reverse proxy (nginx/Caddy already on the VPS)  ─┐
                                                                       │ 127.0.0.1:18080
                     ┌──── one network namespace, owned by the edge ──┴───┐
                     │ edge (Caddy :80)  ──▶  aikingbot 127.0.0.1:8799 API │
                     │                   └─▶  127.0.0.1:8800 /hooks/*      │
                     └───────── /data (bind mount AIKING_DATA_ROOT) ──────┘
```

The edge container owns the namespace and the published port, so an app restart (crash, upgrade, backup) never
detaches the proxy.

The server only binds loopback. Every remote request reaches it through a proxy with `X-Forwarded-*` headers,
which the server treats as remote: it needs a paired session. `OMB_LOOPBACK_TRUST=service` (the default here)
also stops local commands and agent shells inside the server from acting as the owner.

Data lives in one directory (`AIKING_DATA_ROOT` → `/data/.aikingbot`): SQLite stores, threads, agents, Core
transcripts, Marketplace installs (`aiking/`), uploaded files, connector configuration and encrypted secrets.
Migrations run automatically at start; an older server refuses a newer database.

## 1. Build the bundle (CI or a Linux x64 build host)

```sh
git clone --branch AIKINGBOT --recurse-submodules https://github.com/aikingcorp-spec/AIKINGX_Bot.git
cd AIKINGX_Bot
npm ci --ignore-scripts && npm ci --prefix apps/desktop-foundation --ignore-scripts
node apps/desktop-foundation/setup.mjs
node apps/desktop-foundation/server-bundle.mjs
node apps/desktop-foundation/server-smoke.mjs      # starts the bundle in a temp dir and checks it
```

Output in `.aikingbot-foundation/server-bundle/`: `aikingbot-server-<version>-linux-x64.tar.gz`, `SHA256SUMS`,
and inside the archive `bundle-manifest.json` (git commit, SHA-256 of every file).

## 2. Check the VPS (read-only)

Copy the archive to the VPS, verify the checksum, unpack it to a staging directory and run the preflight:

```sh
sha256sum -c SHA256SUMS
mkdir -p /srv/aikingbot-staging/server && tar -xzf aikingbot-server-*.tar.gz -C /srv/aikingbot-staging/server --strip-components=1
bash /srv/aikingbot-staging/server/deploy/scripts/preflight.sh /srv/aikingbot-staging/server-data 18080
```

The preflight lists running containers/ports, existing services it must not touch (`/opt/OpenBot`, the Signal/TURN
stack in `/srv/aikingbot-staging/deploy`, `.secrets`), free ports and whether the data root is new.
It fails if the chosen port is taken or the data root points at an existing product profile.

## 3a. Docker mode (recommended)

```sh
cd /srv/aikingbot-staging/server/deploy
cp aikingbot.env.example aikingbot.env && chmod 600 aikingbot.env && $EDITOR aikingbot.env
mkdir -p /srv/aikingbot-staging/server-data && chown 10001:10001 /srv/aikingbot-staging/server-data
docker compose --env-file aikingbot.env up -d --build
docker compose --env-file aikingbot.env logs aikingbot | grep -i -A3 pair     # one-time admin code
bash scripts/stack-check.sh http://127.0.0.1:18080 <public-host> <pairing-code>   # optional acceptance
```

A new admin code is printed at every start of the app; each code is single use and expires. `stack-check.sh` with
a code pairs a throwaway `stack-check` device (revoke it in Settings → Remote access) — omit the code to keep it for
your browser. Build hosts behind a TLS-inspecting proxy pass its CA for the build only:
`docker build --secret id=build_ca,src=/path/ca.crt …`.

Add the host vhost from `proxy/nginx-aikingbot.conf` (or `proxy/Caddyfile.host-snippet`) for the staging hostname,
reload the proxy, open `https://<host>/pair#code=…` and pair the admin browser/desktop. Further devices:
Settings → Remote access. A VPS where nothing uses 80/443 can let Caddy own TLS instead:
`docker compose --env-file aikingbot.env -f compose.yaml -f compose.tls.yaml up -d` with `AIKING_DOMAIN` set.

`AIKING_WITH_BROWSER=1` bakes the agents' headless browser (agent-browser + Chrome for Testing) into the image.

## 3b. systemd mode (no Docker)

Needs Node.js 24+. From the unpacked bundle: `sudo deploy/scripts/install-systemd.sh`, edit
`/etc/aikingbot/aikingbot.env`, then `systemctl enable --now aikingbot-server`. The unit runs as the `aikingbot`
user, data in `/var/lib/aikingbot`, app on `127.0.0.1:18799`, webhooks on `127.0.0.1:18800`, filesystem read-only
except the data directory. Point the host proxy at `18799` (and `/hooks/` at `18800`). Pairing code:
`journalctl -u aikingbot-server | grep -i -A3 pair`.

## Custom domain

Set `OMB_PUBLIC_URL` / `OMB_WEBHOOK_PUBLIC_URL` to the public HTTPS origin so pairing links and webhook URLs use it.
The proxy must keep the public `Host`, overwrite `X-Forwarded-For` with the client address and send
`X-Forwarded-Proto: https`. Never publish the app ports (8799/8800) directly.

## Agent computer on a VPS

A Linux desktop for agents on another server is configured from the app (Settings → Computers → VPS/SSH alias).
The server uses the operator's SSH configuration and agent; it stores no SSH keys or passwords.

## Connectors, models and speech

| Item | Where | Notes |
| --- | --- | --- |
| Anthropic key for AIKING Core | Settings → Connections, or `ANTHROPIC_API_KEY` | Scope a dedicated key; other retained engines keep their own sign-in |
| MCP servers | Settings → Plugins → MCP servers | stdio/HTTP/SSE; tools without annotations are treated as dangerous |
| Composio / OAuth apps | Settings → Connectors | Needs a Composio project; `OMB_COMPOSIO_BROKER_URL` only with your own broker |
| STT | `AIKING_STT_URL` (+ `_TOKEN`, `_MODEL`) | multipart WAV → `{ "text": "…" }`; HTTPS or loopback HTTP |
| TTS | `AIKING_TTS_URL` (+ `_TOKEN`, `_MODEL`, `_VOICE`) | JSON → PCM16, `x-sample-rate` (default 24000) |
| Marketplace catalog | `AIKING_CATALOG_FILE` | validated catalog JSON inside the data volume; restart after publishing |

Voice never approves tools by itself; approvals stay in chat.

## Backup, restore, logs, upgrades

- Backup: `deploy/scripts/backup.sh <data-root> <backup-dir> "<stop>" "<start>"` (Docker: `docker compose … stop aikingbot`
  / `start aikingbot`; systemd: `systemctl stop|start aikingbot-server`) stops the app for a consistent copy,
  writes `aikingbot-data-<UTC>.tar.gz` + `.sha256`, keeps 14. Schedule it daily (cron/systemd timer) and copy
  off-site encrypted. The app's own encrypted workspace backup (Settings → Backup) remains available.
- Restore: `deploy/scripts/restore.sh <archive> <empty-dir>`, then point `AIKING_DATA_ROOT` at it. Test restores on staging.
- Logs: `docker compose logs -f aikingbot edge` (rotated 5×20 MB) or `journalctl -u aikingbot-server`.
- Upgrade: back up, unpack the new bundle beside the old one, `docker compose up -d --build` (or rerun
  `install-systemd.sh`, which keeps `/opt/aikingbot-server.old` for rollback). Rolling back to an older bundle after a
  database migration needs the pre-upgrade backup.

## Staging → production

1. Staging runs with its own hostname, `COMPOSE_PROJECT_NAME=aikingbot-staging`, data root
   `/srv/aikingbot-staging/server-data` and port 18080. Production OpenBot is not stopped, reconfigured or read.
2. Accept staging: preflight clean, health OK, admin paired, one Core turn with an approved tool, deny/Stop,
   Voice call with real STT/TTS, one Marketplace install/remove, one routine, backup + restore into a fresh dir.
3. Production: copy the same bundle (same SHA-256) to a new directory, new env file with
   `COMPOSE_PROJECT_NAME=aikingbot`, production hostname, new data root (for example `/srv/aikingbot/data`) and a
   different port; new pairing; production keys only in that env file or Settings. Start it next to staging, verify,
   then switch DNS/proxy. Do not copy staging data into production unless that is the intended migration (then use
   backup → restore into the empty production data root).
4. Keep the backup timer and log rotation enabled before announcing the URL.
