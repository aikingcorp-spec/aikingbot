// Copyright (c) 2026 AIKING. Which marketplace tab is open, and the agent
// template a new-agent dialog should start from. The dialog itself opens
// through the upstream `togglePlugins` action, so every existing "Apps"
// entry point (sidebar, command palette, settings links) lands here.
import { useSyncExternalStore } from "react";

export type MarketplaceTab = "agents" | "apps" | "skills";

let tab: MarketplaceTab = "agents";
let seededRole: string | null = null;
const listeners = new Set<() => void>();
let dispatcher: ((open: boolean) => void) | null = null;

function emit() {
  for (const listener of listeners) listener();
}

export function setMarketplaceTab(next: MarketplaceTab) {
  if (tab === next) return;
  tab = next;
  emit();
}

export function useMarketplaceTab(): MarketplaceTab {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => tab,
    () => tab,
  );
}

/** App registers the store dispatch once, so non-React callers can open the marketplace. */
export function registerMarketplaceOpener(open: ((open: boolean) => void) | null) {
  dispatcher = open;
}

export function openMarketplace(next: MarketplaceTab) {
  setMarketplaceTab(next);
  dispatcher?.(true);
}

/** A template chosen in the marketplace; the new-agent dialog takes it once. */
export function seedNewAgentRole(roleId: string | null) {
  seededRole = roleId;
}

export function takeSeededRole(): string | null {
  const role = seededRole;
  seededRole = null;
  return role;
}
