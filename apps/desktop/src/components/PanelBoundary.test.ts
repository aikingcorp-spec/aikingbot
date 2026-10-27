// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { PanelBoundary } from "./PanelBoundary";

describe("1.15 PanelBoundary", () => {
  it("contains a crash to its frame, shows Thử lại/Retry, and recovers on click", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    let broken = true;
    const Bad = () => { if (broken) throw new Error("boom secret-text"); return createElement("p", { id: "ok" }, "ok"); };
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(createElement("div", null,
      createElement("span", { id: "sibling" }, "still here"),
      createElement(PanelBoundary, { name: "agents", children: createElement(Bad) }))));
    expect(host.querySelector("#sibling")?.textContent).toBe("still here");
    const alert = host.querySelector("[data-panel-boundary=agents]")!;
    expect(alert).not.toBeNull();
    expect(alert.textContent).not.toContain("secret-text");
    expect(alert.querySelector("button")!.textContent).toMatch(/Thử lại|Retry/);
    broken = false;
    await act(async () => alert.querySelector("button")!.click());
    expect(host.querySelector("#ok")?.textContent).toBe("ok");
    expect(JSON.stringify(quiet.mock.calls)).not.toContain("secret-text");
    quiet.mockRestore();
    root.unmount();
  });
});
