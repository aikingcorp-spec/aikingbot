// Copyright (c) 2026 AIKING. The marketplace: Agents, Apps and Skills from a
// catalog (marketplace/contract.ts), installed with the app's real endpoints
// (marketplace/installer.ts). Layout follows the OpenBot 0.39 reference
// screenshots; the code is original. "All connectors" embeds the upstream
// connector panel, so Composio sign-in and MCP management behave as before.
import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle, Check, ChevronRight, CircleDot, FolderOpen, ListFilter, Loader2, Plus, RefreshCw, Search, Sparkles, Trash2, Wrench, X,
} from "lucide-react";
import { openBot, useStore, type Bot } from "@/state/store";
import { cn } from "@/lib/cn";
import { AikingAvatar } from "@/components/Avatar";
import { normalizeState } from "@/lib/mascot";
import { PluginsPanel } from "@/components/PluginsPanel";
import { SlidingTabs } from "./SlidingTabs";
import { setMarketplaceTab, useMarketplaceTab, type MarketplaceTab } from "./marketplace-state";
import { at } from "./strings";
import { APP_LOGOS } from "./app-logos";
import type { AgentListing, AppListing, CatalogPage, InstallStatus, Listing, ListingKind, SkillListing } from "./marketplace/contract";
import { catalogSource } from "./marketplace/sources";
import { useCatalog } from "./marketplace/use-catalog";
import { categoryLabel, listingCategory, listingSummary } from "./marketplace/localize";
import { ALERT_BOX, ALERT_BUTTON, CatalogLoadError } from "./marketplace/CatalogLoadError";
import { OfficialConnect, signInOfficial } from "./marketplace/OfficialConnect";
import { OFFICIAL_APPS } from "./marketplace/official-apps";
import {
  agentStatus, appStatus, removeAgent, installAgent, installMcp, installSkill, loadAppsState, setSkillEnabled, skillHolders,
  skillStatus, testMcp, uninstallMcp, uninstallSkill, updateAgent, updateSkill, type AgentSkillState, type AppsState,
} from "./marketplace/installer";
import { useShowThreads } from "@/lib/thread-preferences";
import { PanelBoundary } from "@/components/PanelBoundary";

type Detail = { kind: ListingKind; id: string } | null;
const KIND_OF_TAB: Record<MarketplaceTab, ListingKind> = { agents: "agent", apps: "app", skills: "skill" };

// Local boundary: a render error inside the grid shows Retry/Close instead of
// unmounting the whole app. The message is fixed text; the error is not shown.
class GridBoundary extends Component<{ resetKey: string; onRetry: () => void; onClose: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidUpdate(prev: { resetKey: string }) { if (prev.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false }); }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className={ALERT_BOX}>
        <p>{at("market.crashed")}</p>
        <div className="mt-2 flex gap-2">
          <button type="button" className={ALERT_BUTTON} onClick={() => { this.setState({ failed: false }); this.props.onRetry(); }}>{at("market.retry")}</button>
          <button type="button" className={ALERT_BUTTON} onClick={this.props.onClose}>{at("market.close")}</button>
        </div>
      </div>
    );
  }
}

