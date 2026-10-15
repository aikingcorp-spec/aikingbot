// Copyright (c) 2026 AIKING. Installs marketplace listings with the app's
// real endpoints, and reads install status from live state:
//   agents  → createAgent (profile, memory, SKILL.md templates, routines)
//   skills  → POST/PATCH/DELETE /api/bots/:id/skill-template, /skills/:name
//   MCP     → POST/DELETE /api/mcp/servers, POST /api/mcp/servers/:name/test
//   apps    → Composio status from /api/connectors/connected (connect flow stays upstream)
import { api, type Bot } from "@/state/store";
import { createAgent } from "../agent-install";
import type { BotSkillTemplate, BotRoutineTemplate } from "../../../shared/new-bot-defaults";
import type { AgentListing, AppListing, InstallRecord, InstallRecordStore, InstallStatus, Listing, SkillListing } from "./contract";
import { catalogSource } from "./sources";

const RECORDS_KEY = "aiking-marketplace-installs";

/** Stage 2 keeps install records in this browser profile; agents themselves live on the host. */
export class LocalInstallRecords implements InstallRecordStore {
  constructor(private readonly key = RECORDS_KEY) {}
  all(): InstallRecord[] {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(this.key) ?? "[]");
      return Array.isArray(parsed) ? parsed.filter((record): record is InstallRecord =>
        typeof record?.listingId === "string" && typeof record?.version === "string" && Array.isArray(record?.targets)) : [];
    } catch {
      return [];
    }
  }
  private save(records: InstallRecord[]) {
    try { localStorage.setItem(this.key, JSON.stringify(records)); } catch {}
  }
  add(record: InstallRecord) {
    const records = this.all();
    const existing = records.find((candidate) => candidate.listingId === record.listingId);
    if (existing) {
      existing.targetVersions = { ...Object.fromEntries(existing.targets.map(target => [target, existing.targetVersions?.[target] ?? existing.version])), ...Object.fromEntries(record.targets.map(target => [target, record.version])) };
      existing.targets = [...new Set([...existing.targets, ...record.targets])];
      existing.version = record.version;
      existing.installedAt = record.installedAt;
    } else records.push({ ...record, targetVersions: Object.fromEntries(record.targets.map(target => [target, record.version])) });
    this.save(records);
  }
  remove(listingId: string, target?: string) {
    const records = this.all()
      .map((record) => record.listingId !== listingId || target === undefined ? record : { ...record, targets: record.targets.filter((id) => id !== target) })
      .filter((record) => record.listingId !== listingId || (target !== undefined && record.targets.length > 0));
    this.save(records);
  }
}

let records: InstallRecordStore = new LocalInstallRecords();
export function installRecords(): InstallRecordStore {
  return records;
}
export function setInstallRecords(store: InstallRecordStore) {
  records = store;
}

function newer(a: string, b: string): boolean {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) if ((left[index] ?? 0) !== (right[index] ?? 0)) return (left[index] ?? 0) > (right[index] ?? 0);
  return false;
}

// ── Agents ──────────────────────────────────────────────────────────────

export function agentStatus(listing: AgentListing, bots: Bot[]): InstallStatus {
  const live = new Set(bots.filter((bot) => !bot.hidden).map((bot) => bot.id));
  const record = installRecords().all().find((candidate) => candidate.listingId === listing.id);
  const targets = record?.targets.filter((id) => live.has(id)) ?? [];
  if (!record || targets.length === 0) return { state: "available" };
  const sorted = targets.toSorted((a, b) => newer(record.targetVersions?.[a] ?? record.version, record.targetVersions?.[b] ?? record.version) ? 1 : -1);
  const version = record.targetVersions?.[sorted[0]!] ?? record.version;
  return { state: "installed", version, targets: sorted, ...(newer(listing.version, version) ? { update: listing.version } : {}) };
}

export function skillTemplate(skill: SkillListing): BotSkillTemplate {
  return { name: skill.skillName, description: skill.summary, source: `aiking-marketplace:${skill.id}@${skill.version}`, text: skill.text, enabled: true, warnings: [] };
}

async function pinnedSkills(listing: AgentListing): Promise<SkillListing[]> {
  const resolved: SkillListing[] = [];
  for (const pin of listing.skills) {
    const found = await catalogSource().get(pin.id);
    if (!found || found.kind !== "skill") throw new Error(`${listing.name} needs the skill ${pin.id}, which this catalog does not have.`);
    if (found.version !== pin.version) throw new Error(`${listing.name} pins ${pin.id} ${pin.version}; the catalog has ${found.version}.`);
    resolved.push(found);
  }
  return resolved;
}

