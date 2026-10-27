import { cn } from "@/lib/cn";
import { botBubbleClass } from "@/lib/chat-column";
import { Component, type ReactNode } from "react";

export class MessageBoundary extends Component<{ children: ReactNode; fallbackText: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed) {
      return (
        <div className={cn("chat-text rounded-2xl bg-card px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap text-ink", botBubbleClass)}>
          {this.props.fallbackText}
        </div>
      );
    }
    return this.props.children;
  }
}
