// AIKING stage 2: a run of tool steps reads as one collapsible card, like the
// reference's task list. Based on AIKINGBOT src/components/ActivityRun.tsx (Apache-2.0).
import { useEffect, useState } from "react";
import { ChevronDown, Check, LoaderCircle } from "lucide-react";
import type { Message } from "@/state/store";
import { describeRun } from "@/lib/activity-runs";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { msgCardInnerClass, msgCardOuterClass } from "@/lib/chat-column";

export function ActivityRun({
  messages,
  forceOpen = false,
  children,
}: {
  messages: Message[];
  forceOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(forceOpen);
  useEffect(() => {
    if (forceOpen) setOpen(true);
  }, [forceOpen]);
  const running = messages.some((step) => step.kind === "activity" && step.tool && step.tool.ok === undefined);
  const done = messages.filter((step) => step.kind !== "activity" || !step.tool || step.tool.ok !== undefined).length;
  return (
    <div className={msgCardOuterClass}>
    <section
      data-activity-run=""
      className={cn(msgCardInnerClass, "self-start overflow-hidden rounded-[14px] border border-hairline bg-app")}
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        title={open ? undefined : t("chat.run.showSteps")}
        className="flex h-[44px] w-full items-center gap-2.5 px-3 text-left transition-colors hover:bg-raised/50"
      >
        <span className={cn("flex size-[18px] shrink-0 items-center justify-center rounded-full", running ? "text-ink-secondary" : "bg-ink-secondary/80 text-app")}>
          {running ? <LoaderCircle size={16} className="animate-spin" /> : <Check size={11} strokeWidth={3} />}
        </span>
        <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-ink">{describeRun(messages)}</span>
        <span className="shrink-0 text-[13px] tabular-nums text-ink-secondary">{done}/{messages.length}</span>
        <ChevronDown size={15} className={cn("shrink-0 text-ink-secondary transition-transform duration-200", open && "rotate-180")} />
      </button>
      {open && <div className="flex flex-col gap-1 border-t border-hairline px-2 py-2">{children}</div>}
    </section>
    </div>
  );
}
