import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { CallOverlayShell } from "./CallOverlayShell";
import { CALL_OVERLAY_STORAGE_KEY, saveCallOverlayPlacement } from "@/lib/call-overlay-layout";

const memory = new Map<string, string>();

beforeEach(() => {
  memory.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => { memory.set(key, value); },
    removeItem: (key: string) => { memory.delete(key); },
    clear: () => memory.clear(),
    key: () => null,
    length: 0,
  });
  vi.stubGlobal("window", {
    ...globalThis.window,
    innerWidth: 1200,
    innerHeight: 800,
    addEventListener: () => {},
    removeEventListener: () => {},
    localStorage: globalThis.localStorage,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function render(node: ReactNode) {
  return renderToStaticMarkup(node);
}

describe("CallOverlayShell", () => {
  it("uses a pass-through root with no blocking backdrop", () => {
    const html = render(
      createElement(CallOverlayShell, {
        title: "Atlas",
        status: "Listening",
        onHangUp: () => {},
        children: createElement("span", null, "body"),
      }),
    );
    expect(html).toContain('data-call-overlay-root="1"');
    expect(html).toContain("pointer-events-none");
    expect(html).toContain('data-call-overlay-card="1"');
    expect(html).toContain("pointer-events-auto");
    expect(html).not.toContain("backdrop-blur");
    expect(html).not.toContain("bg-app/95");
    expect(html).toContain('data-call-overlay-handle="1"');
    expect(html).toContain("body");
  });

  it("renders a minimized pill without the body", () => {
    saveCallOverlayPlacement({ corner: "top-right", offsetX: 0, offsetY: 0, minimized: true });
    const html = render(
      createElement(CallOverlayShell, {
        title: "Atlas",
        status: "Working",
        onHangUp: () => {},
        children: createElement("span", { "data-body": "1" }, "secret"),
      }),
    );
    expect(html).toContain('data-minimized="1"');
    expect(html).toContain('data-corner="top-right"');
    expect(html).not.toContain("secret");
    expect(html).toContain('data-call-overlay-minimize="1"');
    expect(memory.get(CALL_OVERLAY_STORAGE_KEY)).toContain("minimized");
  });

  it("marks the card as a non-modal dialog for accessibility", () => {
    const html = render(
      createElement(CallOverlayShell, {
        title: "Atlas",
        status: "Listening",
        onHangUp: () => {},
        children: null,
      }),
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="false"');
  });
});

  it("shows Mai float chrome: drag-to-move handle, hangup control, and docked footer when snapped", () => {
    saveCallOverlayPlacement({ corner: "bottom-right", offsetX: 0, offsetY: 0, minimized: false });
    const html = render(
      createElement(CallOverlayShell, {
        title: "Atlas",
        status: "Listening",
        onHangUp: () => {},
        children: createElement("span", null, "body"),
      }),
    );
    expect(html).toContain('data-call-overlay-hangup="1"');
    expect(html).toContain('data-docked="1"');
    expect(html).toContain('data-call-overlay-docked="1"');
    expect(html).toContain("body");
  });

  it("pill mode keeps hangup and hides the expanded body", () => {
    saveCallOverlayPlacement({ corner: "bottom-right", offsetX: 0, offsetY: 0, minimized: true });
    const html = render(
      createElement(CallOverlayShell, {
        title: "Atlas",
        status: "Listening",
        onHangUp: () => {},
        children: createElement("span", { "data-body": "1" }, "secret"),
      }),
    );
    expect(html).toContain('data-minimized="1"');
    expect(html).toContain('data-call-overlay-hangup="1"');
    expect(html).not.toContain("secret");
  });

