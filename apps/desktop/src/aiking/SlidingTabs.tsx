// Copyright (c) 2026 AIKING. Segmented control with a sliding pill.
import { useLayoutEffect, useRef, useState, type ReactNode, type KeyboardEvent } from "react";
import { cn } from "@/lib/cn";

export type SlidingTab<T extends string> = { id: T; label: string; icon?: ReactNode };

export function SlidingTabs<T extends string>({
  tabs, value, onChange, label, className, size = "md", stretch = false,
}: {
  tabs: readonly SlidingTab<T>[];
  value: T;
  onChange: (id: T) => void;
  label: string;
  className?: string;
  size?: "sm" | "md";
  stretch?: boolean;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const measure = () => {
      const active = list.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(value)}"]`);
      if (!active) return setPill(null);
      setPill({ left: active.offsetLeft, width: active.offsetWidth });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [value, tabs]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const index = tabs.findIndex((tab) => tab.id === value);
    const next = tabs[(index + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    if (!next) return;
    onChange(next.id);
    listRef.current?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(next.id)}"]`)?.focus();
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn(
        "relative flex items-center rounded-lg bg-raised p-[3px]",
        size === "sm" ? "h-8" : "h-[34px]",
        stretch ? "w-full" : "w-fit",
        className,
      )}
    >
      {pill && (
        <span
          aria-hidden="true"
          className="absolute top-[3px] bottom-[3px] rounded-md bg-control transition-[left,width] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
          style={{ left: pill.left, width: pill.width }}
        />
      )}
      {tabs.map((tab) => {
        const selected = tab.id === value;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            data-tab-id={tab.id}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            className={cn(
              "relative z-[1] flex h-full items-center justify-center gap-1.5 rounded-md px-3 text-[13px] font-medium outline-none transition-colors focus-visible:ring-1 focus-visible:ring-focus",
              stretch && "flex-1",
              selected ? "text-ink" : "text-ink-secondary hover:text-ink",
            )}
          >
            {tab.icon}
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
