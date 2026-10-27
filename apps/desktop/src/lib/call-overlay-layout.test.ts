import { describe, expect, it } from "vitest";

import {
  CALL_OVERLAY_CARD,
  CALL_OVERLAY_DEFAULT,
  CALL_OVERLAY_PILL,
  CALL_OVERLAY_STORAGE_KEY,
  clampPosition,
  loadCallOverlayPlacement,
  moveCorner,
  nearestCorner,
  parseCallOverlayPlacement,
  placementPosition,
  saveCallOverlayPlacement,
  snapPlacement,
} from "./call-overlay-layout";

const viewport = { width: 1000, height: 800 };

describe("call-overlay-layout", () => {
  it("defaults to bottom-right expanded", () => {
    expect(parseCallOverlayPlacement(null)).toEqual(CALL_OVERLAY_DEFAULT);
    expect(loadCallOverlayPlacement(() => null).corner).toBe("bottom-right");
  });

  it("persists and restores placement", () => {
    const store = new Map<string, string>();
    saveCallOverlayPlacement(
      { corner: "top-left", offsetX: 0, offsetY: 0, minimized: true },
      (key, value) => store.set(key, value),
    );
    expect(store.get(CALL_OVERLAY_STORAGE_KEY)).toContain("top-left");
    const loaded = loadCallOverlayPlacement((key) => store.get(key) ?? null);
    expect(loaded).toEqual({ corner: "top-left", offsetX: 0, offsetY: 0, minimized: true });
  });

  it("clamps and snaps to the nearest corner", () => {
    const nearTopLeft = clampPosition({ x: 20, y: 20 }, viewport, CALL_OVERLAY_CARD);
    expect(nearestCorner(nearTopLeft, viewport, CALL_OVERLAY_CARD)).toBe("top-left");
    const snapped = snapPlacement({ x: 900, y: 20 }, viewport, false);
    expect(snapped.corner).toBe("top-right");
    expect(snapped.offsetX).toBe(0);
    expect(snapped.minimized).toBe(false);
  });

  it("places a minimized pill at the remembered corner", () => {
    const pos = placementPosition(
      { corner: "bottom-left", offsetX: 0, offsetY: 0, minimized: true },
      viewport,
    );
    expect(pos.x).toBe(16);
    expect(pos.y).toBe(viewport.height - CALL_OVERLAY_PILL.height - 16);
  });

  it("moves corners with arrow keys", () => {
    expect(moveCorner("bottom-right", "ArrowLeft")).toBe("bottom-left");
    expect(moveCorner("bottom-left", "ArrowUp")).toBe("top-left");
    expect(moveCorner("top-left", "ArrowRight")).toBe("top-right");
    expect(moveCorner("top-right", "ArrowDown")).toBe("bottom-right");
  });
});
