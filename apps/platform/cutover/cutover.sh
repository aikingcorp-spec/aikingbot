#!/usr/bin/env bash
# Root. Usage: cutover.sh <tag>   (e.g. 0a1b2c3). Needs prepare-staging.mjs, installed worker+manager units
# and a release at server/releases/0.3.0-rc.2-<tag> with its image. Rolls back automatically if health fails.
set -euo pipefail
tag=${1:?release tag}; R=/srv/aikingbot-staging; rel=$R/server/releases/0.3.0-rc.2-$tag
repo=$(cd "$(dirname "$0")/../../.." && pwd); host=$(grep '^AIKING_TRAEFIK_HOST=' $R/server/aikingbot.env | cut -d= -f2)
prev=$(readlink -f $R/server/current); ck=$(ls -1d $R/backups/pre-platform-$tag-* | tail -1)
[ -d "$rel/deploy" ] && [ "$(id -u)" = 0 ] && systemctl is-active --quiet aiking-provisioner-staging aiking-platform-staging
# Recreating the edge restarts Server A (shared network namespace) and ends any running turn.
[ "${AIKING_CONFIRM_NO_RUNNING_TURN:-}" = 1 ] || { echo "Confirm no turn is running on Server A, then rerun with AIKING_CONFIRM_NO_RUNNING_TURN=1"; exit 3; }
install -m 0644 "$repo/apps/server-platform/cutover/Caddyfile.platform" $rel/deploy/Caddyfile
install -m 0644 "$repo/apps/server-platform/cutover/compose.platform.yaml" $rel/deploy/compose.platform.yaml
ln -sfn $R/server/aikingbot.env $rel/deploy/aikingbot.env
cp $R/server/aikingbot.env $ck/server.env.before-cutover
set_a_url() { runuser -u aiking-platform -- node --input-type=module -e "
import {Registry} from '$repo/apps/server-platform/registry.mjs';
const r=new Registry('$R/platform/state/manager.db');
r.db.prepare('UPDATE servers SET base_url=? WHERE managed=0').run('$1');r.close();"; }
rollback() {
  echo "ROLLBACK"; "$repo/apps/server-platform/cutover/rollback.sh" "$prev" "$ck" || true; exit 1
}
sed -i "s|^AIKING_IMAGE=.*|AIKING_IMAGE=aikingbot-server:0.3.0-rc.2-$tag|" $R/server/aikingbot.env
grep -q '^AIKING_PLATFORM_RUNTIME_KEY=' $R/server/aikingbot.env || cat $R/platform/runtime-key.env >> $R/server/aikingbot.env
sed -i "s|^COMPOSE_FILE=.*|COMPOSE_FILE=compose.yaml:compose.traefik.yaml:compose.platform.yaml|" $R/server/aikingbot.env
ln -sfn $rel $R/server/current
set_a_url http://127.0.0.1:18891
( cd $rel/deploy && docker compose --env-file $R/server/aikingbot.env up -d ) || rollback
for i in $(seq 1 60); do
  curl -fsS --max-time 3 http://127.0.0.1:18891/api/health >/dev/null 2>&1 && curl -fsS --max-time 5 "https://$host/api/platform/session" | grep -q '"enabled":true' && ok=1 && break; sleep 2
done
[ "${ok:-0}" = 1 ] || rollback
echo "CUTOVER OK $tag (previous release: $prev)"
