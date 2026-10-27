// Copyright (c) 2026 AIKING. Agents / Routines switch at the top of the sidebar.
import { Bot, CalendarDays } from "lucide-react";
import { SlidingTabs } from "./SlidingTabs";
import { at } from "./strings";

export function SidebarViewTabs({ view, onAgents, onRoutines }: {
  view: "agents" | "routines";
  onAgents: () => void;
  onRoutines: () => void;
}) {
  return (
    <SlidingTabs
      className="mt-2"
      stretch
      label={at("sidebar.views")}
      value={view}
      onChange={(id) => (id === "agents" ? onAgents() : onRoutines())}
      tabs={[
        { id: "agents", label: at("sidebar.agents"), icon: <Bot size={14} strokeWidth={2} aria-hidden="true" /> },
        { id: "routines", label: at("sidebar.routines"), icon: <CalendarDays size={14} strokeWidth={2} aria-hidden="true" /> },
      ]}
    />
  );
}