export async function installAgent(listing: AgentListing): Promise<{ bot: Bot; warnings: string[] }> {
  const skills = await pinnedSkills(listing);
  const routines: BotRoutineTemplate[] = (listing.routines ?? []).map((routine) => ({
    name: routine.name, prompt: routine.prompt, enabled: routine.enabled,
    schedule: { type: "daily", time: routine.time, weekdays: routine.weekdays },
  }));
  const result = await createAgent({
    profile: {
      name: listing.profile.name,
      title: listing.profile.title,
      description: listing.profile.description,
      soul: listing.profile.instructions,
      color: listing.look.color,
      mascotBody: listing.look.body,
      mascotExpression: listing.look.expression ?? null,
    },
    memory: listing.memory,
    skills: skills.map(skillTemplate),
    routines,
  });
  installRecords().add({ listingId: listing.id, version: listing.version, kind: "agent", targets: [result.bot.id], installedAt: new Date().toISOString() });
  await installRecords().flush?.();
  return result;
}

export async function forgetAgent(listingId: string, botId: string) {
  installRecords().remove(listingId, botId);
  await installRecords().flush?.();
}

export async function updateAgent(listing: AgentListing, bot: Bot): Promise<Bot> {
  for (const skill of await pinnedSkills(listing)) await updateSkill(skill, bot.id, bot.threadId);
  const result = await api<{ bot: Bot }>(`/api/bots/${encodeURIComponent(bot.id)}`, { method: "PATCH", body: JSON.stringify({ soul: listing.profile.instructions }) });
  installRecords().add({ listingId: listing.id, version: listing.version, kind: "agent", targets: [bot.id], installedAt: new Date().toISOString() });
  await installRecords().flush?.(); return result.bot;
}

export async function removeAgent(listingId: string, botId: string) {
  await api(`/api/bots/${encodeURIComponent(botId)}`, { method: "DELETE" });
  await forgetAgent(listingId, botId);
}

// ── Skills ──────────────────────────────────────────────────────────────

export type AgentSkillState = { botId: string; botName: string; enabled: boolean };

/** Which agents have each skill, read from every agent's skill list. */
export async function skillHolders(bots: Bot[]): Promise<Map<string, AgentSkillState[]>> {
  const holders = new Map<string, AgentSkillState[]>();
  await Promise.all(bots.filter((bot) => !bot.hidden).map(async (bot) => {
    const result = await api<{ skills?: Array<{ name: string; enabled?: boolean }> }>(`/api/bots/${encodeURIComponent(bot.id)}/skills`).catch(() => ({ skills: [] }));
    for (const skill of result.skills ?? []) {
      const list = holders.get(skill.name) ?? [];
      list.push({ botId: bot.id, botName: bot.name, enabled: skill.enabled !== false });
      holders.set(skill.name, list);
    }
  }));
  return holders;
}

export function skillStatus(listing: SkillListing, holders: Map<string, AgentSkillState[]>): InstallStatus {
  const targets = holders.get(listing.skillName) ?? [];
  const record = installRecords().all().find(record => record.listingId === listing.id);
  const versions = targets.map(target => record?.targetVersions?.[target.botId] ?? record?.version ?? "unknown");
  const version = versions.reduce((old, next) => newer(old, next) ? next : old, versions[0] ?? "unknown");
  return targets.length ? { state: "installed", version, targets: targets.map((target) => target.botId), ...(record && newer(listing.version, version) ? { update: listing.version } : {}) } : { state: "available" };
}

export async function updateSkill(listing: SkillListing, botId: string, threadId: string) {
  const current = await api<{ skills: Array<{ name: string }> }>(`/api/bots/${encodeURIComponent(botId)}/skills`);
  if (!current.skills.some(skill => skill.name === listing.skillName)) { await installSkill(listing, botId); return; }
  const { text } = await api<{ text: string }>(`/api/bots/${encodeURIComponent(botId)}/skills/${encodeURIComponent(listing.skillName)}`);
  if (text !== listing.text) {
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    const baseSha256 = [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, "0")).join("");
    await api("/api/aiking/marketplace/skill-update", { method: "POST", body: JSON.stringify({ listingId: listing.id, botId, threadId, baseSha256 }) });
  }
  installRecords().add({ listingId: listing.id, version: listing.version, kind: "skill", targets: [botId], installedAt: new Date().toISOString() });
  await installRecords().flush?.();
}

export async function installSkill(listing: SkillListing, botId: string) {
  await api(`/api/bots/${encodeURIComponent(botId)}/skill-template`, { method: "POST", body: JSON.stringify(skillTemplate(listing)) });
  installRecords().add({ listingId: listing.id, version: listing.version, kind: "skill", targets: [botId], installedAt: new Date().toISOString() });
  await installRecords().flush?.();
}

