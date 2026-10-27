/**
 * Floating chrome for take-turns CallOverlay — Mai v10 voice-float visuals
 * on top of the drag/snap/minimize logic from 2506f5e.
 */
import { useCallback, useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Minus, PhoneOff, Square } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import {
  loadCallOverlayPlacement,
  moveCorner,
  overlaySize,
  placementPosition,
  saveCallOverlayPlacement,
  snapPlacement,
  type CallOverlayCorner,
  type CallOverlayPlacement,
} from "@/lib/call-overlay-layout";

type ShellProps = {
  title: string;
  status: string;
  onHangUp: () => void;
  children: ReactNode;
};

const CORNER_STYLE: Record<CallOverlayCorner, string> = {
  "top-left": "left-3 top-16",
  "top-right": "right-3 top-16",
  "bottom-left": "left-3 bottom-3",
  "bottom-right": "right-3 bottom-3",
};

function SnapGuides() {
  return (
    <>
      {(Object.keys(CORNER_STYLE) as CallOverlayCorner[]).map((corner) => (
        <div
          key={corner}
          data-call-overlay-snap={corner}
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute z-[29] size-[72px] rounded-xl border-2 border-dashed border-accent bg-accent/10",
            CORNER_STYLE[corner],
          )}
        />
      ))}
    </>
  );
}

