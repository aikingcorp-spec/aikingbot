import { describe, expect, it } from "vitest";
import { diagnoseFleet, formatFleetDiagnosis, type FleetProbe } from "./fleet-doctor.ts";

function probe(overrides: Partial<FleetProbe> & { features?: string[] } = {}): FleetProbe {
  return {
    features: overrides.features ?? ["admin"],
    socketPath: "/run/aikingbot/fleet.sock",
    registryFile: "/etc/aikingbot/fleet.json",
    exists: () => false,
    canOpen: () => false,
    which: () => true,
    inContainer: () => false,
    ...overrides,
  };
}

describe("diagnoseFleet", () => {
  it("does not block on missing entitlement: open-source fleet needs no licence", () => {
    const d = diagnoseFleet(probe({
      features: [],
      localFleet: { ready: true, root: "/tmp/aikingbot-fleet" },
    }));
    expect(d.available).toBe(true);
    expect(d.reason).toBeUndefined();
    expect(d.checks.find((c) => c.id === "entitlement")).toMatchObject({
      ok: true,
      detail: expect.stringMatching(/no licence required/),
    });
  });

  it("reports not-initialized when the registry is missing and local fleet is not ready", () => {
    const d = diagnoseFleet(probe({ localFleet: { ready: false, root: "/nope" } }));
    expect(d).toMatchObject({ available: false, reason: "not-initialized" });
    expect(d.fix).toMatch(/fleet init|AIKING_FLEET_ROOT/);
  });

  it("reports no-agent when the registry exists but the socket does not and local fleet is not ready", () => {
    const d = diagnoseFleet(probe({
      exists: (path) => path.endsWith("fleet.json"),
      localFleet: { ready: false, root: "/nope" },
    }));
    expect(d).toMatchObject({ available: false, reason: "no-agent" });
    expect(d.fix).toMatch(/aikingbot-fleet/);
  });

  it("reports container when there is no local fleet and no socket", () => {
    const d = diagnoseFleet(probe({
      inContainer: () => true,
      which: () => false,
      localFleet: { ready: false, root: "/nope" },
    }));
    expect(d).toMatchObject({ available: false, reason: "container" });
    expect(d.fix).toMatch(/AIKING_FLEET_ROOT|host/);
  });

  it("is available in a container when the local fleet root is ready (no systemd)", () => {
    const d = diagnoseFleet(probe({
      features: [],
      inContainer: () => true,
      which: () => false,
      localFleet: { ready: true, root: "/data/fleet" },
    }));
    expect(d.available).toBe(true);
    expect(d.checks.find((c) => c.id === "agent")?.detail).toMatch(/local fleet/);
  });

  it("reports socket-denied when the socket exists but is not openable", () => {
    const d = diagnoseFleet(probe({ exists: () => true, canOpen: () => false }));
    expect(d).toMatchObject({ available: false, reason: "socket-denied" });
  });

  it("is available when entitled, the socket opens, and tools are present", () => {
    const d = diagnoseFleet(probe({ exists: () => true, canOpen: () => true }));
    expect(d.available).toBe(true);
    expect(d.reason).toBeUndefined();
  });

  it("still works in a container when the host socket is mounted", () => {
    const d = diagnoseFleet(probe({
      exists: (path) => path.endsWith("fleet.sock"),
      canOpen: () => true,
      inContainer: () => true,
      which: () => false,
    }));
    expect(d.available).toBe(true);
  });

  it("formats a readable diagnosis for the CLI", () => {
    const lines = formatFleetDiagnosis(diagnoseFleet(probe({
      features: [],
      localFleet: { ready: true, root: "/tmp/fleet" },
    })));
    expect(lines.join("\n")).toMatch(/ok\s+entitlement/);
    expect(lines.at(-1)).toMatch(/can be created/);
  });
});
