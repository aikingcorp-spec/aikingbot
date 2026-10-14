// Copyright (c) 2026 AIKING. The marketplace: Agents, Apps and Skills in one
// dialog. Layout follows the OpenBot 0.39 reference screenshots; the code is
// original. Apps reuse the upstream connector panel (PluginsPanel, embedded),
// so connecting, authorizing and MCP servers behave exactly as before.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronRight, Loader2, Plus, Search, Settings2, Sparkles, X } from "lucide-react";
import { useStore } from "@/state/store";
import { BOT_ROLES, type BotRole } from "@/lib/bot-roles";
import { cn } from "@/lib/cn";
import { PluginsPanel } from "@/components/PluginsPanel";
import type { SkillsLibrarySkillWire } from "../../shared/wire";
import { SlidingTabs } from "./SlidingTabs";
import { seedNewAgentRole, setMarketplaceTab, useMarketplaceTab, type MarketplaceTab } from "./marketplace-state";
import { at } from "./strings";

const TEMPLATE_COLORS = ["#f59e0b", "#3b82f6", "#2fbf71", "#8b5cf6", "#ef4444", "#ec4899", "#2dd4bf", "#eab308"];
const TEMPLATE_SHAPES = ["pill", "squircle", "blob", "hex"] as const;

const ROLE_CATEGORY: Record<string, string> = {
  assistant: "Everyday",
  inbox: "Productivity",
  research: "Research",
  coder: "Coding",
  community: "Community",
  ops: "Operations",
};

const APP_LABEL: Record<string, string> = {
  gmail: "Gmail",
  github: "GitHub",
  discord: "Discord",
  slack: "Slack",
  googlecalendar: "Google Calendar",
  notion: "Notion",
  linear: "Linear",
};

/** A small generated mascot for a template: a colored shape with two eyes. */
export function TemplateMascot({ index, size = 34 }: { index: number; size?: number }) {
  const color = TEMPLATE_COLORS[index % TEMPLATE_COLORS.length]!;
  const shape = TEMPLATE_SHAPES[index % TEMPLATE_SHAPES.length]!;
  const body =
    shape === "pill" ? <rect x="2" y="9" width="32" height="18" rx="9" fill={color} />
      : shape === "squircle" ? <rect x="4" y="4" width="28" height="28" rx="9" fill={color} />
        : shape === "hex" ? <path d="M10 4h16l8 14-8 14H10L2 18Z" fill={color} />
          : <path d="M18 3c8 0 15 6 15 15s-7 15-15 15S3 27 3 18 10 3 18 3Z" fill={color} />;
  return (
    <svg aria-hidden="true" viewBox="0 0 36 36" width={size} height={size} className="shrink-0">
      {body}
      <circle cx="14" cy="18" r="1.9" fill="#fff" />
      <circle cx="22" cy="18" r="1.9" fill="#fff" />
    </svg>
  );
}

