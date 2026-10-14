// Copyright (c) 2026 AIKING. Interface text added by AIKINGBOT stage 2.
// The upstream catalog (src/locales/en.json) is typed and large; AIKING
// strings live here and follow the active upstream locale. A language
// without an entry falls back to English.
import { activeLocale } from "@/lib/i18n";

const en = {
  "sidebar.agents": "Agents",
  "sidebar.routines": "Routines",
  "sidebar.views": "Sidebar view",
  "sidebar.marketplace": "Marketplace",
  "rail.label": "Workspaces",
  "rail.local": "This computer",
  "rail.add": "Connect a computer",
  "rail.marketplace": "Marketplace",
  "rail.routines": "Routines",
  "rail.settings": "Settings",
  "header.files": "Files",
  "header.computer": "Computer",
  "dock.settings": "Settings",
  "market.title": "Marketplace",
  "market.tabs": "Marketplace sections",
  "market.agents": "Agents",
  "market.apps": "Apps",
  "market.skills": "Skills",
  "market.search": "Search",
  "market.close": "Close marketplace",
  "market.back": "Marketplace",
  "market.add": "Add",
  "market.added": "Added",
  "market.addAgent": "Add agent",
  "market.adding": "Adding…",
  "market.connect": "Connect",
  "market.connected": "Connected",
  "market.yourApps": "Your apps",
  "market.moreApps": "More apps",
  "market.mcpServers": "MCP servers",
  "market.addMcp": "Add MCP server",
  "market.installedSkills": "Installed skills",
  "market.skillsHint": "Skills teach an agent a repeatable job. Turn one on for an agent from its profile.",
  "market.noMatch": "Nothing matches “{query}”.",
  "market.empty": "Nothing here yet.",
  "market.creator": "Creator",
  "market.category": "Category",
  "market.engine": "Engine",
  "market.instructions": "Instructions",
  "market.skillsSection": "Skills",
  "market.routinesSection": "Routines",
  "market.appsSection": "Apps",
  "market.templates": "Templates",
  "market.coreNotice": "Live catalog and publishing arrive with AIKING Core (stage 3). This shows templates on this computer.",
  "market.appsCoreNotice": "Hosted connector catalog arrives with AIKING Core (stage 3).",
  "market.notConfigured": "Connected apps need a Composio project key. Add it in Settings → API keys.",
  "market.openSettings": "Open settings",
  "market.manage": "Manage",
  "market.mcpLocal": "Local MCP server",
  "market.skillOn": "On for {count} agents",
  "market.skillOff": "Not used yet",
  "market.version": "Version",
  "market.details": "Details",
} as const;

export type AikingKey = keyof typeof en;

const packs: Record<string, Partial<Record<AikingKey, string>>> = { en };

export function at(key: AikingKey, params?: Record<string, string | number>): string {
  const lang = activeLocale().split("-")[0] ?? "en";
  const template = packs[lang]?.[key] ?? en[key];
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}
