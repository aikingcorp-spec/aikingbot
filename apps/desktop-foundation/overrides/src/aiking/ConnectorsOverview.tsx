// Copyright (c) 2026 AIKING. Settings → Connectors: what this computer is
// connected to, what is not set up, and quick picks from the marketplace.
// Layout follows the OpenBot 0.39 reference; data comes from the existing
// connector, MCP and skills endpoints.
import { useEffect, useState, type ReactNode } from "react";
import { ChevronRight, Plus, Server, Sparkles, Blocks } from "lucide-react";
import { api, useStore } from "@/state/store";
import { cn } from "@/lib/cn";
import { APP_LOGOS } from "./app-logos";
import { openMarketplace } from "./marketplace-state";
import { at } from "./strings";

type Inventory = {
  configured: boolean;
  connected: string[];
  mcp: Array<{ name: string; enabled: boolean }>;
  catalog: Array<{ slug: string; label: string }>;
};

const SUGGESTED = ["github", "gmail", "notion", "linear", "googlecalendar", "figma", "slack", "discord"];

function StatusBadge({ tone, children }: { tone: "ok" | "warn" | "off"; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1.5 rounded-md px-1.5 text-[12px] font-medium",
        tone === "ok" && "bg-success/12 text-success",
        tone === "warn" && "bg-warning/12 text-warning",
        tone === "off" && "bg-ink/[0.06] text-ink-secondary",
      )}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

function Row({ icon, title, badge, detail, trailing, onClick }: {
  icon: ReactNode; title: string; badge?: ReactNode; detail: string; trailing?: ReactNode; onClick?: () => void;
}) {
  const body = (
    <>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-app text-ink ring-1 ring-hairline">{icon}</span>
      <span className="min-w-0 flex-1 text-left">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[14px] font-medium text-ink">{title}</span>
          {badge}
        </span>
        <span className="mt-0.5 block truncate text-[13px] text-ink-secondary">{detail}</span>
      </span>
      {trailing}
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 px-4 py-3 transition-colors hover:bg-raised-hover/50">
      {body}
    </button>
  ) : (
    <div className="flex items-center gap-3 px-4 py-3">{body}</div>
  );
}

function Group({ children }: { children: ReactNode }) {
  return <div className="divide-y divide-hairline overflow-hidden rounded-xl bg-raised">{children}</div>;
}

function Logo({ slug, label }: { slug: string; label: string }) {
  const logo = APP_LOGOS[slug];
  if (!logo) return <span aria-hidden="true" className="flex size-4 items-center justify-center text-[10px] font-semibold text-ink-secondary">{label.slice(0, 1)}</span>;
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" fill={logo.hex === "#181717" || logo.hex === "#000000" ? "currentColor" : logo.hex}><path d={logo.path} /></svg>;
}

