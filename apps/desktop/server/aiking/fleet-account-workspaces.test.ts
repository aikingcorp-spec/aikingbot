import { describe, expect, it } from "vitest";
import { fleetAccountWorkspaces, roleFromSignIn, signInFromConfigText } from "./fleet-account-workspaces.ts";

describe("fleetAccountWorkspaces", () => {
  const fleet = [
    { slug: "a", host: "a.example.test", signIn: { admins: ["owner@x"], members: ["m@y"] } },
    { slug: "b", host: "b.example.test", signIn: { admins: ["owner@x"], members: [] } },
    { slug: "c", host: "c.example.test", status: "retained", signIn: { admins: ["owner@x"], members: [] } },
  ];

  it("lists every server the owner admined and only invited ones for a member", () => {
    expect(fleetAccountWorkspaces("owner@x", fleet, { currentId: "a", currentName: "Alpha" }).map((w) => [w.id, w.role, w.current, w.url])).toEqual([
      ["a", "owner", true, undefined],
      ["b", "owner", false, "https://b.example.test"],
    ]);
    expect(fleetAccountWorkspaces("m@y", fleet, { currentId: "a" }).map((w) => [w.id, w.role, w.current, w.url])).toEqual([
      ["a", "member", true, undefined],
    ]);
    expect(fleetAccountWorkspaces("z@z", fleet, { currentId: "a" })).toEqual([]);
  });

  it("treats @domain as a match for role", () => {
    expect(roleFromSignIn("a@corp.test", { admins: ["@corp.test"], members: [] })).toBe("owner");
    expect(roleFromSignIn("a@corp.test", { admins: [], members: ["@corp.test"] })).toBe("member");
    expect(roleFromSignIn("a@other.test", { admins: ["@corp.test"], members: [] })).toBeNull();
  });

  it("reads signIn from config text", () => {
    expect(signInFromConfigText('{"signIn":{"admins":["A@X"],"members":["@Y.com"]}}')).toEqual({
      admins: ["a@x"],
      members: ["@y.com"],
    });
    expect(signInFromConfigText("nope")).toEqual({ admins: [], members: [] });
  });
});
