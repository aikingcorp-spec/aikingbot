import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConfigStatus } from "@/state/store";
import { setLocale } from "@/lib/i18n";
import { WorkspacesSection, WorkspacesTable, workspacesAvailable, type FleetView } from "./WorkspacesSection";

const fixture = vi.hoisted(() => ({ config: null as ConfigStatus | null }));
vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  useStore: () => ({ state: { config: fixture.config }, dispatch: () => {} }),
}));
beforeEach(() => setLocale("en"));
afterEach(() => {
  setLocale("en");
  vi.unstubAllGlobals();
});

function config(features: string[], fleet: boolean): ConfigStatus {
  return {
    composio: { configured: false }, box: { configured: false }, vps: { configured: false, sshAlias: "" },
    rooms: { turnTimeoutMinutes: 30 }, localVm: { mode: "shared", maxInstances: 1 },
    edition: { edition: features.length ? "enterprise" : "oss", features }, fleet: fleet ? { available: true } : { available: false, reason: "no-agent", fix: "run fleet init" },
  } as ConfigStatus;
}

const fleet: FleetView = {
  domain: "agentada.cc",
  operator: "aiking",
  workspaces: [
    { slug: "acme", host: "acme.agentada.cc", port: 8810, status: "running", createdAt: "", live: "active", usage: { month: "2026-09", turns: 12, costUsd: 3.5, billableUsd: 7 } },
    { slug: "globex", host: "globex.agentada.cc", port: 8820, status: "suspended", createdAt: "", live: "inactive", usage: { month: "2026-09", turns: 0, costUsd: null, billableUsd: null } },
  ],
};

describe("workspaces section", () => {
  it.each(["provisioning", "error", "retained"] as const)("does not offer normal lifecycle actions for %s workspaces", status => {
    const html = renderToStaticMarkup(createElement(WorkspacesTable, {
      fleet: { ...fleet, workspaces: [{ ...fleet.workspaces[0]!, status }] }, onAct: () => {}, busy: null,
    }));
    expect(html).toContain("Contact the server operator");
    expect(html).not.toContain("<button");
    expect(html).not.toContain(">Running<");
  });
  it("appears for open-source and enterprise once fleet status is reported, and shows why when unavailable", () => {
    // Behaviour change: OSS no longer hides Workspaces behind the admin entitlement.
    expect(workspacesAvailable(config([], true))).toBe(true);
    expect(workspacesAvailable(config([], false))).toBe(true);
    expect(workspacesAvailable(config(["admin"], false))).toBe(true);
    expect(workspacesAvailable(null)).toBe(false);
    fixture.config = config([], false);
    const blocked = renderToStaticMarkup(createElement(WorkspacesSection, { load: async () => fleet }));
    expect(blocked).toContain("Team servers are configured but the agent is not running.");
    expect(blocked).toContain("Start the team-server agent service as root on the host.");
    expect(blocked).not.toContain("no-agent");
  });

  it("shows fully Vietnamese reason and fix lines with no raw codes or English in VI locale", () => {
    setLocale("vi");
    fixture.config = {
      ...config([], false),
      fleet: {
        available: false,
        reason: "no-entitlement",
        fix: "install the enterprise layer (AIKING_ENTERPRISE_DIR) and set AIKING_LICENSE_KEY, then restart",
      },
    } as ConfigStatus;
    const html = renderToStaticMarkup(createElement(WorkspacesSection, { load: async () => fleet }));
    expect(html).toContain("Chưa cài lớp doanh nghiệp hoặc thiếu giấy phép.");
    expect(html).toContain("Cài lớp doanh nghiệp và đặt khóa giấy phép, rồi khởi động lại.");
    expect(html).not.toContain("no-entitlement");
    expect(html).not.toMatch(/install the enterprise layer/i);
    expect(html).not.toContain("AIKING_ENTERPRISE_DIR");
    expect(html).not.toContain("AIKING_LICENSE_KEY");
  });

  it("lists workspaces with their state, this month's cost and billable, and the actions that fit", () => {
    const html = renderToStaticMarkup(createElement(WorkspacesTable, { fleet, onAct: () => {}, busy: null }));
    expect(html).toContain("acme.agentada.cc");
    expect(html).toContain("Running");
    expect(html).toContain("$3.50");
    expect(html).toContain("$7.00");
    expect(html).toContain("Suspended");
    expect(html).toContain(">Suspend<");
    expect(html).toContain(">Resume<");
    expect(html).toContain(">Delete<");
    expect(html).toContain('href="https://globex.agentada.cc"');
    expect(renderToStaticMarkup(createElement(WorkspacesTable, { fleet: { ...fleet, workspaces: [] }, onAct: () => {}, busy: null }))).toContain("No installations on agentada.cc yet");
  });
});
