import type { AIKINGBOTDesktopApi } from "@aikingbot/contracts/ipc";

/** What the schedule reaches in main: the routine calendar of a server, and the events that make it stale. */
export interface SchedulePort {
  agent: Pick<AIKINGBOTDesktopApi["agent"], "routineCalendar" | "onScopedEvent">;
  servers: Pick<AIKINGBOTDesktopApi["servers"], "onEvent">;
}

/** Read on each call: tests and stories replace `window.aikingbot` per case. */
export function schedulePort(): SchedulePort {
  return window.aikingbot;
}