export function ConnectorsOverview({ onOpenKeys }: { onOpenKeys: () => void }) {
  const { state, dispatch } = useStore();
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [skillCount, setSkillCount] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    void Promise.all([
      api("/api/connectors/catalog").catch(() => ({ configured: false, cards: [] })),
      api("/api/connectors/connected").catch(() => ({ services: {} })),
      api("/api/mcp/servers").catch(() => ({ servers: [] })),
    ]).then(([catalog, connected, mcp]) => {
      if (!alive) return;
      const services = (connected.services ?? {}) as Record<string, { connected?: boolean; accounts?: unknown[] }>;
      setInventory({
        configured: Boolean(catalog.configured),
        connected: Object.entries(services).filter(([, status]) => status.connected || (status.accounts?.length ?? 0) > 0).map(([slug]) => slug),
        mcp: (mcp.servers ?? []).map((server: { name: string; enabled?: boolean }) => ({ name: server.name, enabled: server.enabled !== false })),
        catalog: (catalog.cards ?? []).map((card: { slug: string; label: string }) => ({ slug: card.slug, label: card.label })),
      });
    });
    void Promise.all(state.bots.filter((bot) => !bot.hidden).map((bot) =>
      fetch(`/api/bots/${encodeURIComponent(bot.id)}/skills`).then((r) => (r.ok ? r.json() : { skills: [] })).catch(() => ({ skills: [] })),
    )).then((lists) => {
      if (!alive) return;
      setSkillCount(new Set(lists.flatMap((list: { skills?: Array<{ name: string }> }) => (list.skills ?? []).map((skill) => skill.name))).size);
    });
    return () => { alive = false; };
  }, [state.bots]);

  const closeAndOpen = (tab: "apps" | "skills", surface?: "mcp") => {
    dispatch({ type: "toggleAppSettings", open: false });
    openMarketplace(tab);
    if (surface) dispatch({ type: "togglePlugins", open: true, surface });
  };

  const label = (slug: string) => inventory?.catalog.find((card) => card.slug === slug)?.label ?? APP_LOGOS[slug]?.title ?? slug;
  const enabledMcp = inventory?.mcp.filter((server) => server.enabled) ?? [];
  const suggestions = SUGGESTED.filter((slug) => !inventory?.connected.includes(slug)).slice(0, 6);

  return (
    <div data-connectors-overview className="flex flex-col gap-3">
      <h3 className="text-[13px] font-medium text-ink-secondary">{at("conn.onComputer")}</h3>
      <Group>
        <Row
          icon={<Blocks size={17} aria-hidden="true" />}
          title={at("conn.apps")}
          badge={inventory === null ? undefined : inventory.connected.length > 0
            ? <StatusBadge tone="ok">{at("conn.connected")}</StatusBadge>
            : inventory.configured ? <StatusBadge tone="off">{at("conn.none")}</StatusBadge> : <StatusBadge tone="warn">{at("conn.needsSetup")}</StatusBadge>}
          detail={inventory === null ? at("conn.checking") : inventory.connected.length > 0
            ? inventory.connected.map(label).join(", ")
            : inventory.configured ? at("conn.appsHint") : at("conn.appsKey")}
          trailing={<ChevronRight size={16} aria-hidden="true" className="shrink-0 text-ink-tertiary" />}
          onClick={() => closeAndOpen("apps")}
        />
        <Row
          icon={<Server size={17} aria-hidden="true" />}
          title={at("conn.mcp")}
          badge={inventory === null ? undefined : enabledMcp.length > 0 ? <StatusBadge tone="ok">{at("conn.connected")}</StatusBadge> : <StatusBadge tone="off">{at("conn.none")}</StatusBadge>}
          detail={inventory === null ? at("conn.checking") : enabledMcp.length > 0
            ? `${enabledMcp.map((server) => server.name).slice(0, 4).join(", ")} · ${at(enabledMcp.length === 1 ? "conn.server" : "conn.servers", { count: enabledMcp.length })}`
            : at("conn.mcpHint")}
          trailing={<ChevronRight size={16} aria-hidden="true" className="shrink-0 text-ink-tertiary" />}
          onClick={() => closeAndOpen("apps", "mcp")}
        />
        <Row
          icon={<Sparkles size={17} aria-hidden="true" />}
          title={at("conn.skills")}
          badge={skillCount ? <StatusBadge tone="ok">{at(skillCount === 1 ? "conn.skill" : "conn.skillsCount", { count: skillCount })}</StatusBadge> : undefined}
          detail={skillCount ? at("conn.skillsOn") : at("conn.skillsHint")}
          trailing={<ChevronRight size={16} aria-hidden="true" className="shrink-0 text-ink-tertiary" />}
          onClick={() => closeAndOpen("skills")}
        />
      </Group>

      {inventory && !inventory.configured && (
        <>
          <h3 className="mt-2 text-[13px] font-medium text-ink-secondary">{at("conn.notSetUp")}</h3>
          <Group>
            <Row
              icon={<Logo slug="composio" label="C" />}
              title="Composio"
              detail={at("conn.composioHint")}
              trailing={
                <button type="button" onClick={onOpenKeys} className="h-8 shrink-0 rounded-lg bg-accent px-3 text-[13px] font-medium text-accent-ink hover:brightness-110">
                  {at("conn.setUp")}
                </button>
              }
            />
          </Group>
        </>
      )}

      {suggestions.length > 0 && (
        <>
          <div className="mt-2 flex items-center justify-between">
            <h3 className="text-[13px] font-medium text-ink-secondary">{at("conn.fromMarket")}</h3>
            <button type="button" onClick={() => closeAndOpen("apps")} className="text-[13px] font-medium text-ink-secondary hover:text-ink">{at("conn.browseAll")}</button>
          </div>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((slug) => (
              <button
                key={slug}
                type="button"
                onClick={() => closeAndOpen("apps")}
                className="inline-flex h-8 items-center gap-2 rounded-lg border border-hairline bg-raised px-2.5 text-[13px] font-medium text-ink hover:bg-raised-hover"
              >
                <Logo slug={slug} label={label(slug)} />
                {label(slug)}
                <Plus size={13} aria-hidden="true" className="text-ink-tertiary" />
              </button>
            ))}
          </div>
        </>
      )}
      <h3 className="mt-4 text-[13px] font-medium text-ink-secondary">{at("conn.apiKeys")}</h3>
    </div>
  );
}
