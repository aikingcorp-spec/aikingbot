import { describe, expect, it } from "vitest";

import { vi as viPack } from "../strings.vi";
import { OFFICIAL_APPS } from "./official-apps";
import { OFFICIAL_APP_STEP_SLUGS, officialProviderSteps } from "./official-steps";

describe("official provider setup steps (Mai VI)", () => {
  it("covers all eight signIn:app providers", () => {
    const appSlugs = OFFICIAL_APPS.filter((app) => app.connector.signIn === "app").map((app) => app.id);
    expect(appSlugs.sort()).toEqual([...OFFICIAL_APP_STEP_SLUGS].sort());
  });

  it("returns localized steps matching catalog length", () => {
    for (const listing of OFFICIAL_APPS) {
      if (listing.connector.signIn !== "app" || !("provider" in listing.connector) || !listing.connector.provider) continue;
      const steps = officialProviderSteps(listing.id, listing.connector.provider.steps);
      expect(steps.length).toBe(listing.connector.provider.steps.length);
      expect(steps.every((step) => step.length > 0)).toBe(true);
    }
  });

  it("keeps Mai's VI GitHub / Gmail / HubSpot wording verbatim in strings.vi.ts", () => {
    expect(viPack["official.steps.github.0"]).toBe(
      "Đăng ký một OAuth app mới (cho tổ chức: Organization settings → Developer settings → OAuth Apps).",
    );
    expect(viPack["official.steps.gmail.0"]).toBe("Trong một dự án Google Cloud, bật Gmail API.");
    expect(viPack["official.steps.hubspot.0"]).toBe(
      "Trong một dự án nhà phát triển HubSpot, tạo MCP auth app và chọn các phạm vi CRM mà agent được dùng.",
    );
    expect(viPack["official.steps.slack.0"]).toBe("Tạo một Slack app cho workspace của bạn.");
    expect(viPack["official.steps.discord.0"]).toBe(
      "Tạo một application, mở OAuth2 và thêm URI chuyển hướng hiện bên dưới.",
    );
  });
});
