#!/usr/bin/env bash
# Restore a backup into an EMPTY data root (never over a live profile).
#   restore.sh <archive.tar.gz> <empty-data-root>
set -euo pipefail
ARCHIVE="${1:?archive}"; TARGET="${2:?target data root}"
[ -f "$ARCHIVE.sha256" ] && sha256sum -c "$ARCHIVE.sha256"
if [ -e "$TARGET" ] && [ -n "$(ls -A "$TARGET")" ]; then echo "$TARGET is not empty; refusing" >&2; exit 1; fi
mkdir -p "$TARGET"; chmod 0700 "$TARGET"
tar --numeric-owner -xzf "$ARCHIVE" -C "$TARGET"
echo "restored into $TARGET; point AIKING_DATA_ROOT (Docker) or the service data dir at it and start"
