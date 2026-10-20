// @vitest-environment happy-dom
import { StrictMode, act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, BotEditorStore, type InstanceInfo, type useStore } from "@/state/store";
import { EngineSetup } from "@/components/EngineSetup";
import { DeviceSignIn } from "@/components/DeviceSignIn";
import { ClaudeSignIn } from "@/components/ClaudeSignIn";
import { setLocale } from "@/lib/i18n";

vi.mock("@/state/store", async (original) => ({ ...await original<typeof import("@/state/store")>(), api: vi.fn() }));

let host: HTMLDivElement;
let root: Root;
const openExternal = vi.fn(async () => {});
const refreshInstances = vi.fn(async () => {});
const refreshModels = vi.fn(async () => {});
const dispatch = vi.fn();
const store = () => ({ state: { config: {} }, dispatch, refreshInstances, refreshModels }) as unknown as ReturnType<typeof useStore>;
const engine = (snapshot: InstanceInfo["snapshot"]): InstanceInfo => ({
  instanceId: "antigravity", driverKind: "antigravityAgent", displayName: "Antigravity", models: { default: "", options: [] },
  snapshot, install: { managed: { label: "Install official Antigravity", downloadBytes: 1024 } },
});
const available = engine({ state: "available", authenticated: false, version: "1.1.1" });
const googleLink = "https://accounts.google.com/o/oauth2/v2/auth?fixture=1";
const waiting = { phase: "waiting", flowId: "fixture", authorizationUrl: googleLink };

async function render(instance: InstanceInfo, intent: "cloud" | "inject" = "cloud") {
  await act(async () => root.render(createElement(BotEditorStore, { value: store(), children: createElement(EngineSetup, { instance, intent }) })));
}
async function install() {
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api).mockReset();
  setLocale("en");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ogb", { platform: "linux", openExternal });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals();
});

describe("managed Antigravity Connect", () => {
  it("verifies installation then opens the provider's Google sign-in without another click", async () => {
    vi.mocked(api).mockResolvedValueOnce({ instances: [available] }).mockResolvedValueOnce({ auth: waiting });
    await render(engine({ state: "unavailable" })); await install();
    expect(vi.mocked(api).mock.calls.map(([path]) => path)).toEqual(["/api/instances/antigravity/install", "/api/instances/antigravity/auth/start"]);
    expect(openExternal).toHaveBeenCalledExactlyOnceWith(googleLink);
    expect(refreshInstances).toHaveBeenCalled();
    expect(refreshModels).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain("Connected");
  });
  it.each([
    { instances: [engine({ state: "unavailable", reason: "integrity check failed" })] },
    { instances: [] },
  ])("does not authorize an unverified install", async (response) => {
    vi.mocked(api).mockResolvedValueOnce(response);
    await render(engine({ state: "unavailable" })); await install();
    expect(api).toHaveBeenCalledTimes(1); expect(openExternal).not.toHaveBeenCalled();
    expect(host.textContent).toContain("not usable yet");
  });
  it("keeps authorization/network failures visible and never starts Google login", async () => {
    vi.mocked(api).mockRejectedValueOnce(new Error("Workspace admin permission required"));
    await render(engine({ state: "unavailable" })); await install();
    expect(api).toHaveBeenCalledTimes(1); expect(openExternal).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Workspace admin permission required");
  });
  it("only installs for injection, without starting a subscription login", async () => {
    vi.mocked(api).mockResolvedValueOnce({ instances: [available] });
    await render(engine({ state: "unavailable" }), "inject"); await install();
    expect(api).toHaveBeenCalledTimes(1); expect(openExternal).not.toHaveBeenCalled();
  });
  it("reuses an already authenticated runtime without another authorization", async () => {
    vi.mocked(api).mockResolvedValueOnce({ instances: [engine({ state: "available", authenticated: true })] });
    await render(engine({ state: "unavailable" })); await install();
    expect(api).toHaveBeenCalledTimes(1); expect(openExternal).not.toHaveBeenCalled();
  });
  it("loads the actual model catalog only after authentication succeeds", async () => {
    vi.mocked(api).mockResolvedValueOnce({ instances: [available] }).mockResolvedValueOnce({ auth: { phase: "succeeded" } });
    await render(engine({ state: "unavailable" })); await install();
    expect(refreshModels).toHaveBeenCalledWith("antigravity"); expect(openExternal).not.toHaveBeenCalled();
  });
});

it("offers the managed Grok install in a web/remote workspace instead of requiring an API key", async () => {
  vi.stubGlobal("ogb", undefined);
  await render({ ...engine({ state: "unavailable" }), instanceId: "grok", driverKind: "grokAgent", displayName: "Grok", install: { server: { package: "Grok CLI from x.ai" } } });
  expect(host.textContent).toContain("Install Grok on this server");
  expect(host.querySelector("[data-engine-setup-key-instead]")).toBeNull();
});

it("starts one device login under StrictMode and opens the validated provider link", async () => {
  vi.mocked(api).mockResolvedValue({ auth: { phase: "waiting", flowId: "device-fixture", authorizationUrl: "https://auth.openai.com/codex/device", userCode: "ABCD-EFGHI", expiresAt: new Date(Date.now() + 60_000).toISOString() } });
  await act(async () => root.render(createElement(StrictMode, null, createElement(BotEditorStore, { value: store(), children: createElement(DeviceSignIn, { instanceId: "codex", autoStart: true }) }))));
  expect(api).toHaveBeenCalledTimes(1);
  expect(openExternal).toHaveBeenCalledTimes(1);
});

it("opens Claude Code's official login once after installation", async () => {
  const authorizationUrl = "https://claude.ai/oauth/authorize?fixture=1";
  vi.mocked(api).mockResolvedValue({ auth: { phase: "waiting", flowId: "claude-fixture", authorizationUrl, expiresAt: new Date(Date.now() + 60_000).toISOString() } });
  await act(async () => root.render(createElement(StrictMode, null, createElement(BotEditorStore, { value: store(), children: createElement(ClaudeSignIn, { instanceId: "claude", autoStart: true }) }))));
  expect(api).toHaveBeenCalledTimes(1);
  expect(openExternal).toHaveBeenCalledExactlyOnceWith(authorizationUrl);
});

it.each([
  { authorizationUrl: "https://untrusted.example/codex/device", userCode: "ABCD-EFGHI" },
  { authorizationUrl: "https://auth.openai.com/codex/device", userCode: "invalid" },
])("never automatically opens an invalid device challenge", async (challenge) => {
  vi.mocked(api).mockResolvedValue({ auth: { ...challenge, phase: "waiting", flowId: "bad-fixture", expiresAt: new Date(Date.now() + 60_000).toISOString() } });
  await act(async () => root.render(createElement(BotEditorStore, { value: store(), children: createElement(DeviceSignIn, { instanceId: "codex", autoStart: true }) })));
  expect(openExternal).not.toHaveBeenCalled();
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
});
