import { ArrowRight, Loader2 } from "lucide-react";

import { at, type AikingKey } from "@/aiking/strings";
import { cn } from "@/lib/cn";
import { botBubbleClass, msgCardInnerClass, msgCardOuterClass } from "@/lib/chat-column";
import { routineDateTime } from "@/lib/routine-display";
import { t } from "@/lib/i18n";
import type { RoutineRunCardData } from "../../shared/routine-run";
import type { Message } from "@/state/store";

const DETAIL_LIMIT = 280;

type ToneCopy = { labelKey: AikingKey; tone: string };

const COPY = {
  queued: { labelKey: "chat.column.routineQueued", tone: "text-ink-secondary" },
  running: { labelKey: "chat.column.routineRunning", tone: "text-accent" },
  waiting: { labelKey: "chat.column.routineWaiting", tone: "text-warning" },
  completed: { labelKey: "chat.column.routineCompleted", tone: "text-ink-secondary" },
  failed: { labelKey: "chat.column.routineFailed", tone: "text-danger" },
  cancelled: { labelKey: "chat.column.routineCancelled", tone: "text-ink-secondary" },
  missed: { labelKey: "chat.column.routineMissed", tone: "text-danger" },
} satisfies Record<RoutineRunCardData["status"], ToneCopy>;

const GOAL_COPY = {
  completed: COPY.completed,
  "needs-input": { labelKey: "chat.column.routineNeedsInput", tone: "text-warning" },
  blocked: { labelKey: "chat.column.routineBlocked", tone: "text-danger" },
  "limit-reached": { labelKey: "chat.column.routineLimitReached", tone: "text-warning" },
  paused: { labelKey: "chat.column.routinePaused", tone: "text-warning" },
  stopped: { labelKey: "chat.column.routineStopped", tone: "text-ink-secondary" },
  failed: COPY.failed,
} satisfies Record<NonNullable<RoutineRunCardData["goalStatus"]>, ToneCopy>;

function compactDetail(value: string | undefined): string {
  const clean = value?.replace(/\s+/g, " ").trim() ?? "";
  return clean.length > DETAIL_LIMIT ? `${clean.slice(0, DETAIL_LIMIT - 1).trimEnd()}…` : clean;
}

export function hasRoutineExecutionTask(
  tasks: ReadonlyArray<{ threadId: string }> | undefined,
  executionThreadId: string | undefined,
): executionThreadId is string {
  return Boolean(
    executionThreadId && tasks?.some((task) => task.threadId === executionThreadId),
  );
}

export function RoutineRunCard({
  message,
  onOpen,
}: {
  message: Message;
  onOpen?: () => void;
}) {
  const run = message.routineRun;
  if (!run) {
    const fallback = compactDetail(message.text);
    return fallback ? (
      <div className={cn(botBubbleClass, "rounded-2xl bg-card px-4 py-2.5 text-[14px] leading-relaxed text-ink")}>
        {fallback}
      </div>
    ) : null;
  }

  const copy: ToneCopy = run.goalStatus
    ? GOAL_COPY[run.goalStatus]
    : run.status === "queued" && run.deferredAt != null
      ? { labelKey: "chat.column.routineDeferred", tone: "text-warning" }
      : COPY[run.status];
  const label = at(copy.labelKey);
  const detail = compactDetail(
    run.status === "failed" || run.status === "missed"
      ? (run.error ?? run.summary)
      : (run.summary ?? run.error),
  );
  const actionLabel = run.goalStatus === "needs-input" ? at("chat.column.routineReview") : at("chat.column.routineOpen");

  return (
    <div className={msgCardOuterClass}>
    <section
      aria-label={`${run.routineName} routine run: ${label}`}
      className={cn(msgCardInnerClass, "rounded-xl border border-hairline/45 bg-card px-4 py-3")}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <h3 className="truncate text-[14px] font-semibold text-ink">{run.routineName}</h3>
            <span aria-live="polite" className={cn("inline-flex items-center gap-1 text-[11.5px] font-semibold", copy.tone)}>
              {run.status === "running" && !run.goalStatus && <Loader2 aria-hidden="true" className="size-3 animate-spin" />}
              {label}
            </span>
          </div>
          <time dateTime={new Date(run.scheduledFor ?? message.at).toISOString()} className="mt-0.5 block text-[11.5px] text-ink-secondary">
            {routineDateTime(run.scheduledFor ?? message.at)}
          </time>
          {detail && <p className="mt-1.5 text-[13px] leading-relaxed text-ink-secondary">{detail}</p>}
          {run.status === "completed" && run.summary && run.summary.length > DETAIL_LIMIT && <details className="mt-2 text-[12px] text-ink-secondary">
            <summary className="cursor-pointer font-medium text-ink-secondary hover:text-ink">{t("routines.results.showReport")}</summary>
            <p className="mt-2 whitespace-pre-wrap leading-relaxed">{run.summary}</p>
          </details>}
        </div>
        {onOpen && run.executionThreadId && (
          <button
            type="button"
            onClick={onOpen}
            aria-label={`${actionLabel} for ${run.routineName}`}
            className={cn(
              "flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[12px] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
              run.goalStatus === "needs-input"
                ? "bg-warning/15 text-warning hover:bg-warning/25"
                : "text-ink-secondary hover:bg-inset hover:text-ink",
            )}
          >
            {actionLabel}
            <ArrowRight aria-hidden="true" size={13} />
          </button>
        )}
      </div>
    </section>
    </div>
  );
}
