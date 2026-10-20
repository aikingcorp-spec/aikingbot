import { describe, expect, it } from "vitest";

import { launchdPlist, serviceCommand, servicePlan, systemdUnit, unstableInstallWarning, type ServiceSpec } from "./service-unit.ts";

const spec: ServiceSpec = {
  node: "/usr/bin/node",
  script: "/usr/lib/node_modules/aikingbot/cli.js",
  serveArgs: ["--port", "8799", "--data-dir", "/home/aiking/.aikingbot", "--domain", "aiking.example.com", "--no-pair"],
  dataDir: "/home/aiking/.aikingbot",
  user: "aiking",
  home: "/home/aiking",
  bindsLowPorts: true,
  label: "agentada",
};

describe("service units", () => {
  it("runs the same serve command, with strip-types only for a checkout", () => {
    expect(serviceCommand(spec)).toEqual(["/usr/bin/node", "/usr/lib/node_modules/aikingbot/cli.js", "serve", ...spec.serveArgs]);
    expect(serviceCommand({ ...spec, script: "/srv/AIKINGBOT/server/aikingbot.ts" })[1]).toBe("--experimental-strip-types");
  });

  it("renders a systemd unit that restarts, runs as the user, and grants low ports only for --domain", () => {
    const unit = systemdUnit(spec);
    expect(unit).toContain("Description=AIKINGBOT (agentada)");
    expect(unit).toContain("User=aiking");
    expect(unit).toContain("Environment=AIKING_DATA_DIR=/home/aiking/.aikingbot");
    expect(unit).toContain("ExecStart=/usr/bin/node /usr/lib/node_modules/aikingbot/cli.js serve --port 8799 --data-dir /home/aiking/.aikingbot --domain aiking.example.com --no-pair");
    expect(unit).toContain("Restart=always");
    expect(unit).toContain("AmbientCapabilities=CAP_NET_BIND_SERVICE");
    expect(unit).toContain("WantedBy=multi-user.target");
    const local = systemdUnit({ ...spec, bindsLowPorts: false, serveArgs: ["--port", "8799", "--data-dir", "/home/aiking/.aikingbot"] });
    expect(local).not.toContain("CAP_NET_BIND_SERVICE");
    expect(systemdUnit({ ...spec, dataDir: "/home/aiking/My Data", serveArgs: ["--data-dir", "/home/aiking/My Data"] })).toContain('ExecStart=/usr/bin/node /usr/lib/node_modules/aikingbot/cli.js serve --data-dir "/home/aiking/My Data"');
  });

  it("renders a launchd agent that keeps the server alive and logs under the data dir", () => {
    const plist = launchdPlist({ ...spec, home: "/Users/aiking", dataDir: "/Users/aiking/.aikingbot" });
    expect(plist).toContain("<string>com.aikingbot.serve</string>");
    expect(plist).toContain("<string>/usr/bin/node</string>");
    expect(plist).toContain("<string>serve</string>");
    expect(plist).toContain("<string>aiking.example.com</string>");
    expect(plist).toContain("<key>KeepAlive</key>");
    expect(plist).toContain("/Users/aiking/.aikingbot/logs/service.log");
    expect(launchdPlist({ ...spec, serveArgs: ["--label", "a & b <c>"] })).toContain("<string>a &amp; b &lt;c&gt;</string>");
  });

  it("refuses to point a service at an npx cache, and knows where each platform's file goes", () => {
    expect(unstableInstallWarning("/home/aiking/.npm/_npx/abc123/node_modules/aikingbot/cli.js")).toMatch(/npm install -g aikingbot/);
    expect(unstableInstallWarning("/usr/lib/node_modules/aikingbot/cli.js")).toBeNull();
    const linux = servicePlan("linux", "/home/aiking/.aikingbot");
    expect(linux?.installed).toBe("/etc/systemd/system/aikingbot.service");
    expect(linux?.activate.join("\n")).toContain("systemctl enable --now aikingbot");
    const mac = servicePlan("darwin", "/Users/aiking/.aikingbot", "/Users/aiking");
    expect(mac?.installed).toBe("/Users/aiking/Library/LaunchAgents/com.aikingbot.serve.plist");
    expect(mac?.activate.join("\n")).toContain("launchctl bootstrap gui/$(id -u)");
    expect(servicePlan("win32", "C:\\x")).toBeNull();
  });
});
