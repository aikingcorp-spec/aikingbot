import {
  CheckCircle2,
  CircleAlert,
  Hand,
  Loader2,
  Square,
  XCircle,
} from "lucide-react";

import { at } from "@/aiking/strings";
import { cn } from "@/lib/cn";
import { botBubbleClass, msgCardInnerClass, msgCardOuterClass } from "@/lib/chat-column";
import type { Message } from "@/state/store";
import type { GroupGoalRunCardData } from "../../shared/group-goal-run";

const DETAIL_LIMIT = 280;

const COPY = {
  working: { labelKey: "chat.column.goalWorking" as const, tone: "text-accent", border: "border-accent/30" },
  completed: { labelKey: "chat.column.goalCompleted" as const, tone: "text-success", border: "border-success/30" },
  "needs-input": { labelKey: "chat.column.goalNeedsInput" as const, tone: "text-warning", border: "border-warning/35" },
  blocked: { labelKey: "chat.column.goalBlocked" as const, tone: "text-warning", border: "border-warning/35" },
  "limit-reached": { labelKey: "chat.column.goalLimitReached" as const, tone: "text-warning", border: "border-warning/35" },
  paused: { labelKey: "chat.column.goalPaused" as const, tone: "text-warning", border: "border-warning/35" },
  stopped: { labelKey: "chat.column.goalStopped" as const, tone: "text-ink-secondary", border: "border-hairline/45" },
  failed: { labelKey: "chat.column.goalFailed" as const, tone: "text-danger", border: "border-danger/35" },
} satisfies Record<
  GroupGoalRunCardData["status"],
  { labelKey: "chat.column.goalWorking" | "chat.column.goalCompleted" | "chat.column.goalNeedsInput" | "chat.column.goalBlocked" | "chat.column.goalLimitReached" | "chat.column.goalPaused" | "chat.column.goalStopped" | "chat.column.goalFailed"; tone: string; border: string }
>;

function compact(value: string | undefined, limit: number): string {
  const clean = value?.replace(/\s+/g, " ").trim() ?? "";
  return clean.length > limit ? `${clean.slice(0, limit - 1).trimEnd()}…` : clean;
}

function StatusIcon({ status }: { status: GroupGoalRunCardData["status"] }) {
  const className = "size-4 shrink-0";
  switch (status) {
    case "working":
      return <Loader2 aria-hidden="true" className={cn(className, "animate-spin text-accent")} />;
    case "completed":
      return <CheckCircle2 aria-hidden="true" className={cn(className, "text-success")} />;
    case "needs-input":
      return <Hand aria-hidden="true" className={cn(className, "text-warning")} />;
    case "blocked":
    case "limit-reached":
    case "paused":
      return <CircleAlert aria-hidden="true" className={cn(className, "text-warning")} />;
    case "stopped":
      return <Square aria-hidden="true" className={cn(className, "text-ink-secondary")} />;
    case "failed":
      return <XCircle aria-hidden="true" className={cn(className, "text-danger")} />;
  }
}

export function GoalRunCard({ message }: { message: Message }) {
  const run = message.goalRun;
  if (!run) {
    const fallback = compact(message.text, DETAIL_LIMIT);
    return fallback ? (
      <div className={cn(botBubbleClass, "rounded-2xl bg-card px-4 py-2.5 text-[14px] leading-relaxed text-ink")}>
        {fallback}
      </div>
    ) : null;
  }

  const copy = COPY[run.status];
  const label = at(copy.labelKey);
  const goal = compact(run.goal, 180);
  const detail = compact(run.detail, DETAIL_LIMIT);
  const turns = run.status === "working"
    ? at("chat.column.goalTurnOf", { current: Math.min(run.turnCount + 1, run.maxTurns), max: run.maxTurns })
    : run.turnCount === 1
      ? at("chat.column.goalTurnOne")
      : at("chat.column.goalTurns", { count: run.turnCount });

  return (
    <div className={msgCardOuterClass}>
      <section
        aria-label={`Goal run: ${label}`}
        className={cn(msgCardInnerClass, "rounded-2xl border bg-card px-3.5 py-3 shadow-sm", copy.border)}
      >
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-inset">
            <StatusIcon status={run.status} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <h3 className="truncate text-[13.5px] font-semibold text-ink">{goal || at("chat.column.goalFallback")}</h3>
              <span aria-live="polite" className={cn("text-[11.5px] font-medium", copy.tone)}>
                {label}
              </span>
            </div>
            {detail && <p className="mt-1 line-clamp-2 text-[12.5px] leading-relaxed text-ink-secondary">{detail}</p>}
            <p className="mt-1 text-[11.5px] text-ink-tertiary">
              {at("chat.column.goalCoordinating", { name: run.coordinatorName, turns })}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
