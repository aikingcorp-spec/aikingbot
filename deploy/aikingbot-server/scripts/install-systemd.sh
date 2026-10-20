#!/usr/bin/env bash
# Install an unpacked server bundle as the aikingbot-server systemd service.
# Run as root from the bundle directory:  sudo deploy/scripts/install-systemd.sh
set -euo pipefail
BUNDLE="$(cd "$(dirname "$0")/../.." && pwd)"
command -v node >/dev/null || { echo "Node.js 24+ is required" >&2; exit 1; }
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 24 ] || { echo "Node.js 24+ is required" >&2; exit 1; }
id aikingbot >/dev/null 2>&1 || useradd --system --home-dir /var/lib/aikingbot --create-home --shell /usr/sbin/nologin aikingbot
install -d -o aikingbot -g aikingbot -m 0700 /var/lib/aikingbot
install -d -m 0755 /opt/aikingbot-server /etc/aikingbot
rm -rf /opt/aikingbot-server.new && cp -a "$BUNDLE" /opt/aikingbot-server.new && chown -R root:root /opt/aikingbot-server.new && chmod -R go-w /opt/aikingbot-server.new
[ -d /opt/aikingbot-server ] && rm -rf /opt/aikingbot-server.old && mv /opt/aikingbot-server /opt/aikingbot-server.old
mv /opt/aikingbot-server.new /opt/aikingbot-server
[ -f /etc/aikingbot/aikingbot.env ] || { install -m 0600 /opt/aikingbot-server/deploy/aikingbot.env.example /etc/aikingbot/aikingbot.env; echo "edit /etc/aikingbot/aikingbot.env"; }
install -m 0644 /opt/aikingbot-server/deploy/systemd/aikingbot-server.service /etc/systemd/system/aikingbot-server.service
systemctl daemon-reload
echo "start: systemctl enable --now aikingbot-server && journalctl -u aikingbot-server | grep -i -A3 pair"
