#!/bin/sh
# AIKINGBOT container entry. With service loopback trust (the default) the
# server is started through `serve`, which prints a one-time admin pairing code
# to the container log at each start; local commands are not the owner.
# AIKING_START_MODE=launcher keeps the plain launcher (pair with
# `openmausbot.js pair` only when OMB_LOOPBACK_TRUST=owner).
set -eu
APP="${AIKING_APP_DIR:-/app}"
mkdir -p "$OMB_DATA_DIR"
chmod 0700 "$OMB_DATA_DIR"
if [ "${AIKING_START_MODE:-serve}" = "launcher" ]; then
  exec node "$APP"/dist-server/server-launcher.js
fi
set -- --port "${OMB_PORT:-8799}" --data-dir "$OMB_DATA_DIR" --label "${AIKING_SERVER_LABEL:-AIKINGBOT server}"
[ -z "${OMB_PUBLIC_URL:-}" ] || set -- "$@" --public-url "$OMB_PUBLIC_URL"
[ "${AIKING_PAIR_ON_START:-1}" = "1" ] || set -- "$@" --no-pair
exec node "$APP"/dist-server/openmausbot.js serve "$@"