export function Marketplace() {
  const { state, dispatch } = useStore();
  const tab = useMarketplaceTab();
  const [query, setQuery] = useState("");
  const [detail, setDetail] = useState<BotRole | null>(null);
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
      // A menu or nested dialog inside the panel closes first.
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
    if (detail) dialogRef.current?.focus();
  }, [detail]);
  useEffect(() => {
    if (state.pluginsSurface === "mcp") setMarketplaceTab("apps");
  }, [state.pluginsSurface]);

  const chooseTab = (next: MarketplaceTab) => {
    setDetail(null);
    setQuery("");
    setMarketplaceTab(next);
  };

  const addAgent = (role: BotRole) => {
    seedNewAgentRole(role.id);
    close();
    dispatch({ type: "toggleNewBot", open: true });
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
      onMouseDown={(event) => event.target === event.currentTarget && close()}
    >
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
            <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-[14px] font-semibold">
              <button type="button" onClick={() => setDetail(null)} className="text-ink-secondary hover:text-ink">{at("market.back")}</button>
              <ChevronRight size={14} aria-hidden="true" className="text-ink-tertiary" />
              <span className="truncate text-ink">{detail.title}</span>
            </nav>
          ) : (
            <h2 className="text-[14px] font-semibold text-ink">{at("market.title")}</h2>
          )}
          <button
            type="button"
            onClick={close}
            aria-label={at("market.close")}
            className="ml-auto flex size-7 items-center justify-center rounded-md text-ink-secondary hover:bg-raised hover:text-ink"
          >
            <X size={15} />
          </button>
        </header>

        {detail ? (
          <AgentDetail role={detail} index={BOT_ROLES.indexOf(detail)} onAdd={() => addAgent(detail)} />
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
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
              {tab === "agents" && <AgentGrid query={query} onOpen={setDetail} onAdd={addAgent} />}
              {tab === "apps" && <PluginsPanel embedded query={query} />}
              {tab === "skills" && <SkillGrid query={query} onManage={() => { close(); dispatch({ type: "toggleAppSettings", open: true, section: "skills" }); }} />}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

function matches(query: string, ...fields: Array<string | undefined>) {
  const q = query.trim().toLowerCase();
  return !q || fields.some((field) => field?.toLowerCase().includes(q));
}

export function MarketCard({ icon, title, action, description, meta, onOpen, label }: {
  icon: ReactNode;
  title: string;
  action?: ReactNode;
  description: string;
  meta?: string;
  onOpen?: () => void;
  label?: string;
}) {
  return (
    <div
      data-market-card
      className={cn(
        "group relative flex min-h-[150px] min-w-0 flex-col rounded-[14px] border border-hairline bg-[color-mix(in_srgb,var(--color-raised)_55%,var(--color-app))] p-4 transition-colors",
        onOpen && "hover:border-ink/15 hover:bg-raised",
      )}
    >
      {onOpen && (
        <button type="button" onClick={onOpen} aria-label={label ?? title} className="absolute inset-0 rounded-[14px] outline-none focus-visible:ring-2 focus-visible:ring-focus" />
      )}
      <div className="flex min-h-8 items-center gap-3">
        {icon}
        <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-ink">{title}</span>
        {action && <span className="relative z-[1] shrink-0">{action}</span>}
      </div>
      <p className="mt-3 line-clamp-2 text-[13px] leading-[18px] text-ink/85">{description}</p>
      {meta && <p className="mt-auto pt-3 text-[12px] text-ink-tertiary">{meta}</p>}
    </div>
  );
}

export function OutlineButton({ children, onClick, disabled, label }: { children: ReactNode; onClick?: () => void; disabled?: boolean; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-hairline bg-app px-3 text-[13px] font-medium text-ink transition-colors hover:bg-raised-hover disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function AgentGrid({ query, onOpen, onAdd }: { query: string; onOpen: (role: BotRole) => void; onAdd: (role: BotRole) => void }) {
  const { state } = useStore();
  const shown = BOT_ROLES.filter((role) => matches(query, role.name, role.title, role.description));
  const installed = new Set(state.bots.filter((bot) => !bot.hidden).map((bot) => bot.title.trim().toLowerCase()));
  return (
    <>
      <p className="mb-3 text-[12px] text-ink-tertiary">{at("market.coreNotice")}</p>
      {shown.length === 0 ? <EmptyState query={query} /> : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((role) => {
            const index = BOT_ROLES.indexOf(role);
            const added = installed.has(role.title.trim().toLowerCase());
            return (
              <MarketCard
                key={role.id}
                icon={<TemplateMascot index={index} />}
                title={role.title}
                label={`${role.title}, ${at("market.details")}`}
                onOpen={() => onOpen(role)}
                action={added
                  ? <span className="inline-flex h-8 items-center gap-1 px-1 text-[12.5px] text-success"><Check size={13} aria-hidden="true" />{at("market.added")}</span>
                  : <OutlineButton onClick={() => onAdd(role)} label={`${at("market.add")} ${role.title}`}><Plus size={14} aria-hidden="true" />{at("market.add")}</OutlineButton>}
                description={role.description}
                meta={`AIKING · ${ROLE_CATEGORY[role.id] ?? at("market.templates")}`}
              />
            );
          })}
        </div>
      )}
    </>
  );
}

function AgentDetail({ role, index, onAdd }: { role: BotRole; index: number; onAdd: () => void }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
      <div className="flex items-start gap-4">
        <TemplateMascot index={index} size={44} />
        <div className="min-w-0 flex-1">
          <h3 className="text-[18px] font-semibold text-ink">{role.title}</h3>
          <p className="mt-1 text-[13px] text-ink-secondary">{role.description}</p>
        </div>
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-ink px-4 text-[14px] font-medium text-app hover:bg-ink/90"
        >
          <Plus size={15} aria-hidden="true" />{at("market.addAgent")}
        </button>
      </div>
      <div className="mt-6 grid gap-8 md:grid-cols-[minmax(0,1fr)_220px]">
        <div className="flex flex-col gap-6">
          <section>
            <h4 className="mb-2 text-[14px] font-semibold text-ink">{at("market.instructions")}</h4>
            <p className="rounded-xl bg-raised px-4 py-3 text-[13px] leading-[20px] text-ink/85">{role.soul}</p>
          </section>
          {role.apps.length > 0 && (
            <section>
              <h4 className="mb-2 text-[14px] font-semibold text-ink">{at("market.appsSection")}</h4>
              <ul className="flex flex-col gap-1">
                {role.apps.map((app) => (
                  <li key={app} className="flex items-center gap-3 rounded-lg px-2 py-1.5">
                    <span className="flex size-9 items-center justify-center rounded-lg bg-raised text-[13px] font-semibold text-ink-secondary">{(APP_LABEL[app] ?? app).slice(0, 1)}</span>
                    <span className="text-[13px] font-medium text-ink">{APP_LABEL[app] ?? app}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
        <dl className="flex flex-col gap-4 border-hairline md:border-l md:pl-6">
          <Meta term={at("market.creator")} value="AIKING" />
          <Meta term={at("market.category")} value={ROLE_CATEGORY[role.id] ?? at("market.templates")} />
          <Meta term={at("market.engine")} value="Your default model" />
        </dl>
      </div>
    </div>
  );
}

function Meta({ term, value }: { term: string; value: string }) {
  return (
    <div>
      <dt className="text-[12px] text-ink-tertiary">{term}</dt>
      <dd className="mt-1 text-[13px] text-ink">{value}</dd>
    </div>
  );
}

function EmptyState({ query }: { query: string }) {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center gap-1 text-center">
      <Search size={18} aria-hidden="true" className="mb-1 text-ink-tertiary" />
      <p className="text-[14px] font-medium text-ink">{query ? at("market.noMatch", { query }) : at("market.empty")}</p>
    </div>
  );
}

function SkillGrid({ query, onManage }: { query: string; onManage: () => void }) {
  const [skills, setSkills] = useState<SkillsLibrarySkillWire[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    void fetch("/api/skills-library")
      .then(async (response) => {
        const body = (await response.json()) as { skills?: SkillsLibrarySkillWire[]; error?: string };
        if (!response.ok) throw new Error(body.error ?? "Skills could not be loaded");
        if (alive) setSkills(body.skills ?? []);
      })
      .catch((cause) => alive && setError(cause instanceof Error ? cause.message : String(cause)));
    return () => { alive = false; };
  }, []);
  const shown = useMemo(
    () => (skills ?? []).filter((skill) => matches(query, skill.name, skill.description, ...skill.tags)),
    [skills, query],
  );
  return (
    <>
      <div className="mb-3 flex items-center gap-3">
        <h3 className="text-[14px] font-semibold text-ink">{at("market.installedSkills")}</h3>
        <span className="hidden text-[12px] text-ink-tertiary sm:inline">{at("market.skillsHint")}</span>
        <span className="ml-auto"><OutlineButton onClick={onManage}><Settings2 size={14} aria-hidden="true" />{at("market.manage")}</OutlineButton></span>
      </div>
      {error ? (
        <p role="alert" className="rounded-xl bg-danger/10 px-3 py-2 text-[12.5px] text-danger">{error}</p>
      ) : skills === null ? (
        <div className="flex items-center justify-center gap-2 py-20 text-[13px] text-ink-secondary"><Loader2 size={14} className="animate-spin" /></div>
      ) : shown.length === 0 ? <EmptyState query={query} /> : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((skill) => (
            <MarketCard
              key={skill.name}
              icon={<span className="flex size-9 items-center justify-center rounded-lg bg-raised text-ink-secondary"><Sparkles size={17} aria-hidden="true" /></span>}
              title={skill.name}
              action={skill.assignedBots.length > 0
                ? <span className="inline-flex h-8 items-center gap-1 text-[12.5px] text-success"><Check size={13} aria-hidden="true" />{at("market.skillOn", { count: skill.assignedBots.length })}</span>
                : undefined}
              description={skill.description}
              meta={[skill.version ? `${at("market.version")} ${skill.version}` : "", skill.tags.slice(0, 2).join(", "), skill.assignedBots.length ? "" : at("market.skillOff")].filter(Boolean).join(" · ")}
            />
          ))}
        </div>
      )}
    </>
  );
}
