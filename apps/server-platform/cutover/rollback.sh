#!/usr/bin/env bash
# Root. Usage: rollback.sh <previous-release-dir> <checkpoint-dir>. Keeps all A/B data; never touches databases.
set -euo pipefail
prev=${1:?previous release}; ck=${2:?checkpoint}; R=/srv/aikingbot-staging
# Stop new managed runtimes (data volumes stay) and invalidate platform sessions + bootstrap.
for u in aiking-platform-staging aiking-provisioner-staging; do systemctl stop $u || true; done
docker ps -q --filter label=aiking.managed=provisioner | xargs -r docker stop
if [ -f $R/platform/state/manager.db ]; then
  node --input-type=module -e "
import {DatabaseSync} from 'node:sqlite';
const d=new DatabaseSync('$R/platform/state/manager.db');d.exec('DELETE FROM sessions;UPDATE bootstrap SET consumed=1');d.close();"
fi
cp "$ck/server.env" $R/server/aikingbot.env; chmod 600 $R/server/aikingbot.env
ln -sfn "$prev" $R/server/current
( cd "$prev/deploy" && docker compose --env-file $R/server/aikingbot.env up -d )
for i in $(seq 1 60); do docker inspect -f '{{.State.Health.Status}}' aikingbot-app-staging-aikingbot-1 2>/dev/null | grep -q healthy && echo "ROLLED BACK to $prev" && exit 0; sleep 2; done
echo "A not healthy after rollback" >&2; exit 1
