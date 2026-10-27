/**
 * Geometry + persistence for the floating CallOverlay (take-turns voice).
 * Visual chrome matches Mai v10 voice-float (expanded / pill / docked).
 */

export type CallOverlayCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export type CallOverlayPlacement = {
  corner: CallOverlayCorner;
  /** Free-drag offset from the snapped corner anchor (px). Cleared on snap. */
  offsetX: number;
  offsetY: number;
  minimized: boolean;
};

export const CALL_OVERLAY_STORAGE_KEY = "aiking-call-overlay.v1";

export const CALL_OVERLAY_DEFAULT: CallOverlayPlacement = {
  corner: "bottom-right",
  offsetX: 0,
  offsetY: 0,
  minimized: false,
};

/** Card size while expanded (Mai v10 voice-float). */
export const CALL_OVERLAY_CARD = { width: 280, height: 300 } as const;
/** Pill size while minimized. */
export const CALL_OVERLAY_PILL = { width: 220, height: 48 } as const;
/** Inset from viewport edges when snapped. */
export const CALL_OVERLAY_MARGIN = 16;

const CORNERS: CallOverlayCorner[] = ["top-left", "top-right", "bottom-left", "bottom-right"];

export function isCallOverlayCorner(value: unknown): value is CallOverlayCorner {
  return typeof value === "string" && (CORNERS as string[]).includes(value);
}

export function parseCallOverlayPlacement(raw: unknown): CallOverlayPlacement {
  if (!raw || typeof raw !== "object") return { ...CALL_OVERLAY_DEFAULT };
  const value = raw as Record<string, unknown>;
  return {
    corner: isCallOverlayCorner(value.corner) ? value.corner : CALL_OVERLAY_DEFAULT.corner,
    offsetX: typeof value.offsetX === "number" && Number.isFinite(value.offsetX) ? value.offsetX : 0,
    offsetY: typeof value.offsetY === "number" && Number.isFinite(value.offsetY) ? value.offsetY : 0,
    minimized: value.minimized === true,
  };
}

export function loadCallOverlayPlacement(
  read: (key: string) => string | null = (key) => {
    try { return localStorage.getItem(key); } catch { return null; }
  },
): CallOverlayPlacement {
  const text = read(CALL_OVERLAY_STORAGE_KEY);
  if (!text) return { ...CALL_OVERLAY_DEFAULT };
  try {
    return parseCallOverlayPlacement(JSON.parse(text));
  } catch {
    return { ...CALL_OVERLAY_DEFAULT };
  }
}

export function saveCallOverlayPlacement(
  placement: CallOverlayPlacement,
  write: (key: string, value: string) => void = (key, value) => {
    try { localStorage.setItem(key, value); } catch { /* ignore quota */ }
  },
): void {
  write(CALL_OVERLAY_STORAGE_KEY, JSON.stringify(placement));
}

export function overlaySize(minimized: boolean): { width: number; height: number } {
  return minimized ? { ...CALL_OVERLAY_PILL } : { ...CALL_OVERLAY_CARD };
}

/** Top-left of the card for a corner + viewport, before free-drag offset. */
export function cornerOrigin(
  corner: CallOverlayCorner,
  viewport: { width: number; height: number },
  size: { width: number; height: number },
  margin = CALL_OVERLAY_MARGIN,
): { x: number; y: number } {
  const maxX = Math.max(margin, viewport.width - size.width - margin);
  const maxY = Math.max(margin, viewport.height - size.height - margin);
  switch (corner) {
    case "top-left":
      return { x: margin, y: margin };
    case "top-right":
      return { x: maxX, y: margin };
    case "bottom-left":
      return { x: margin, y: maxY };
    case "bottom-right":
      return { x: maxX, y: maxY };
  }
}

export function clampPosition(
  point: { x: number; y: number },
  viewport: { width: number; height: number },
  size: { width: number; height: number },
  margin = CALL_OVERLAY_MARGIN,
): { x: number; y: number } {
  const maxX = Math.max(margin, viewport.width - size.width - margin);
  const maxY = Math.max(margin, viewport.height - size.height - margin);
  return {
    x: Math.min(maxX, Math.max(margin, point.x)),
    y: Math.min(maxY, Math.max(margin, point.y)),
  };
}

export function nearestCorner(
  point: { x: number; y: number },
  viewport: { width: number; height: number },
  size: { width: number; height: number },
  margin = CALL_OVERLAY_MARGIN,
): CallOverlayCorner {
  let best: CallOverlayCorner = "bottom-right";
  let bestDist = Number.POSITIVE_INFINITY;
  for (const corner of CORNERS) {
    const origin = cornerOrigin(corner, viewport, size, margin);
    const dx = point.x - origin.x;
    const dy = point.y - origin.y;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      bestDist = dist;
      best = corner;
    }
  }
  return best;
}

/** Absolute top-left including free-drag offset, clamped to the viewport. */
export function placementPosition(
  placement: CallOverlayPlacement,
  viewport: { width: number; height: number },
): { x: number; y: number } {
  const size = overlaySize(placement.minimized);
  const origin = cornerOrigin(placement.corner, viewport, size);
  return clampPosition(
    { x: origin.x + placement.offsetX, y: origin.y + placement.offsetY },
    viewport,
    size,
  );
}

/** After a drag release: snap to nearest corner and clear free offset. */
export function snapPlacement(
  point: { x: number; y: number },
  viewport: { width: number; height: number },
  minimized: boolean,
): CallOverlayPlacement {
  const size = overlaySize(minimized);
  const clamped = clampPosition(point, viewport, size);
  return {
    corner: nearestCorner(clamped, viewport, size),
    offsetX: 0,
    offsetY: 0,
    minimized,
  };
}

/** Nudge snapped corner with keyboard (Arrow keys). */
export function moveCorner(
  corner: CallOverlayCorner,
  direction: "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown",
): CallOverlayCorner {
  const map: Record<CallOverlayCorner, Record<typeof direction, CallOverlayCorner>> = {
    "top-left": { ArrowLeft: "top-left", ArrowRight: "top-right", ArrowUp: "top-left", ArrowDown: "bottom-left" },
    "top-right": { ArrowLeft: "top-left", ArrowRight: "top-right", ArrowUp: "top-right", ArrowDown: "bottom-right" },
    "bottom-left": { ArrowLeft: "bottom-left", ArrowRight: "bottom-right", ArrowUp: "top-left", ArrowDown: "bottom-left" },
    "bottom-right": { ArrowLeft: "bottom-left", ArrowRight: "bottom-right", ArrowUp: "top-right", ArrowDown: "bottom-right" },
  };
  return map[corner][direction];
}
