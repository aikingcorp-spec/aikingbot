import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import type { AppSettingsSection } from "@/state/store";
import type { Switch } from "./SettingsPrimitives";
import { SettingsModal } from "./SettingsModal";

const fixture = vi.hoisted(() => ({
  section: "general" as AppSettingsSection,
  advancedMode: false,
  config: { features: { browser: false }, browserEngine: { kind: "bundled", installable: true }, composio: { mode: "self" } } as Record<string, unknown>,
  api: vi.fn(),
  dispatch: vi.fn(),
  switches: [] as ComponentProps<typeof Switch>[],
  ownerOrAdmin: null as boolean | null,
}));

vi.mock("./DesktopCapabilities", () => ({ useDesktopCapabilities: () => ({ capabilities: {} }) }));
vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  api: fixture.api,
  useStore: () => ({ state: { appSettingsSection: fixture.section, instances: [], bots: [], config: fixture.config }, dispatch: fixture.dispatch }),
}));
vi.mock("@/lib/interface-mode", () => ({
  useAdvancedMode: () => fixture.advancedMode,
  setAdvancedMode: vi.fn(),
}));
vi.mock("@/lib/analytics", () => ({ analyticsEnabled: () => false, setAnalyticsEnabled: vi.fn() }));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => fixture.ownerOrAdmin }));
vi.mock("./SettingsPrimitives", async (importOriginal) => {
  const original = await importOriginal<typeof import("./SettingsPrimitives")>();
  return {
    ...original,
    Switch: (props: ComponentProps<typeof Switch>) => {
      fixture.switches.push(props);
      return createElement(original.Switch, props);
    },
  };
});
// Each page's own content has its own tests; here a marker says which ran.
const { marker } = vi.hoisted(() => ({
  marker: (name: string) => () => `MARKER:${name};`,
}));
vi.mock("./EnginesSettings", () => ({ EnginesSettings: marker("engines") }));
vi.mock("./DecisionModelSettings", () => ({ DecisionModelSettings: marker("decisionModel") }));
vi.mock("./ApiKeys", () => ({
  ApiKeyRow: marker("apiKey"),
  AnthropicEveryClaudeBot: marker("anthropicEvery"),
  OpenAiCompatUrl: marker("compatUrl"),
  OpenCodeProviderKeys: marker("opencodeProviderKeys"),
  VpsConnection: marker("vps"),
}));
vi.mock("./RemoteComputerSection", () => ({ RemoteComputerSection: marker("companion") }));
vi.mock("./CustomDomainSettings", () => ({ CustomDomainSettings: () => null }));
vi.mock("./CompanionSection", () => ({ CompanionSection: () => null }));
vi.mock("./ServerPairingCard", () => ({ ServerPairingCard: () => null }));
vi.mock("./ConnectedWorkspacesSettings", () => ({ ConnectedWorkspacesSettings: marker("desktopWorkspaces") }));
vi.mock("./LocalComputerSection", () => ({ LocalComputerSection: marker("computer") }));
vi.mock("./CloudAccountSettings", () => ({ CloudAccountSettings: marker("cloudAccount") }));
vi.mock("./OrganizationSettings", () => ({ OrganizationSettings: marker("organization") }));
vi.mock("./PeopleSection", () => ({ PeopleSection: marker("people") }));
vi.mock("./ActivitySection", () => ({ ActivitySection: marker("activity") }));
vi.mock("./UsageSection", () => ({ UsageSection: marker("usage") }));
vi.mock("./WorkspaceBackupSettings", () => ({ WorkspaceBackupSettings: marker("backups") }));
vi.mock("./RoomTurnTimeoutSettings", () => ({ RoomTurnTimeoutSettings: () => null }));
vi.mock("./CompanyBackupSettings", () => ({ CompanyBackupSettings: () => null }));

beforeEach(() => {
  vi.clearAllMocks();
  fixture.section = "general";
  fixture.advancedMode = false;
  fixture.config = { features: { browser: false }, browserEngine: { kind: "bundled", installable: true }, composio: { mode: "self" } };
  fixture.switches = [];
  fixture.ownerOrAdmin = null;
  fixture.api.mockResolvedValue({});
  vi.stubGlobal("document", { documentElement: { dataset: {} } });
  setLocale("en");
});

afterEach(() => {
  vi.unstubAllGlobals();
  setLocale("en");
});

const render = () => renderToStaticMarkup(createElement(SettingsModal));
const pages = (html: string) => [...html.matchAll(/data-settings-page="([^"]+)"/g)].map((match) => match[1]);
const currentPage = (html: string) => html.match(/data-settings-page="([^"]+)" aria-current="page"/)?.[1];
const blocks = (html: string) => [...html.matchAll(/data-settings-block="([^"]+)"/g)].map((match) => match[1]);
const rail = (html: string) => [...html.matchAll(/data-settings-section="([^"]+)"/g)].map((match) => match[1]);
const markers = (html: string) => [...html.matchAll(/MARKER:([^;]+);/g)].map((match) => match[1]);

