#!/usr/bin/env bash
# Consistent backup of the AIKINGBOT data root. The server is stopped for the
# copy (SQLite/WAL safety) and started again; typical downtime is seconds.
#   backup.sh <data-root> <backup-dir> [stop-cmd] [start-cmd]
# Docker:  backup.sh /srv/aikingbot-staging/server-data /srv/aikingbot-staging/backups \
#            "docker compose -f /srv/aikingbot-staging/server/deploy/compose.yaml --env-file /srv/aikingbot-staging/server/deploy/aikingbot.env stop aikingbot" \
#            "docker compose -f ... start aikingbot"
# systemd: backup.sh /var/lib/aikingbot /var/backups/aikingbot "systemctl stop aikingbot-server" "systemctl start aikingbot-server"
# Keeps the newest ${AIKING_BACKUP_KEEP:-14} archives. Encrypt off-site copies.
set -euo pipefail
DATA_ROOT="${1:?data root}"; DEST="${2:?backup dir}"; STOP="${3:-}"; START="${4:-}"
[ -d "$DATA_ROOT" ] || { echo "no data root $DATA_ROOT" >&2; exit 1; }
mkdir -p "$DEST"; chmod 0700 "$DEST"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"; OUT="$DEST/aikingbot-data-$STAMP.tar.gz"
restart() { [ -n "$START" ] && sh -c "$START"; }
if [ -n "$STOP" ]; then sh -c "$STOP"; trap restart EXIT; fi
tar --numeric-owner -czf "$OUT.partial" -C "$DATA_ROOT" .
mv "$OUT.partial" "$OUT"
sha256sum "$OUT" > "$OUT.sha256"
ls -1t "$DEST"/aikingbot-data-*.tar.gz | tail -n +"$(( ${AIKING_BACKUP_KEEP:-14} + 1 ))" | while read -r old; do rm -f "$old" "$old.sha256"; done
echo "$OUT"
