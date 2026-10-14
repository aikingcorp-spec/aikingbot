// Copyright (c) 2026 AIKING. Window chrome for the AIKINGBOT stage 2 shell:
// the 72px workspace rail, the workspace title, the marketplace button and
// the rounded corner where the content sheet meets the chrome.
import { ChevronsUpDown, Plus, Puzzle } from "lucide-react";
import { useStore } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { useCaptionChrome, useDesktopCapabilities } from "@/components/DesktopCapabilities";
import { openMarketplace } from "./marketplace-state";
import { at } from "./strings";

/** The AIKING workspace mark: a mint-to-teal orb, like the reference's server gradient. */
export function WorkspaceOrb({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-block shrink-0 rounded-full", className)}
      style={{
        width: size,
        height: size,
        background: "radial-gradient(circle at 32% 28%, #e8fff6 0 8%, #6ee7c0 28%, #13a374 62%, #0b3d2e 100%)",
        boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.08)",
      }}
    />
  );
}

/** The workspace tile in the rail: a rounded square with the AIKING gradient. */
function WorkspaceTile() {
  return (
    <span
      aria-hidden="true"
      className="relative block size-10 overflow-hidden rounded-xl"
      style={{
        background:
          "radial-gradient(circle at 70% 25%, rgba(232,255,246,0.9) 0 6%, transparent 30%), radial-gradient(circle at 20% 80%, #0b6b50 0, transparent 60%), linear-gradient(140deg, #6ee7c0 0%, #1fb488 45%, #0b3d2e 100%)",
      }}
    >
      <svg viewBox="0 0 40 40" className="absolute inset-0 size-full" fill="none">
        <path d="M20 9 30 27H10Z" stroke="rgba(4,38,26,0.75)" strokeWidth="2.6" strokeLinejoin="round" />
        <path d="M16 22h8M20 27v4" stroke="rgba(4,38,26,0.75)" strokeWidth="2.2" strokeLinecap="round" />
      </svg>
    </span>
  );
}

export function WorkspaceTitle({ cloudHome }: { cloudHome: boolean }) {
  return (
    <div data-workspace-title className="flex min-w-0 items-center gap-2 px-1 text-[14px] font-semibold text-ink">
      <WorkspaceOrb />
      <span className="min-w-0 truncate">{cloudHome ? t("cloudSetup.myCloud") : "Local"}</span>
      <ChevronsUpDown size={13} aria-hidden="true" className="shrink-0 text-ink-secondary" />
    </div>
  );
}

export function MarketplaceButton() {
  return (
    <button
      type="button"
      onClick={() => openMarketplace("agents")}
      aria-label={at("sidebar.marketplace")}
      title={at("sidebar.marketplace")}
      className="flex size-8 items-center justify-center rounded-md text-ink-secondary hover:bg-raised hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
    >
      <Puzzle size={17} strokeWidth={1.8} />
    </button>
  );
}

/** Paints the chrome into the top-left corner of the content sheet, so the sheet reads as rounded. */
export function SheetCorner() {
  return (
    <span
      aria-hidden="true"
      data-sheet-corner
      className="pointer-events-none absolute left-0 top-10 z-20 hidden size-3 md:block"
      style={{ background: "radial-gradient(circle at 100% 100%, transparent 11.5px, var(--color-chrome) 12px)" }}
    />
  );
}

/** The left rail: this computer's workspace, then a button to connect another one. */
export function WorkspaceRail() {
  const { dispatch } = useStore();
  const { capabilities } = useDesktopCapabilities();
  const chrome = useCaptionChrome();
  const browser = capabilities.host.label === "Browser";
  const macInset = capabilities.windowChrome === "mac-inset";
  return (
    <nav
      aria-label={at("rail.label")}
      data-workspace-rail
      className="relative hidden w-[72px] shrink-0 flex-col items-center bg-[var(--color-chrome)] md:flex"
    >
      <div className="flex h-10 w-full shrink-0 items-center justify-center gap-1.5" {...chrome.dragProps}>
        {browser && !macInset && (
          <>
            <span className="size-2.5 rounded-full bg-[#ff5f57]" />
            <span className="size-2.5 rounded-full bg-[#febc2e]" />
            <span className="size-2.5 rounded-full bg-[#28c840]" />
          </>
        )}
      </div>
      <div className="flex flex-col items-center gap-3.5 pt-1.5">
        <div className="relative flex w-full justify-center">
          <span aria-hidden="true" className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-ink" />
          <button
            type="button"
            aria-current="page"
            aria-label={at("rail.local")}
            title={at("rail.local")}
            onClick={() => dispatch({ type: "showChat" })}
            className="rounded-xl outline-none transition-transform duration-150 hover:scale-[1.04] focus-visible:ring-2 focus-visible:ring-focus"
          >
            <WorkspaceTile />
          </button>
        </div>
        <button
          type="button"
          aria-label={at("rail.add")}
          title={at("rail.add")}
          onClick={() => dispatch({ type: "toggleAppSettings", open: true, section: "remote" })}
          className="flex size-10 items-center justify-center rounded-xl bg-raised text-ink-secondary transition-colors hover:bg-raised-hover hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
        >
          <Plus size={18} />
        </button>
      </div>
    </nav>
  );
}
