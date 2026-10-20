#!/usr/bin/env bash
# Post-deploy acceptance for a running AIKINGBOT stack (Docker or systemd).
#   stack-check.sh <edge-or-app-url> <public-host> [pairing-code]
# Example: stack-check.sh http://127.0.0.1:18080 bot-staging.example.com HBYK-D96J-JCV3
# With a pairing code it pairs a throwaway "stack-check" device and checks the
# owner routes; revoke it afterwards in Settings → Remote access.
set -euo pipefail
URL="${1:?url}"; HOST="${2:?public host}"; CODE="${3:-}"
H=(-H "Host: $HOST" -H "X-Forwarded-For: 198.51.100.9" -H "X-Forwarded-Proto: https" -H "Origin: https://$HOST")
pass() { printf 'ok   %s\n' "$*"; }
fail() { printf 'FAIL %s\n' "$*"; exit 1; }
curl -sf "$URL/api/health" | grep -q '"app"' && pass "health" || fail "health"
curl -sf "${H[@]}" "$URL/" | grep -q '<title>AIKINGBOT' && pass "UI served as AIKINGBOT" || fail "UI"
code=$(curl -s -o /dev/null -w '%{http_code}' "${H[@]}" "$URL/api/aiking/status"); [[ "$code" =~ ^40[13]$ ]] && pass "remote API needs a session ($code)" || fail "remote API returned $code without a session"
ws=$(curl -s -i -N --max-time 5 -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' "${H[@]}" "$URL/api/aiking/voice/sessions?ticket=invalid" | head -1 || true)
[[ "$ws" == *403* ]] && pass "Voice WebSocket reaches the app and refuses a bad ticket" || fail "Voice WebSocket: $ws"
if [ -n "$CODE" ]; then
  token=$(curl -s "${H[@]}" -H 'content-type: application/json' -d "{\"code\":\"$CODE\",\"deviceName\":\"stack-check\"}" "$URL/api/pair" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
  [ -n "$token" ] && pass "pairing" || fail "pairing"
  curl -sf "${H[@]}" -H "Authorization: Bearer $token" "$URL/api/aiking/status" | grep -q '"coreIntegrated":true' && pass "AIKING Core status" || fail "AIKING status"
  curl -sf "${H[@]}" -H "Authorization: Bearer $token" "$URL/api/aiking/v1/catalog" | grep -q '"listings"' && pass "Marketplace catalog" || fail "catalog"
fi
echo "stack check passed"