export function Marketplace() {
  const { dispatch, state } = useStore();
  const tab = useMarketplaceTab();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [detail, setDetail] = useState<Detail>(null);
  const [revision, setRevision] = useState(0);
  const bump = useCallback(() => setRevision((value) => value + 1), []);
  const dialogRef = useRef<HTMLDivElement>(null);
  const close = () => dispatch({ type: "togglePlugins", open: false });

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    return () => { if (opener?.isConnected) opener.focus(); };
  }, []);
  const detailRef = useRef(detail);
  detailRef.current = detail;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const nested = dialog.querySelector('[role="dialog"], [role="menu"], [role="listbox"]');
      if (nested && nested.getClientRects().length) return;
      event.preventDefault();
      event.stopPropagation();
      if (detailRef.current) {
        setDetail(null);
        dialog.focus();
      } else {
        dispatch({ type: "togglePlugins", open: false });
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [dispatch]);
  useEffect(() => {
    if (state.pluginsSurface === "mcp") setMarketplaceTab("apps");
  }, [state.pluginsSurface]);

  const kind = KIND_OF_TAB[tab];
  const { page, error, retrying, retry } = useCatalog(kind, query, category);
  // Retry unmounts the focused button; park focus on the dialog so keyboard and screen-reader users keep their place.
  const retryKeepFocus = () => { dialogRef.current?.focus(); retry(); };
  const chooseTab = (next: MarketplaceTab) => {
    setDetail(null);
    setQuery("");
    setCategory(null);
    setFilterOpen(false);
    setMarketplaceTab(next);
  };
  const [detailListing, setDetailListing] = useState<Listing | null>(null);
  const [detailError, setDetailError] = useState("");
  useEffect(() => {
    let alive = true;
    setDetailError(""); setDetailListing(null);
    if (!detail) return;
    void catalogSource().get(detail.id).then((found) => {
      if (!alive) return;
      if (found && found.kind === detail.kind) setDetailListing(found);
      else setDetailError(at("market.missingListing"));
    }).catch(cause => { if (alive) setDetailError(errorText(cause)); });
    return () => { alive = false; };
  }, [detail]);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4" onMouseDown={(event) => event.target === event.currentTarget && close()}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={at("market.title")}
        tabIndex={-1}
        data-aiking-marketplace
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const items = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]')]
            .filter((element) => element.getClientRects().length > 0);
          const first = items[0];
          const last = items.at(-1);
          if (!first || !last) return;
          if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }}
        className="animate-pop-in flex h-[min(704px,calc(100dvh-2rem))] w-[min(1040px,100%)] flex-col overflow-hidden rounded-[18px] border border-hairline bg-app shadow-[0_24px_64px_rgba(0,0,0,0.5)] outline-none"
      >
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-hairline px-6">
          {detail ? (
            <nav aria-label={at("market.breadcrumb")} className="flex min-w-0 items-center gap-2 text-[14px] font-semibold">
              <button type="button" onClick={() => setDetail(null)} className="text-ink-secondary hover:text-ink">{at("market.back")}</button>
              <ChevronRight size={14} aria-hidden="true" className="text-ink-tertiary" />
              <span className="truncate text-ink">{detailListing?.name ?? ""}</span>
            </nav>
          ) : (
            <h2 className="text-[14px] font-semibold text-ink">{at("market.title")}</h2>
          )}
          <button type="button" onClick={close} aria-label={at("market.close")} className="ml-auto flex size-7 items-center justify-center rounded-md text-ink-secondary hover:bg-raised hover:text-ink">
            <X size={15} />
          </button>
        </header>

        {detail ? (
          detailListing ? (
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6"><PanelBoundary name="marketplace-detail" resetKey={`${detailListing.kind}:${detailListing.id}`}>
              {detailListing.kind === "agent" && <AgentDetail listing={detailListing} revision={revision} onChanged={bump} onClose={close} />}
              {detailListing.kind === "skill" && <SkillDetail listing={detailListing} revision={revision} onChanged={bump} />}
              {detailListing.kind === "app" && <AppDetail listing={detailListing} revision={revision} onChanged={bump} onBrowse={() => { setDetail(null); }} />}
            </PanelBoundary></div>
          ) : detailError ? <p role="alert" className="p-6 text-danger">{detailError}</p> : <div className="flex flex-1 items-center justify-center"><Loader2 size={16} className="animate-spin text-ink-secondary" /></div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex shrink-0 flex-wrap items-center gap-3 px-6 pb-4 pt-6">
              <SlidingTabs
                size="sm"
                label={at("market.tabs")}
                value={tab}
                onChange={chooseTab}
                tabs={[
                  { id: "agents", label: at("market.agents") },
                  { id: "apps", label: at("market.apps") },
                  { id: "skills", label: at("market.skills") },
                ]}
              />
              <label className="ml-auto flex h-8 w-[240px] max-w-full items-center gap-2.5 rounded-md border border-hairline bg-raised px-3 focus-within:border-focus/70">
                <Search size={14} aria-hidden="true" className="shrink-0 text-ink-tertiary" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={at("market.search")}
                  aria-label={at("market.search")}
                  className="min-w-0 flex-1 bg-transparent text-[13px] text-ink placeholder:text-ink-tertiary focus:outline-none"
                />
              </label>
              <div className="relative">
                <button
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={filterOpen}
                  onClick={() => setFilterOpen((open) => !open)}
                  className={cn("inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium", category ? "bg-raised text-ink" : "text-ink-secondary hover:bg-raised hover:text-ink")}
                >
                  <ListFilter size={14} aria-hidden="true" />{category ? categoryLabel(category, page) : at("market.filter")}
                </button>
                {filterOpen && page && (
                  <div role="menu" aria-label={at("market.filter")} className="animate-pop-in absolute right-0 top-full z-10 mt-1 w-52 rounded-xl border border-hairline bg-menu p-1 shadow-xl">
                    {[null, ...page.categories].map((candidate) => (
                      <button
                        key={candidate ?? "all"}
                        type="button"
                        role="menuitemradio"
                        aria-checked={category === candidate}
                        onClick={() => { setCategory(candidate); setFilterOpen(false); }}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-ink hover:bg-raised"
                      >
                        <span className="w-4">{category === candidate && <Check size={13} aria-hidden="true" />}</span>
                        {candidate ? categoryLabel(candidate, page) : at("market.allCategories")}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
              {error ? <CatalogLoadError error={error} retrying={retrying} onRetry={retry} onClose={close} />
                : !page ? <Spinner />
                  : <GridBoundary resetKey={JSON.stringify([kind, query, category])} onRetry={retryKeepFocus} onClose={close}>{tab === "agents" ? <AgentGrid page={page as CatalogPage<AgentListing>} query={query} revision={revision} onChanged={bump} onOpen={(id) => setDetail({ kind: "agent", id })} onClose={close} />
                    : tab === "skills" ? <SkillGrid page={page as CatalogPage<SkillListing>} query={query} revision={revision} onOpen={(id) => setDetail({ kind: "skill", id })} />
                      : <AppGrid page={page as CatalogPage<AppListing>} query={query} category={category} onSelectCategory={setCategory} revision={revision} onChanged={bump} onOpen={(id) => setDetail({ kind: "app", id })} />}</GridBoundary>}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

// ── Shared pieces ───────────────────────────────────────────────────────

function Spinner() {
  return <div className="flex items-center justify-center py-20 text-ink-secondary"><Loader2 size={16} className="animate-spin" /></div>;
}

function EmptyState({ query }: { query: string }) {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center gap-1 text-center">
      <Search size={18} aria-hidden="true" className="mb-1 text-ink-tertiary" />
      <p className="text-[14px] font-medium text-ink">{query ? at("market.noMatch", { query }) : at("market.empty")}</p>
    </div>
  );
}

export function MarketCard({ icon, title, action, description, meta, onOpen, label, badge }: {
  icon: ReactNode; title: string; action?: ReactNode; description: string; meta?: ReactNode; onOpen?: () => void; label?: string; badge?: ReactNode;
}) {
  return (
    <div data-market-card className={cn("group relative flex min-h-[150px] min-w-0 flex-col rounded-[14px] border border-hairline bg-[color-mix(in_srgb,var(--color-raised)_55%,var(--color-app))] p-4 transition-colors", onOpen && "hover:border-ink/15 hover:bg-raised")}>
      {onOpen && <button type="button" onClick={onOpen} aria-label={label ?? title} className="absolute inset-0 rounded-[14px] outline-none focus-visible:ring-2 focus-visible:ring-focus" />}
      <div className="flex min-h-8 items-center gap-3">
        {icon}
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="truncate text-[14px] font-semibold text-ink">{title}</span>
          {badge}
        </span>
        {action && <span className="relative z-[1] shrink-0">{action}</span>}
      </div>
      <p className="mt-3 line-clamp-2 text-[13px] leading-[18px] text-ink/85">{description}</p>
      {meta && <div className="mt-auto pt-3 text-[12px] text-ink-tertiary">{meta}</div>}
    </div>
  );
}

export function OutlineButton({ children, onClick, disabled, label, tone = "default" }: { children: ReactNode; onClick?: () => void; disabled?: boolean; label?: string; tone?: "default" | "danger" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-lg border border-hairline bg-app px-3 text-[13px] font-medium transition-colors hover:bg-raised-hover disabled:opacity-50",
        tone === "danger" ? "text-danger" : "text-ink",
      )}
    >
      {children}
    </button>
  );
}

function PrimaryButton({ children, onClick, disabled, busy }: { children: ReactNode; onClick: () => void; disabled?: boolean; busy?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled || busy} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-ink px-4 text-[14px] font-medium text-app hover:bg-ink/90 disabled:opacity-60">
      {busy ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

export function StatusPill({ status }: { status: InstallStatus }) {
  const tone = status.state === "connected" || status.state === "installed" ? "ok"
    : status.state === "error" ? "error" : status.state === "needs-setup" || status.state === "partial" ? "warn" : "off";
  const text = status.state === "connected" ? at("market.connected")
    : status.state === "installed" ? (status.update ? at("market.updateAvailable") : at("market.added"))
      : status.state === "error" ? at("market.error")
        : status.state === "needs-setup" ? at("market.needsSetup")
          : status.state === "partial" ? at("market.partial") : at("market.notAdded");
  return (
    <span
      data-install-state={status.state}
      title={"detail" in status ? status.detail : undefined}
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[12px] font-medium",
        tone === "ok" && "text-success", tone === "error" && "bg-danger/10 text-danger", tone === "warn" && "bg-warning/10 text-warning", tone === "off" && "text-ink-tertiary",
      )}
    >
      {tone === "ok" ? <Check size={13} aria-hidden="true" /> : tone === "error" ? <AlertTriangle size={12} aria-hidden="true" /> : tone === "warn" ? <CircleDot size={12} aria-hidden="true" /> : null}
      {text}
    </span>
  );
}


export function OfficialBadge() {
  return (
    <span data-official-badge className="inline-flex h-5 shrink-0 items-center rounded-full bg-success/10 px-2 text-[10.5px] font-semibold tracking-[0.02em] text-success">
      {at("market.official")}
    </span>
  );
}

function Meta({ term, value }: { term: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-[12px] text-ink-tertiary">{term}</dt>
      <dd className="mt-1 text-[13px] text-ink">{value}</dd>
    </div>
  );
}

function ListingMeta({ listing }: { listing: Listing }) {
  const official = listing.kind === "app" && listing.connector.type === "official";
  return (
    <dl className="flex flex-col gap-4 border-hairline md:border-l md:pl-6">
      <Meta term={at("market.category")} value={listingCategory(listing)} />
      {official
        ? <Meta term={at("market.source")} value={at("market.official")} />
        : (
          <>
            <Meta term={at("market.creator")} value={<span className="inline-flex items-center gap-1">{listing.publisher.name}{listing.publisher.verified && <Check size={12} aria-label={at("market.verified")} className="text-success" />}</span>} />
            <Meta term={at("market.version")} value={listing.version} />
            {listing.tags.length > 0 && <Meta term={at("market.tags")} value={listing.tags.join(", ")} />}
          </>
        )}
    </dl>
  );
}

function errorText(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause);
}

export function AppIcon({ listing, size = 36 }: { listing: AppListing; size?: number }) {
  const logo = listing.logo ? APP_LOGOS[listing.logo] : undefined;
  const style = { width: size, height: size };
  if (logo) {
    return (
      <span className="flex shrink-0 items-center justify-center rounded-lg bg-raised ring-1 ring-ink/[0.06]" style={style}>
        <svg viewBox="0 0 24 24" aria-hidden="true" className="size-[55%]" fill={logo.hex === "#181717" || logo.hex === "#000000" ? "var(--color-ink)" : logo.hex}><path d={logo.path} /></svg>
      </span>
    );
  }
  const Icon = listing.connector.type === "mcp" && listing.connector.server.name === "filesystem" ? FolderOpen : Wrench;
  return <span className="flex shrink-0 items-center justify-center rounded-lg bg-raised text-accent-text ring-1 ring-ink/[0.06]" style={style}><Icon size={size * 0.48} aria-hidden="true" /></span>;
}

// ── Agents ──────────────────────────────────────────────────────────────

function AgentGrid({ page, query, revision, onChanged, onOpen, onClose }: {
  page: CatalogPage<AgentListing>; query: string; revision: number; onChanged: () => void; onOpen: (id: string) => void; onClose: () => void;
}) {
  const { state, dispatch } = useStore();
  const showThreads = useShowThreads();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  void revision;
  const add = async (listing: AgentListing) => {
    setBusy(listing.id);
    setError("");
    try {
      const { bot, warnings } = await installAgent(listing);
      dispatch({ type: "botAdded", bot, preserveSelection: true });
      if (warnings.length) setError(warnings.join("\n"));
      onChanged();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(null);
    }
  };
  if (page.items.length === 0) return <EmptyState query={query} />;
  return (
    <>
      {error && <p role="alert" className="mb-3 rounded-xl bg-danger/10 px-3 py-2 text-[12.5px] text-danger">{error}</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {page.items.map((listing) => {
          const status = agentStatus(listing, state.bots);
          const installedBot = status.state === "installed" ? state.bots.find((bot) => bot.id === status.targets[0]) : undefined;
          return (
            <MarketCard
              key={listing.id}
              icon={<AikingAvatar color={listing.look.color} bodyId={listing.look.body} state={normalizeState(listing.look.expression) ?? "idle"} size={34} animated={false} />}
              title={listing.name}
              label={`${listing.name}, ${at("market.details")}`}
              onOpen={() => onOpen(listing.id)}
              action={installedBot
                ? <OutlineButton label={`${at("market.open")} ${listing.name}`} onClick={() => { openBot(dispatch, installedBot, showThreads); onClose(); }}>{at("market.open")}</OutlineButton>
                : <OutlineButton label={`${at("market.add")} ${listing.name}`} disabled={busy !== null} onClick={() => void add(listing)}>
                  {busy === listing.id ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}{busy === listing.id ? at("market.adding") : at("market.add")}
                </OutlineButton>}
              description={listingSummary(listing)}
              meta={<span className="flex items-center gap-1.5">{listing.publisher.name} · {listingCategory(listing)}{status.state === "installed" && <> · <StatusPill status={status} /></>}</span>}
            />
          );
        })}
      </div>
    </>
  );
}

function AgentDetail({ listing, revision, onChanged, onClose }: { listing: AgentListing; revision: number; onChanged: () => void; onClose: () => void }) {
  const { state, dispatch } = useStore();
  const showThreads = useShowThreads();
  const [skills, setSkills] = useState<SkillListing[]>([]);
  const [apps, setApps] = useState<AppListing[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [reviewUpdate, setReviewUpdate] = useState(false);
  const [error, setError] = useState("");
  void revision;
  useEffect(() => {
    let alive = true;
    void Promise.all(listing.skills.map((pin) => catalogSource().get(pin.id))).then((found) => alive && setSkills(found.filter((item): item is SkillListing => item?.kind === "skill")));
    void Promise.all(listing.apps.map((id) => catalogSource().get(id))).then((found) => alive && setApps(found.filter((item): item is AppListing => item?.kind === "app")));
    return () => { alive = false; };
  }, [listing]);
  const status = agentStatus(listing, state.bots);
  const installedBot: Bot | undefined = status.state === "installed" ? state.bots.find((bot) => bot.id === status.targets[0]) : undefined;
  const add = async () => {
    setBusy(true);
    setError("");
    try {
      const { bot, warnings } = await installAgent(listing);
      dispatch({ type: "botAdded", bot, preserveSelection: true });
      if (warnings.length) setError(warnings.join("\n"));
      onChanged();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!installedBot) return;
    setBusy(true); setError("");
    try { await removeAgent(listing.id, installedBot.id); setConfirming(false); onChanged(); }
    catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  };
  const update = async () => {
    if (!installedBot) return;
    setBusy(true); setError("");
    try { await updateAgent(listing, installedBot); setReviewUpdate(false); onChanged(); }
    catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  };
  return (
    <div data-listing-detail={listing.id}>
      <div className="flex flex-wrap items-start gap-4">
        <AikingAvatar color={listing.look.color} bodyId={listing.look.body} state={normalizeState(listing.look.expression) ?? "idle"} size={48} animated={false} />
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-2 text-[18px] font-semibold text-ink">{listing.name}<StatusPill status={status} /></h3>
          <p className="mt-1 text-[13px] text-ink-secondary">{listingSummary(listing)}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {installedBot ? (
            <>
              {confirming
                ? <OutlineButton tone="danger" disabled={busy} onClick={() => void remove()}><Trash2 size={14} aria-hidden="true" />{at("market.confirmRemove")}</OutlineButton>
                : <OutlineButton tone="danger" disabled={busy} onClick={() => setConfirming(true)}><Trash2 size={14} aria-hidden="true" />{at("market.removeAgent")}</OutlineButton>}
              {status.state === "installed" && status.update && <OutlineButton disabled={busy} onClick={() => reviewUpdate ? void update() : setReviewUpdate(true)}><RefreshCw size={14} aria-hidden="true" />{at(reviewUpdate ? "market.applyUpdate" : "market.update")}</OutlineButton>}
              <PrimaryButton onClick={() => { openBot(dispatch, installedBot, showThreads); onClose(); }}>{at("market.openAgent")}</PrimaryButton>
            </>
          ) : <PrimaryButton busy={busy} onClick={() => void add()}><Plus size={15} aria-hidden="true" />{at("market.addAgent")}</PrimaryButton>}
        </div>
      </div>
      {confirming && <p className="mt-3 text-[12.5px] text-ink-secondary">{at("market.removeAgentHint", { name: installedBot?.name ?? listing.profile.name })}</p>}
      {reviewUpdate && <p className="mt-3 text-[12.5px] text-ink-secondary">{at("market.updateHint", { name: installedBot?.name ?? listing.profile.name })}</p>}
      {error && <p role="alert" className="mt-3 rounded-xl bg-danger/10 px-3 py-2 text-[12.5px] text-danger">{error}</p>}
      <div className="mt-6 grid gap-8 md:grid-cols-[minmax(0,1fr)_220px]">
        <div className="flex flex-col gap-6">
          <section>
            <h4 className="mb-2 text-[14px] font-semibold text-ink">{at("market.instructions")}</h4>
            <p className="rounded-xl bg-raised px-4 py-3 text-[13px] leading-[20px] text-ink/85">{listing.profile.instructions}</p>
          </section>
          {skills.length > 0 && (
            <section>
              <h4 className="mb-2 text-[14px] font-semibold text-ink">{at("market.skillsSection")}</h4>
              <ul className="flex flex-col gap-1">
                {skills.map((skill) => (
                  <li key={skill.id} className="flex items-center gap-3 rounded-lg px-1 py-1.5">
                    <span className="flex size-9 items-center justify-center rounded-lg bg-raised text-ink-secondary"><Sparkles size={16} aria-hidden="true" /></span>
                    <span><span className="block text-[13px] font-medium text-ink">{skill.name}</span><span className="block text-[12px] text-ink-tertiary">{at("market.version")} {skill.version}</span></span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {(listing.routines?.length ?? 0) > 0 && (
            <section>
              <h4 className="mb-2 text-[14px] font-semibold text-ink">{at("market.routinesSection")}</h4>
              <ul className="flex flex-col gap-1">
                {listing.routines!.map((routine) => (
                  <li key={routine.name} className="rounded-lg px-1 py-1.5 text-[13px]">
                    <span className="block font-medium text-ink">{routine.name}</span>
                    <span className="block text-[12px] text-ink-tertiary">{routine.time} · {routine.enabled ? at("market.routineOn") : at("market.routineOff")}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {apps.length > 0 && (
            <section>
              <h4 className="mb-2 text-[14px] font-semibold text-ink">{at("market.worksWith")}</h4>
              <div className="flex flex-wrap gap-2">
                {apps.map((app) => <span key={app.id} className="inline-flex h-8 items-center gap-2 rounded-lg border border-hairline bg-raised pl-1 pr-2.5 text-[13px] text-ink"><AppIcon listing={app} size={24} />{app.name}</span>)}
              </div>
            </section>
          )}
        </div>
        <ListingMeta listing={listing} />
      </div>
    </div>
  );
}

// ── Skills ──────────────────────────────────────────────────────────────

function useSkillHolders(revision: number) {
  const { state } = useStore();
  const [holders, setHolders] = useState<Map<string, AgentSkillState[]> | null>(null);
  const agentKey = state.bots.filter((bot) => !bot.hidden).map((bot) => bot.id).join(",");
  const botsRef = useRef(state.bots);
  botsRef.current = state.bots;
  useEffect(() => {
    let alive = true;
    void skillHolders(botsRef.current).then((map) => alive && setHolders(map));
    return () => { alive = false; };
  }, [agentKey, revision]);
  return holders;
}

function SkillGrid({ page, query, revision, onOpen }: { page: CatalogPage<SkillListing>; query: string; revision: number; onOpen: (id: string) => void }) {
  const holders = useSkillHolders(revision);
  if (page.items.length === 0) return <EmptyState query={query} />;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {page.items.map((listing) => {
        const status = holders ? skillStatus(listing, holders) : null;
        const count = status?.state === "installed" ? status.targets.length : 0;
        return (
          <MarketCard
            key={listing.id}
            icon={<span className="flex size-9 items-center justify-center rounded-lg bg-raised text-ink-secondary"><Sparkles size={17} aria-hidden="true" /></span>}
            title={listing.name}
            label={`${listing.name}, ${at("market.details")}`}
            onOpen={() => onOpen(listing.id)}
            action={count > 0 ? <span className="inline-flex h-8 items-center gap-1 text-[12.5px] text-success"><Check size={13} aria-hidden="true" />{at("market.skillOn", { count })}</span> : <OutlineButton label={`${at("market.add")} ${listing.name}`} onClick={() => onOpen(listing.id)}><Plus size={14} aria-hidden="true" />{at("market.add")}</OutlineButton>}
            description={listingSummary(listing)}
            meta={`${listing.publisher.name} · ${listingCategory(listing)} · ${at("market.version")} ${listing.version}`}
          />
        );
      })}
    </div>
  );
}

function SkillDetail({ listing, revision, onChanged }: { listing: SkillListing; revision: number; onChanged: () => void }) {
  const { state } = useStore();
  const holders = useSkillHolders(revision);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const agents = state.bots.filter((bot) => !bot.hidden);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const holding = new Map((holders?.get(listing.skillName) ?? []).map((entry) => [entry.botId, { ...entry, enabled: pending[entry.botId] ?? entry.enabled }]));
  useEffect(() => setPending({}), [holders]);
  const act = async (botId: string, run: () => Promise<void>): Promise<boolean> => {
    setBusy(botId);
    setError("");
    try {
      await run();
      onChanged();
      return true;
    } catch (cause) {
      setError(errorText(cause));
      return false;
    } finally {
      setBusy(null);
    }
  };
  const body = listing.text.replace(/^---[\s\S]*?---\s*/, "");
  return (
    <div data-listing-detail={listing.id}>
      <div className="flex items-start gap-4">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-raised text-ink-secondary"><Sparkles size={22} aria-hidden="true" /></span>
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-2 text-[18px] font-semibold text-ink">{listing.name}{holders && <StatusPill status={skillStatus(listing, holders)} />}</h3>
          <p className="mt-1 text-[13px] text-ink-secondary">{listingSummary(listing)}</p>
        </div>
      </div>
      {error && <p role="alert" className="mt-3 rounded-xl bg-danger/10 px-3 py-2 text-[12.5px] text-danger">{error}</p>}
      <div className="mt-6 grid gap-8 md:grid-cols-[minmax(0,1fr)_220px]">
        <div className="flex flex-col gap-6">
          <section aria-labelledby="skill-agents">
            <h4 id="skill-agents" className="mb-2 text-[14px] font-semibold text-ink">{at("market.useWith")}</h4>
            {agents.length === 0 ? <p className="text-[13px] text-ink-secondary">{at("market.noAgents")}</p> : (
              <ul className="divide-y divide-hairline overflow-hidden rounded-xl bg-raised">
                {agents.map((bot) => {
                  const held = holding.get(bot.id);
                  return (
                    <li key={bot.id} data-skill-agent={bot.id} className="flex items-center gap-3 px-3 py-2.5">
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{bot.name}</span>
                      {held ? (
                        <>
                          <OutlineButton label={at("market.updateSkillFor", { name: listing.name, bot: bot.name })} disabled={busy !== null} onClick={() => void act(bot.id, () => updateSkill(listing, bot.id, bot.threadId))}><RefreshCw size={13} aria-hidden="true" />{at("market.update")}</OutlineButton>
                          <label className="flex items-center gap-2 text-[12px] text-ink-secondary">
                            <input
                              type="checkbox"
                              checked={held.enabled}
                              disabled={busy !== null}
                              aria-label={at("market.skillEnabledFor", { name: bot.name })}
                              onChange={(event) => {
                                const enabled = event.target.checked;
                                setPending((current) => ({ ...current, [bot.id]: enabled }));
                                void act(bot.id, () => setSkillEnabled(listing, bot.id, enabled)).then((ok) => {
                                  if (!ok) setPending((current) => { const { [bot.id]: _undo, ...rest } = current; return rest; });
                                });
                              }}
                              className="accent-[var(--color-accent)]"
                            />
                            {held.enabled ? at("market.on") : at("market.off")}
                          </label>
                          <OutlineButton tone="danger" label={at("market.removeFrom", { name: bot.name })} disabled={busy !== null} onClick={() => void act(bot.id, () => uninstallSkill(listing, bot.id))}>
                            {busy === bot.id ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <Trash2 size={13} aria-hidden="true" />}{at("market.remove")}
                          </OutlineButton>
                        </>
                      ) : (
                        <OutlineButton label={at("market.addTo", { name: bot.name })} disabled={busy !== null} onClick={() => void act(bot.id, () => installSkill(listing, bot.id))}>
                          {busy === bot.id ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <Plus size={13} aria-hidden="true" />}{at("market.add")}
                        </OutlineButton>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
          <section>
            <h4 className="mb-2 text-[14px] font-semibold text-ink">SKILL.md</h4>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-xl bg-raised px-4 py-3 font-mono text-[12px] leading-[19px] text-ink/85">{body}</pre>
          </section>
        </div>
        <ListingMeta listing={listing} />
      </div>
    </div>
  );
}

// ── Apps ────────────────────────────────────────────────────────────────

let probeCache: AppsState["probes"] = {};

function useAppsState(revision: number) {
  const [apps, setApps] = useState<AppsState | null>(null);
  const reload = useCallback(async () => {
    const loaded = await loadAppsState();
    setApps({ ...loaded, probes: probeCache });
  }, []);
  useEffect(() => { void reload(); }, [reload, revision]);
  return { apps, reload };
}

function AppGrid({ page, query, category, onSelectCategory, revision, onChanged, onOpen }: { page: CatalogPage<AppListing>; query: string; category: string | null; onSelectCategory: (category: string | null) => void; revision: number; onChanged: () => void; onOpen: (id: string) => void }) {
  const { dispatch } = useStore();
  const { apps } = useAppsState(revision);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [connectQuery, setConnectQuery] = useState<string | null>(null);
  const allRef = useRef<HTMLDivElement>(null);
  const install = async (listing: AppListing) => {
    setBusy(listing.id);
    setError("");
    try {
      const probe = await installMcp(listing);
      probeCache = { ...probeCache, [listing.connector.type === "mcp" ? listing.connector.server.name : listing.id]: probe };
      onChanged();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(null);
    }
  };
  const connectOfficialApp = async (listing: AppListing) => {
    if (listing.connector.type !== "official" || !apps) return;
    // Apps that need a sign-in app open their page, where the owner adds it once.
    if (listing.connector.signIn === "app" && !apps.mcp.some((row) => row.name === (listing.connector as { server: { name: string } }).server.name && row.oauth)) { onOpen(listing.id); return; }
    setBusy(listing.id);
    setError("");
    try {
      await signInOfficial(listing, apps);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(null);
      onChanged();
    }
  };
  const connect = (listing: AppListing) => {
    setConnectQuery(listing.name);
    requestAnimationFrame(() => allRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  const browsing = !query.trim() && !category;
  const popular = browsing ? OFFICIAL_APPS : [];
  const officialIds = useMemo(() => new Set(OFFICIAL_APPS.map((listing) => listing.id)), []);
  // Mai browse-all: Phổ biến chips on top, then category samples (catalog apps, not the official chips) with Xem tất cả.
  const categoryRows = useMemo(() => {
    if (!browsing || !apps) return [];
    const catalog = page.items.filter((listing) => !officialIds.has(listing.id));
    const SAMPLE = 3;
    return page.categories
      .map((key) => {
        const items = catalog.filter((listing) => listing.category === key);
        return items.length ? { key, items: items.slice(0, SAMPLE) } : null;
      })
      .filter((row): row is { key: string; items: AppListing[] } => row !== null);
  }, [apps, browsing, officialIds, page.categories, page.items]);
  const renderAppCard = (listing: AppListing) => {
    if (!apps) return null;
    const status = appStatus(listing, apps);
    const mcp = listing.connector.type === "mcp";
    const official = listing.connector.type === "official";
    const action = official
      ? status.state === "connected" ? <StatusPill status={status} />
        : <OutlineButton label={`${at("market.connect")} ${listing.name}`} disabled={busy !== null} onClick={() => void connectOfficialApp(listing)}>{busy === listing.id ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : null}{at("market.connect")}</OutlineButton>
      : mcp
      ? status.state === "available"
        ? <OutlineButton label={`${at("market.install")} ${listing.name}`} disabled={busy !== null} onClick={() => void install(listing)}>{busy === listing.id ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}{at("market.install")}</OutlineButton>
        : <StatusPill status={status} />
      : status.state === "connected" ? <StatusPill status={status} />
        : <OutlineButton label={`${at("market.connect")} ${listing.name}`} onClick={() => connect(listing)}>{at("market.connect")}</OutlineButton>;
    return (
      <MarketCard
        key={listing.id}
        icon={<AppIcon listing={listing} />}
        title={listing.name}
        badge={official ? <OfficialBadge /> : undefined}
        label={`${listing.name}, ${at("market.details")}`}
        onOpen={() => onOpen(listing.id)}
        action={action}
        description={listingSummary(listing)}
        meta={<span className="flex items-center gap-1.5">{mcp ? at("market.mcpServer") : listingCategory(listing)}{(status.state === "error" || (mcp && status.state === "needs-setup")) && <> · <StatusPill status={status} /></>}</span>}
      />
    );
  };
  return (
    <>
      {error && <p role="alert" className="mb-3 rounded-xl bg-danger/10 px-3 py-2 text-[12.5px] text-danger">{error}</p>}
      {apps && !apps.composioConfigured && (
        <p data-composio-notice className="mb-3 rounded-xl bg-raised px-4 py-3 text-[13px] text-ink-secondary">
          {at("market.notConfigured")}{" "}
          <button type="button" onClick={() => { dispatch({ type: "togglePlugins", open: false }); dispatch({ type: "toggleAppSettings", open: true, section: "connections" }); }} className="font-medium text-ink underline underline-offset-2">{at("market.openSettings")}</button>
        </p>
      )}
      {popular.length > 0 && (
        <div data-popular-apps className="mb-5">
          <div className="mb-1.5 flex items-center gap-2">
            <h3 className="flex-1 text-[12px] font-semibold text-ink-secondary">{at("market.popular")}</h3>
            <span className="text-[11.5px] text-ink-tertiary">{at("market.composioCount")} · {at("market.composioSource")}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {popular.map((listing) => (
              <button
                key={listing.id}
                type="button"
                onClick={() => onOpen(listing.id)}
                className="inline-flex h-8 items-center gap-2 rounded-[10px] border border-hairline bg-app px-3 text-[12.5px] font-medium text-ink hover:bg-raised"
              >
                <AppIcon listing={listing} size={18} />
                {listing.name}
                <OfficialBadge />
                <span className="text-ink-tertiary">+</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {!apps ? <Spinner /> : browsing && categoryRows.length > 0 ? (
        <div data-catalog-categories className="space-y-5">
          {categoryRows.map((row) => (
            <section key={row.key} data-catalog-category={row.key}>
              <div className="mb-2 flex items-center gap-2">
                <h3 className="flex-1 text-[12px] font-semibold text-ink-secondary">{categoryLabel(row.key, page)}</h3>
                <button
                  type="button"
                  onClick={() => onSelectCategory(row.key)}
                  className="text-[12px] font-medium text-accent-text hover:underline"
                >
                  {at("market.seeAll")}
                </button>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {row.items.map((listing) => renderAppCard(listing))}
              </div>
            </section>
          ))}
        </div>
      ) : page.items.length === 0 ? <EmptyState query={query} /> : (
        <>
          <h3 className="mb-2.5 text-[14px] font-semibold text-ink">{category ? categoryLabel(category, page) : at("market.catalogApps")}</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {page.items.map((listing) => renderAppCard(listing))}
          </div>
        </>
      )}
      <div ref={allRef} className="mt-8 scroll-mt-2 border-t border-hairline pt-6">
        <h3 className="mb-3 text-[14px] font-semibold text-ink">{at("market.allConnectors")}</h3>
        <PluginsPanel embedded query={connectQuery ?? query} />
      </div>
    </>
  );
}

function AppDetail({ listing, revision, onChanged, onBrowse }: { listing: AppListing; revision: number; onChanged: () => void; onBrowse: () => void }) {
  const { apps, reload } = useAppsState(revision);
  const [busy, setBusy] = useState<"install" | "test" | "remove" | null>(null);
  const [error, setError] = useState("");
  const [choice, setChoice] = useState<"official" | "composio">("official");
  const [confirmed, setConfirmed] = useState(false);
  const status = apps ? appStatus(listing, apps) : null;
  const server = listing.connector.type === "mcp" ? listing.connector.server : null;
  const official = listing.connector.type === "official";
  const showChoice = official && status?.state !== "connected" && !confirmed;
  const run = async (kind: "install" | "test" | "remove") => {
    setBusy(kind);
    setError("");
    try {
      if (kind === "install") {
        const probe = await installMcp(listing);
        probeCache = { ...probeCache, [server!.name]: probe };
      } else if (kind === "test") {
        probeCache = { ...probeCache, [server!.name]: await testMcp(server!.name) };
      } else {
        await uninstallMcp(listing);
        const { [server!.name]: _gone, ...rest } = probeCache;
        probeCache = rest;
      }
      onChanged();
      await reload();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(null);
    }
  };
  const detail = useMemo(() => (status && "detail" in status ? status.detail : undefined), [status]);
  return (
    <div data-listing-detail={listing.id}>
      <div className="flex flex-wrap items-start gap-4">
        <AppIcon listing={listing} size={48} />
        <div className="min-w-0 flex-1">
          <h3 className="flex flex-wrap items-center gap-2 text-[18px] font-semibold text-ink">
            {listing.name}
            {official ? <OfficialBadge /> : null}
            {status && <StatusPill status={status} />}
          </h3>
          <p className="mt-1 text-[13px] text-ink-secondary">{listingSummary(listing)}</p>
          {detail && <p data-status-detail className="mt-1 text-[12.5px] text-ink-tertiary">{detail}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {server ? (
            status?.state === "available" ? <PrimaryButton busy={busy === "install"} onClick={() => void run("install")}><Plus size={15} aria-hidden="true" />{at("market.install")}</PrimaryButton> : (
              <>
                <OutlineButton disabled={busy !== null} onClick={() => void run("test")}>{busy === "test" ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={14} aria-hidden="true" />}{at("market.test")}</OutlineButton>
                <OutlineButton tone="danger" disabled={busy !== null} onClick={() => void run("remove")}><Trash2 size={14} aria-hidden="true" />{at("market.remove")}</OutlineButton>
              </>
            )
          ) : official ? null : <OutlineButton onClick={onBrowse}>{at("market.connectInAll")}</OutlineButton>}
        </div>
      </div>
      {error && <p role="alert" className="mt-3 rounded-xl bg-danger/10 px-3 py-2 text-[12.5px] text-danger">{error}</p>}
      <div className="mt-6 grid gap-8 md:grid-cols-[minmax(0,1fr)_220px]">
        <section>
          <h4 className="mb-2 text-[14px] font-semibold text-ink">{at("market.howItConnects")}</h4>
          {showChoice ? (
            <div data-connect-choice className="space-y-2">
              <button
                type="button"
                role="radio"
                aria-checked={choice === "official"}
                onClick={() => setChoice("official")}
                className={cn(
                  "flex w-full items-start gap-3 rounded-[12px] border px-3.5 py-3 text-left",
                  choice === "official" ? "border-accent bg-accent/10" : "border-hairline bg-app hover:bg-raised",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 size-[18px] shrink-0 rounded-full border-2 bg-app",
                    choice === "official" ? "border-[5px] border-accent" : "border-hairline",
                  )}
                  aria-hidden="true"
                />
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-semibold text-ink">{at("official.choiceOfficial")}</span>
                  <span className="mt-0.5 block text-[12px] leading-[1.4] text-ink-secondary">{at("official.choiceOfficialHint", { name: listing.name })}</span>
                </span>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={choice === "composio"}
                onClick={() => setChoice("composio")}
                disabled={!apps?.composioConfigured}
                className={cn(
                  "flex w-full items-start gap-3 rounded-[12px] border px-3.5 py-3 text-left disabled:opacity-50",
                  choice === "composio" ? "border-accent bg-accent/10" : "border-hairline bg-app hover:bg-raised",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 size-[18px] shrink-0 rounded-full border-2 bg-app",
                    choice === "composio" ? "border-[5px] border-accent" : "border-hairline",
                  )}
                  aria-hidden="true"
                />
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-semibold text-ink">{at("official.choiceComposio")}</span>
                  <span className="mt-0.5 block text-[12px] leading-[1.4] text-ink-secondary">{at("official.choiceComposioHint")}</span>
                </span>
              </button>
              <div className="pt-1">
                <PrimaryButton
                  onClick={() => {
                    if (choice === "composio") onBrowse();
                    else setConfirmed(true);
                  }}
                >
                  {at("market.connectName", { name: listing.name })}
                </PrimaryButton>
              </div>
            </div>
          ) : official && apps && (status?.state === "connected" || confirmed) ? (
            <OfficialConnect listing={listing} apps={apps} connected={status?.state === "connected"} onChanged={() => { onChanged(); void reload(); }} onComposio={apps.composioConfigured ? onBrowse : undefined} />
          ) : server ? (
            <pre className="overflow-auto whitespace-pre-wrap rounded-xl bg-raised px-4 py-3 font-mono text-[12px] leading-[19px] text-ink/85">
              {server.type === "stdio" ? `${server.command} ${server.args[0] === "-e" ? "-e <bundled script>" : server.args.join(" ")}` : server.url}
            </pre>
          ) : <p className="text-[13px] leading-[20px] text-ink-secondary">{at("market.composioHow")}</p>}
        </section>
        <ListingMeta listing={listing} />
      </div>
    </div>
  );
}
