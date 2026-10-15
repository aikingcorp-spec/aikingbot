#!/usr/bin/env bash
# Builds apps/website and swaps it into <web-root>/site/current atomically.
#   bash publish-site.sh <repo-root> <web-root> [keep=5]
# The website reads the current release from <web-root>/downloads/release.json
# at build time and again in the browser, so publishing a release does not
# require a site rebuild. Rollback: point site/current at an older build:
#   ln -sfn builds/<id> <web-root>/site/current.new && mv -T <web-root>/site/current.new <web-root>/site/current
set -euo pipefail
REPO="$(cd "${1:?repo root}" && pwd)"
ROOT="$(cd "${2:?web root}" && pwd)"
KEEP="${3:-5}"
ID="$(date -u +%Y%m%dT%H%M%SZ)-$(git -C "$REPO" rev-parse --short=12 HEAD)"
mkdir -p "$ROOT/site/builds"
OUT="$ROOT/site/builds/$ID"
RELEASE_ARGS=()
[ -f "$ROOT/downloads/release.json" ] && RELEASE_ARGS=(--release "$ROOT/downloads/release.json")
node "$REPO/apps/website/build.mjs" --out "$OUT.tmp" "${RELEASE_ARGS[@]}"
mv -T "$OUT.tmp" "$OUT"
ln -sfn "builds/$ID" "$ROOT/site/current.new"
mv -T "$ROOT/site/current.new" "$ROOT/site/current"
echo "site/current -> builds/$ID"
ls -1dt "$ROOT"/site/builds/*/ | tail -n +"$((KEEP + 1))" | xargs -r rm -rf