function HangUpButton({ onHangUp, size }: { onHangUp: () => void; size: "lg" | "sm" }) {
  const dim = size === "lg" ? "size-[42px]" : "size-[34px]";
  const icon = size === "lg" ? 18 : 15;
  return (
    <button
      type="button"
      data-call-overlay-hangup="1"
      aria-label={t("call.live.hangUp")}
      title={t("call.live.hangUp")}
      className={cn(dim, "flex shrink-0 items-center justify-center rounded-full bg-danger text-white hover:brightness-110")}
      onClick={(event) => {
        event.stopPropagation();
        onHangUp();
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <PhoneOff size={icon} aria-hidden="true" />
    </button>
  );
}

export function CallOverlayShell({ title, status, onHangUp, children }: ShellProps) {
  const labelId = useId();
  const [placement, setPlacement] = useState<CallOverlayPlacement>(() => loadCallOverlayPlacement());
  const [viewport, setViewport] = useState(() => ({
    width: typeof window !== "undefined" ? window.innerWidth : 1280,
    height: typeof window !== "undefined" ? window.innerHeight : 800,
  }));
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [livePoint, setLivePoint] = useState<{ x: number; y: number } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const commit = useCallback((next: CallOverlayPlacement) => {
    setPlacement(next);
    saveCallOverlayPlacement(next);
  }, []);

  const position = livePoint ?? placementPosition(placement, viewport);
  const size = overlaySize(placement.minimized);
  const docked = !placement.minimized && !dragging && placement.offsetX === 0 && placement.offsetY === 0;

  const onHandlePointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const origin = placementPosition(placement, viewport);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: origin.x,
      originY: origin.y,
    };
    setDragging(true);
    setLivePoint(origin);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onHandlePointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setLivePoint({
      x: drag.originX + (event.clientX - drag.startX),
      y: drag.originY + (event.clientY - drag.startY),
    });
  };

  const onHandlePointerUp = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const point = {
      x: drag.originX + (event.clientX - drag.startX),
      y: drag.originY + (event.clientY - drag.startY),
    };
    dragRef.current = null;
    setDragging(false);
    setLivePoint(null);
    commit(snapPlacement(point, viewport, placement.minimized));
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* already released */ }
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }
      if (event.key === "m" || event.key === "M") {
        if (!(event.metaKey || event.ctrlKey || event.altKey)) {
          event.preventDefault();
          commit({ ...placement, offsetX: 0, offsetY: 0, minimized: !placement.minimized });
        }
        return;
      }
      if (
        event.key === "ArrowLeft"
        || event.key === "ArrowRight"
        || event.key === "ArrowUp"
        || event.key === "ArrowDown"
      ) {
        if (!event.altKey) return;
        event.preventDefault();
        commit({
          corner: moveCorner(placement.corner, event.key),
          offsetX: 0,
          offsetY: 0,
          minimized: placement.minimized,
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [commit, placement]);

  return (
    // Pass-through layer: chat stays usable underneath. No blocking backdrop.
    <div
      data-call-overlay-root="1"
      className="pointer-events-none absolute inset-0 z-30"
      aria-hidden={false}
    >
      {dragging && <SnapGuides />}
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="false"
        aria-labelledby={labelId}
        data-call-overlay-card="1"
        data-minimized={placement.minimized ? "1" : "0"}
        data-docked={docked ? "1" : "0"}
        data-dragging={dragging ? "1" : "0"}
        data-corner={placement.corner}
        tabIndex={-1}
        className={cn(
          "pointer-events-auto absolute flex flex-col overflow-hidden border border-hairline/50 bg-panel text-ink shadow-2xl shadow-black/25 outline-none",
          placement.minimized ? "rounded-full" : "rounded-2xl",
          dragging && "opacity-95 outline outline-2 outline-dashed outline-accent outline-offset-[3px]",
        )}
        style={{
          left: position.x,
          top: position.y,
          width: size.width,
          height: placement.minimized ? size.height : undefined,
          minHeight: placement.minimized ? size.height : size.height,
          maxHeight: placement.minimized ? size.height : "min(90vh, 420px)",
        }}
      >
        {placement.minimized ? (
          <div
            data-call-overlay-handle="1"
            className="flex h-12 cursor-grab items-center gap-2.5 px-3 active:cursor-grabbing"
            onPointerDown={onHandlePointerDown}
            onPointerMove={onHandlePointerMove}
            onPointerUp={onHandlePointerUp}
            onPointerCancel={onHandlePointerUp}
          >
            <span
              className="size-2.5 shrink-0 rounded-full bg-accent shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-accent)_25%,transparent)]"
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <div id={labelId} className="truncate text-[12px] font-semibold leading-tight text-ink">
                {title}
              </div>
              <div className="truncate text-[11px] text-ink-secondary">{status}</div>
            </div>
            <HangUpButton onHangUp={onHangUp} size="sm" />
            <button
              type="button"
              data-call-overlay-minimize="1"
              aria-label={t("call.overlay.expand")}
              title={t("call.overlay.expand")}
              className="rounded-md p-1.5 text-ink-secondary hover:bg-control hover:text-ink"
              onClick={(event) => {
                event.stopPropagation();
                commit({ ...placement, offsetX: 0, offsetY: 0, minimized: false });
              }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <Square size={13} aria-hidden="true" />
            </button>
          </div>
        ) : (
          <>
            <div
              data-call-overlay-handle="1"
              className="flex h-7 shrink-0 cursor-grab items-center gap-1.5 border-b border-hairline/40 bg-raised/80 px-2.5 active:cursor-grabbing"
              onPointerDown={onHandlePointerDown}
              onPointerMove={onHandlePointerMove}
              onPointerUp={onHandlePointerUp}
              onPointerCancel={onHandlePointerUp}
            >
              <span
                className="flex h-3.5 w-7 items-center justify-center gap-0.5 rounded bg-hairline/50"
                aria-hidden="true"
              >
                <span className="size-[3px] rounded-full bg-ink-tertiary" />
                <span className="size-[3px] rounded-full bg-ink-tertiary" />
                <span className="size-[3px] rounded-full bg-ink-tertiary" />
              </span>
              <span className="min-w-0 flex-1 truncate text-[11px] text-ink-secondary">
                {t("call.overlay.dragToMove")}
              </span>
              <span id={labelId} className="sr-only">{title}</span>
              <button
                type="button"
                data-call-overlay-minimize="1"
                aria-label={t("call.overlay.minimize")}
                title={t("call.overlay.minimize")}
                className="flex size-[22px] items-center justify-center rounded-md text-ink-tertiary hover:bg-control hover:text-ink"
                onClick={(event) => {
                  event.stopPropagation();
                  commit({ ...placement, offsetX: 0, offsetY: 0, minimized: true });
                }}
                onPointerDown={(event) => event.stopPropagation()}
              >
                <Minus size={13} aria-hidden="true" />
              </button>
            </div>

            <div
              data-call-overlay-body="1"
              className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 overflow-y-auto px-4 py-4"
            >
              {children}
              <div className="flex items-center justify-center gap-3 pt-1">
                <HangUpButton onHangUp={onHangUp} size="lg" />
              </div>
            </div>

            {docked && (
              <div
                data-call-overlay-docked="1"
                className="border-t border-hairline/40 bg-raised/80 px-2.5 py-1.5 text-center text-[10.5px] text-ink-secondary"
              >
                {t("call.overlay.docked")}
              </div>
            )}
          </>
        )}

        <span className="sr-only">{t("call.overlay.dragHint")}</span>
      </div>
    </div>
  );
}
