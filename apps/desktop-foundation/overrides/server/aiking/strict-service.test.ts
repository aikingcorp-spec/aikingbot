// Copyright (c) 2026 AIKING.
import type { IncomingMessage } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { resolveRequestAuth, serviceAllowed } from "../request-auth.ts";
import { SessionRegistry } from "../sessions.ts";
import { strictServiceAllowed } from "./strict-service.ts";

let root: string;
let sessions: SessionRegistry;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "aiking-strict-service-"));
  sessions = new SessionRegistry({ file: join(root, "sessions.json") });
  vi.stubEnv("AIKING_STRICT_SERVICE_LOOPBACK", "1");
});
afterEach(() => { vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); });
function check(path: string, method = "GET", token?: string) {
  const request = { method, headers: { host: "127.0.0.1:8799", ...(token ? { authorization: "Bearer " + token } : {}) } } as IncomingMessage;
  return resolveRequestAuth(request, { sessions, cookieName: "fixture-session", streamPath: "/api/events", url: new URL(path, "http://127.0.0.1:8799"), loopbackTrust: "service" });
}

it("denies shell access to other conversations, attachments and work without a session", () => {
  for (const [method, path] of [
    ["GET", "/api/bots"], ["GET", "/api/threads/other-thread/messages"], ["GET", "/api/attachments/other-file.png"],
    ["POST", "/api/bots/other-agent/tasks"], ["POST", "/api/bots/other-agent/messages/guarded"],
    ["POST", "/api/threads/other-thread/respond"], ["DELETE", "/api/bots/other-agent/queue/item"],
  ]) {
    expect(serviceAllowed(method!, path!)).toBe(false);
    expect(check(path!, method!).auth).toBeNull();
    expect(check(path!, method!).status).toBe(403);
  }
});
it("retains public metadata and the internal capability gate", () => {
  expect(check("/api/health").auth).toMatchObject({ kind: "loopback", trust: "service" });
  expect(serviceAllowed("POST", "/api/internal/coordinate-bots")).toBe(true);
  expect(serviceAllowed("POST", "/api/testing/internal-capability")).toBe(false);
  expect(serviceAllowed("TRACE", "/api/internal/agents")).toBe(false);
  expect(strictServiceAllowed("GET", "/api/bots", {})).toBeNull();
});
it("keeps authenticated client work while preserving admin scope boundaries", () => {
  const member = sessions.issue({ label: "fixture member", scopes: ["client"] });
  const admin = sessions.issue({ label: "fixture admin", scopes: ["admin", "client"] });
  expect(check("/api/bots", "GET", member.token).auth?.kind).toBe("session");
  expect(check("/api/bots/a/messages", "POST", member.token).auth?.kind).toBe("session");
  expect(check("/api/config", "PUT", member.token).status).toBe(403);
  expect(check("/api/config", "PUT", admin.token).auth?.kind).toBe("session");
});