const localDesktop = { ogb: { environments: {}, organization: {}, cloudAccount: {} } };
const remoteDesktop = { ogb: { ...localDesktop.ogb, remoteClient: { active: true } } };
// remote Basic: an admin and a client session see the same Companion route; the page never depends on the role.
const roles: Array<[string, boolean | null]> = [["unknown", null], ["client", false], ["admin", true]];

describe("Settings navigation: remote client in Basic", () => {
  it.each(roles)("offers Appearance and Remote access (Companion), no blank page (%s)", (_role, ownerOrAdmin) => {
    vi.stubGlobal("window", remoteDesktop);
    fixture.ownerOrAdmin = ownerOrAdmin;
    fixture.section = "companion";
    const html = render();
    expect(pages(html)).toEqual(["appearance", "computers"]);
    expect(currentPage(html)).toBe("computers");
    expect(blocks(html)).toEqual(["companion"]);
    expect(markers(html)).toEqual(["companion"]);
    expect(html).not.toContain("MARKER:logins");
    expect(html).not.toContain('aria-label="Enable the built-in browser"');
  });

  it.each(["general", "engines", "usage", "remote", "cloudAccount", "people", "activity"] as AppSettingsSection[])(
    "lands a remote client opening %s on Companion, not a blank pane",
    (section) => {
      vi.stubGlobal("window", remoteDesktop);
      fixture.section = section;
      const html = render();
      expect(currentPage(html)).toBe("computers");
      expect(blocks(html)).toEqual(["companion"]);
    },
  );

  it("keeps Appearance selectable while remote", () => {
    vi.stubGlobal("window", remoteDesktop);
    fixture.section = "appearance";
    const html = render();
    expect(currentPage(html)).toBe("appearance");
    expect(blocks(html)).toEqual(["appearance"]);
  });

  it("does not open account, people, activity or usage pages to a remote client", () => {
    vi.stubGlobal("window", remoteDesktop);
    fixture.ownerOrAdmin = true;
    fixture.section = "companion";
    const html = render();
    for (const hidden of ["cloudAccount", "people", "activity", "usage", "engines", "connections"]) {
      expect(blocks(html)).not.toContain(hidden);
      expect(pages(html)).not.toContain(hidden);
    }
  });

  it("hides Companion when the remote capability is absent (plain browser)", () => {
    vi.stubGlobal("window", {});
    fixture.section = "companion";
    const html = render();
    expect(pages(html)).not.toContain("companion");
    expect(blocks(html)).not.toContain("companion");
    expect(html).not.toContain("MARKER:companion");
  });
});

describe("Settings navigation: local Basic and Advanced", () => {
  it("shows Remote access ahead of Logins on Computers in local Basic", () => {
    vi.stubGlobal("window", localDesktop);
    fixture.section = "companion";
    const html = render();
    expect(pages(html)).toEqual(["general", "appearance", "ai", "connectors", "computers", "account"]);
    expect(currentPage(html)).toBe("computers");
    expect(blocks(html)).toEqual(["companion", "computer", "browser", "logins"]);
  });

  it.each(["general", "appearance", "engines", "connections", "companion", "remote", "logins", "cloudAccount"] as AppSettingsSection[])(
    "selects a rendered page for %s in local Basic",
    (section) => {
      vi.stubGlobal("window", localDesktop);
      fixture.section = section;
      const html = render();
      expect(currentPage(html)).toBeTruthy();
      expect(blocks(html).length).toBeGreaterThan(0);
    },
  );

  it.each(roles)("Advanced remote rail keeps Appearance and Companion (%s)", (_role, ownerOrAdmin) => {
    vi.stubGlobal("window", remoteDesktop);
    fixture.advancedMode = true;
    fixture.ownerOrAdmin = ownerOrAdmin;
    fixture.section = "general";
    const html = render();
    expect(rail(html)).toEqual(["appearance", "companion", "desktopWorkspaces"]);
    expect(html).toContain('data-settings-section="companion" aria-current="page"');
    expect(markers(html)).toEqual(["companion"]);
  });

  it("Advanced local keeps the full rail with Companion selectable", () => {
    vi.stubGlobal("window", localDesktop);
    fixture.advancedMode = true;
    fixture.section = "companion";
    const html = render();
    expect(rail(html)).toEqual(expect.arrayContaining(["general", "appearance", "companion", "engines", "computer", "logins"]));
    expect(html).toContain('data-settings-section="companion" aria-current="page"');
  });
});
