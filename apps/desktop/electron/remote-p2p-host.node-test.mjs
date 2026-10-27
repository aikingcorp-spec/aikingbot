import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import {
  isP2pFlagOn,
  isValidOutboxFrame,
  isValidPathLabel,
  isValidLogLine,
  isAllowedP2pHostNavigation,
} from "./remote-p2p-host.mjs";

const dir = path.dirname(fileURLToPath(import.meta.url));
const hostHtml = path.join(dir, "remote-p2p-host.html");

describe("remote-p2p-host flag", () => {
  it("is off by default", () => {
    assert.equal(isP2pFlagOn({}), false);
    assert.equal(isP2pFlagOn({ AIKING_REMOTE_P2P: "0" }), false);
  });
  it("is on for 1 or true", () => {
    assert.equal(isP2pFlagOn({ AIKING_REMOTE_P2P: "1" }), true);
    assert.equal(isP2pFlagOn({ AIKING_REMOTE_P2P: "true" }), true);
  });
});

describe("remote-p2p-host IPC validation", () => {
  it("accepts path labels p2p/turn/relay only", () => {
    assert.equal(isValidPathLabel("p2p"), true);
    assert.equal(isValidPathLabel("turn"), true);
    assert.equal(isValidPathLabel("relay"), true);
    assert.equal(isValidPathLabel("other"), false);
    assert.equal(isValidPathLabel(""), false);
    assert.equal(isValidPathLabel(null), false);
  });

  it("accepts bounded log lines", () => {
    assert.equal(isValidLogLine("host-ready"), true);
    assert.equal(isValidLogLine(""), false);
    assert.equal(isValidLogLine("x".repeat(2001)), false);
  });

  it("accepts host outbox signal frames and rejects junk", () => {
    assert.equal(
      isValidOutboxFrame({ t: "signal", from: "host", sid: "desktop-host", kind: "answer", sdp: "v=0" }),
      true,
    );
    assert.equal(
      isValidOutboxFrame({ kind: "ice", candidate: null }),
      true,
    );
    assert.equal(
      isValidOutboxFrame({ kind: "ice", candidate: { candidate: "a", sdpMid: "0" } }),
      true,
    );
    assert.equal(
      isValidOutboxFrame({ kind: "path", path: "relay" }),
      true,
    );
    assert.equal(isValidOutboxFrame({ kind: "bye" }), true);
    assert.equal(isValidOutboxFrame(null), false);
    assert.equal(isValidOutboxFrame({ kind: "offer" }), false); // missing sdp
    assert.equal(isValidOutboxFrame({ kind: "nope" }), false);
    assert.equal(isValidOutboxFrame({ kind: "path", path: "evil" }), false);
    assert.equal(isValidOutboxFrame({ t: "not-signal", kind: "bye" }), false);
  });
});

describe("remote-p2p-host shipped assets", () => {
  it("ships html + page js + preload with CSP and no node require in page", () => {
    const html = readFileSync(path.join(dir, "remote-p2p-host.html"), "utf8");
    const page = readFileSync(path.join(dir, "remote-p2p-host-page.js"), "utf8");
    const preload = readFileSync(path.join(dir, "remote-p2p-host-preload.cjs"), "utf8");
    const host = readFileSync(path.join(dir, "remote-p2p-host.mjs"), "utf8");

    assert.match(html, /Content-Security-Policy/);
    assert.match(html, /script-src 'self'/);
    assert.match(html, /remote-p2p-host-page\.js/);
    assert.doesNotMatch(page, /\brequire\s*\(/);
    assert.doesNotMatch(page, /ipcRenderer/);
    assert.match(page, /aikingRemoteP2p/);
    assert.match(preload, /contextBridge\.exposeInMainWorld\("aikingRemoteP2p"/);
    assert.match(host, /contextIsolation:\s*true/);
    assert.match(host, /nodeIntegration:\s*false/);
    assert.match(host, /webSecurity:\s*true/);
    assert.match(host, /sandbox:\s*true/);
    assert.match(host, /preload:\s*HOST_PRELOAD/);
    assert.doesNotMatch(host, /nodeIntegration:\s*true/);
  });
});

describe("remote-p2p-host navigation allowlist", () => {
  it("allows only the shipped local host file URL", () => {
    assert.equal(isAllowedP2pHostNavigation(pathToFileURL(hostHtml).href, hostHtml), true);
    assert.equal(isAllowedP2pHostNavigation("https://example.com/", hostHtml), false);
    assert.equal(isAllowedP2pHostNavigation("http://127.0.0.1:18789/", hostHtml), false);
    assert.equal(isAllowedP2pHostNavigation("file:///tmp/evil.html", hostHtml), false);
    assert.equal(isAllowedP2pHostNavigation("about:blank", hostHtml), false);
    assert.equal(isAllowedP2pHostNavigation("", hostHtml), false);
  });

  it("ships will-navigate, will-redirect, and setWindowOpenHandler deny", () => {
    const host = readFileSync(path.join(dir, "remote-p2p-host.mjs"), "utf8");
    assert.match(host, /installP2pHostNavigationGuards/);
    assert.match(host, /will-navigate/);
    assert.match(host, /will-redirect/);
    assert.match(host, /setWindowOpenHandler/);
    assert.match(host, /action:\s*["']deny["']/);
  });
});