export async function setSkillEnabled(listing: SkillListing, botId: string, enabled: boolean) {
  await api(`/api/bots/${encodeURIComponent(botId)}/skills/${encodeURIComponent(listing.skillName)}`, { method: "PATCH", body: JSON.stringify({ enabled }) });
}

export async function uninstallSkill(listing: SkillListing, botId: string) {
  await api(`/api/bots/${encodeURIComponent(botId)}/skills/${encodeURIComponent(listing.skillName)}`, { method: "DELETE" });
  installRecords().remove(listing.id, botId);
  await installRecords().flush?.();
}

// ── Apps ────────────────────────────────────────────────────────────────

export type McpServerRow = { name: string; enabled?: boolean };
export type ConnectorRow = { connected?: boolean; pending?: boolean; status?: string; accounts?: unknown[] };
export type AppsState = {
  mcp: McpServerRow[];
  composioConfigured: boolean;
  connectors: Record<string, ConnectorRow>;
  probes: Record<string, { ok: boolean; error?: string; tools?: number }>;
};

export async function loadAppsState(): Promise<Omit<AppsState, "probes">> {
  const [mcp, connected] = await Promise.all([
    api<{ servers?: McpServerRow[] }>("/api/mcp/servers").catch(() => ({ servers: [] })),
    api<{ configured?: boolean; services?: Record<string, ConnectorRow> }>("/api/connectors/connected").catch(() => ({ configured: false, services: {} })),
  ]);
  return { mcp: mcp.servers ?? [], composioConfigured: Boolean(connected.configured), connectors: connected.services ?? {} };
}

export function appStatus(listing: AppListing, state: AppsState): InstallStatus {
  const connector = listing.connector;
  if (connector.type === "mcp") {
    const server = state.mcp.find((row) => row.name === connector.server.name);
    if (!server) return { state: "available" };
    const probe = state.probes[server.name];
    if (server.enabled === false) return { state: "needs-setup", detail: "Turned off" };
    if (probe && !probe.ok) return { state: "error", detail: probe.error ?? "The server did not answer." };
    if (probe?.ok) return { state: "connected", detail: `${probe.tools ?? 0} tools` };
    return { state: "installed", version: listing.version, targets: [server.name] };
  }
  const row = state.connectors[connector.slug];
  if (row && /^(expired|failed)$/i.test(row.status ?? "")) return { state: "error", detail: "Sign-in expired. Connect again." };
  if (row?.connected || (row?.accounts?.length ?? 0) > 0) return { state: "connected" };
  if (row?.pending) return { state: "needs-setup", detail: "Finish signing in" };
  if (!state.composioConfigured) return { state: "needs-setup", detail: "Needs a Composio project key" };
  return { state: "available" };
}

export async function installMcp(listing: AppListing): Promise<{ ok: boolean; error?: string; tools?: number }> {
  if (listing.connector.type !== "mcp") throw new Error("Not an MCP listing");
  const server = listing.connector.server;
  const body = server.type === "stdio"
    ? { name: server.name, command: server.command, args: server.args, enabled: true }
    : { name: server.name, type: "http", url: server.url, enabled: true };
  await api("/api/mcp/servers", { method: "POST", body: JSON.stringify(body) });
  // The host saves a new server switched off; Install is the person's explicit choice to turn it on.
  await api(`/api/mcp/servers/${encodeURIComponent(server.name)}`, { method: "PATCH", body: JSON.stringify({ enabled: true }) });
  installRecords().add({ listingId: listing.id, version: listing.version, kind: "app", targets: [server.name], installedAt: new Date().toISOString() });
  await installRecords().flush?.();
  return testMcp(server.name);
}

export async function testMcp(name: string): Promise<{ ok: boolean; error?: string; tools?: number }> {
  try {
    const result = await api<{ ok: boolean; error?: string; tools?: unknown[]; total?: number }>(`/api/mcp/servers/${encodeURIComponent(name)}/test`, { method: "POST" });
    return { ok: result.ok, error: result.error, tools: result.total ?? result.tools?.length };
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : String(cause) };
  }
}

export async function uninstallMcp(listing: AppListing) {
  if (listing.connector.type !== "mcp") throw new Error("Not an MCP listing");
  await api(`/api/mcp/servers/${encodeURIComponent(listing.connector.server.name)}`, { method: "DELETE" });
  installRecords().remove(listing.id);
  await installRecords().flush?.();
}

export function listingKey(listing: Listing) {
  return `${listing.kind}:${listing.id}@${listing.version}`;
}
