// Copyright (c) 2026 AIKING.
// The Tasks checklist: the plan an agent works through, with each task's state and a done/total counter. It shows only the
// plan the engine itself reported (Claude TodoWrite/task tools, Codex update_plan, ACP plan); tool calls stay in the run
// details. Look follows the reference card: bordered dark card, "Tasks" title, "3/3" counter, ticked tasks struck through.
import { useId, useState } from "react";
import { ChevronDown, Check, LoaderCircle } from "lucide-react";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { msgCardInnerClass, msgCardOuterClass } from "@/lib/chat-column";
import { planProgress, type ConversationPlan, type ConversationPlanStatus } from "../../shared/conversation-plan";

function TaskMark({ status }: { status: ConversationPlanStatus }) {
  const label = status === "completed" ? t("chat.tasks.state.done") : status === "inProgress" ? t("chat.tasks.state.active") : t("chat.tasks.state.pending");
  return (
    <span role="img" aria-label={label} data-task-mark={status} className="mt-px flex size-[18px] shrink-0 items-center justify-center rounded-full">
      {status === "completed" ? (
        <span className="flex size-[18px] items-center justify-center rounded-full bg-ink-secondary/80 text-app"><Check size={11} strokeWidth={3} /></span>
      ) : status === "inProgress" ? (
        <LoaderCircle size={18} className="animate-spin text-ink" />
      ) : (
        <span className="size-[16px] rounded-full border-[1.5px] border-dashed border-ink-secondary/60" />
      )}
    </span>
  );
}

export function TaskChecklist({ plan, defaultOpen = true }: { plan: ConversationPlan; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  if (!plan.steps.length) return null;
  const { done, total, active, complete } = planProgress(plan);
  // A closed list names the work that runs, so the person can see the agent go on.
  const headline = !open && active ? active.activeText ?? active.text : t("chat.tasks.title");
  return (
    <div className={msgCardOuterClass}>
    <section data-task-checklist="" data-complete={complete ? "" : undefined} className={cn(msgCardInnerClass, "self-start overflow-hidden rounded-[14px] border border-hairline bg-app")}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex min-h-[48px] w-full items-center gap-2.5 px-3.5 py-2 text-left transition-colors hover:bg-raised/50"
      >
        <span className={cn("flex size-[20px] shrink-0 items-center justify-center rounded-full", complete ? "bg-ink-secondary/80 text-app" : "text-ink-secondary")}>
          {complete ? <Check size={12} strokeWidth={3} /> : active ? <LoaderCircle size={18} className="animate-spin" /> : <span className="size-[17px] rounded-full border-[1.5px] border-ink-secondary/70" />}
        </span>
        <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-ink" data-task-headline="">{headline}</span>
        <span className="shrink-0 text-[14px] tabular-nums text-ink-secondary" aria-hidden="true" data-task-count="">{done}/{total}</span>
        <span className="sr-only">{t("chat.tasks.summary", { done, total })}</span>
        <ChevronDown size={16} className={cn("shrink-0 text-ink-secondary transition-transform duration-200", open && "rotate-180")} />
      </button>
      {open && (
        <ol id={panelId} className="flex flex-col gap-3 px-3.5 pb-3.5 pt-1.5">
          {plan.steps.map((step) => (
            <li key={step.id} data-task-state={step.status} className="flex items-start gap-2.5">
              <TaskMark status={step.status} />
              <span
                className={cn(
                  "min-w-0 flex-1 break-words text-[15px] leading-[1.45]",
                  step.status === "completed" && "text-ink-secondary/70 line-through decoration-ink-secondary/50",
                  step.status === "inProgress" && "text-ink",
                  step.status === "pending" && "text-ink-secondary",
                )}
              >
                {step.status === "inProgress" ? step.activeText ?? step.text : step.text}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
    </div>
  );
}
