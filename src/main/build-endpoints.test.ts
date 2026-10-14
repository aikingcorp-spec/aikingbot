import { describe, expect, it, vi } from "vitest";

vi.stubGlobal("__AIKINGBOT_BUILD_AUTH_API_URL__", "");
vi.stubGlobal("__AIKINGBOT_BUILD_REMOTE_SIGNAL_URL__", "");
const { applyBuildEndpoints } = await import("./build-endpoints");

describe("applyBuildEndpoints", () => {
  it("sets the build endpoints when the environment has none", () => {
    const env: NodeJS.ProcessEnv = {};
    applyBuildEndpoints(env, "https://api.example.com", "wss://signal.example.com/v1/signal");
    expect(env.AIKINGBOT_AUTH_API_URL).toBe("https://api.example.com");
    expect(env.AIKINGBOT_REMOTE_SIGNAL_URL).toBe("wss://signal.example.com/v1/signal");
  });

  it("keeps values that are already set", () => {
    const env: NodeJS.ProcessEnv = { AIKINGBOT_AUTH_API_URL: "https://other.example.com" };
    applyBuildEndpoints(env, "https://api.example.com", "");
    expect(env.AIKINGBOT_AUTH_API_URL).toBe("https://other.example.com");
    expect(env.AIKINGBOT_REMOTE_SIGNAL_URL).toBeUndefined();
  });

  it("leaves a build without endpoints local-only", () => {
    const env: NodeJS.ProcessEnv = {};
    applyBuildEndpoints(env, "", "");
    expect(env).toEqual({});
  });
});
