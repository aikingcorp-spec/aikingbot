#!/usr/bin/env bash
# Read-only VPS check before installing AIKINGBOT staging. Changes nothing.
#   bash preflight.sh [data-root] [http-port]
set -u
DATA_ROOT="${1:-/srv/aikingbot-staging/server-data}"
PORT="${2:-18080}"
ok() { printf '  [ok]   %s\n' "$*"; }
warn() { printf '  [warn] %s\n' "$*"; }
bad() { printf '  [FAIL] %s\n' "$*"; FAILED=1; }
FAILED=0
echo "== Host"; uname -srm; . /etc/os-release 2>/dev/null && echo "  $PRETTY_NAME"
nproc | sed 's/^/  cpus: /'; free -h | awk '/Mem:/ {print "  memory: "$2" total, "$7" available"}'
df -h "$(dirname "$DATA_ROOT")" 2>/dev/null | awk 'NR==2 {print "  disk at data parent: "$4" free"}'
echo "== Existing services (left untouched)"
for path in /opt/OpenBot /srv/aikingbot-staging/deploy /srv/aikingbot-staging/.secrets; do
  [ -e "$path" ] && ok "present, will not be modified: $path"
done
if command -v docker >/dev/null; then
  docker ps --format '  {{.Names}}\t{{.Image}}\t{{.Ports}}' 2>/dev/null || warn "docker present but not accessible to this user"
  docker compose version >/dev/null 2>&1 && ok "docker compose available" || warn "docker compose plugin missing (needed for Docker mode)"
else warn "docker not installed (systemd mode needs Node.js 24 instead)"; fi
if command -v node >/dev/null; then
  [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 24 ] && ok "node $(node -v)" || warn "node $(node -v) is older than 24 (systemd mode needs 24+; Docker mode does not use it)"
else warn "node not installed (only needed for systemd mode)"; fi
echo "== Ports"
for p in "$PORT" 18799 18800; do
  if ss -ltnH "sport = :$p" 2>/dev/null | grep -q .; then bad "port $p already in use"; else ok "port $p free"; fi
done
for p in 80 443; do
  ss -ltnH "sport = :$p" 2>/dev/null | grep -q . && warn "port $p is used (use behind-proxy mode, not compose.tls.yaml)"
done
echo "== Reverse proxy"
for proxy in nginx caddy traefik apache2 httpd; do pgrep -x "$proxy" >/dev/null && ok "running: $proxy (add a vhost from proxy/)"; done
echo "== Data directory"
if [ -e "$DATA_ROOT" ] && [ -n "$(ls -A "$DATA_ROOT" 2>/dev/null)" ]; then
  warn "$DATA_ROOT exists and is not empty (fine for an upgrade, wrong for a first install)"
else ok "$DATA_ROOT is new/empty"; fi
case "$DATA_ROOT" in /opt/OpenBot*|*/.aikingbot*|*/.openbot*) bad "data root points at an existing product profile";; esac
exit $FAILED
