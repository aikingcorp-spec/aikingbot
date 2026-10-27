// 1.15: a render error shows "Thử lại" in this frame only; the rest of the app keeps running.
import { Component, type ErrorInfo, type ReactNode } from "react";
import { at } from "@/aiking/strings";

export class PanelBoundary extends Component<{ name: string; resetKey?: string; children: ReactNode }, { failed: boolean; attempt: number }> {
  state = { failed: false, attempt: 0 };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown, info: ErrorInfo) {
    // Fixed tag + component stack only; the error text can carry user data.
    console.error(`panel-boundary: ${this.props.name} failed`, error instanceof Error ? error.name : typeof error, info.componentStack?.split("\n").slice(0, 4).join(" "));
  }
  componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false });
  }
  render() {
    if (!this.state.failed) return <PanelKey key={this.state.attempt}>{this.props.children}</PanelKey>;
    return (
      <div role="alert" data-panel-boundary={this.props.name} className="m-4 rounded-xl border border-border bg-card p-4 text-[14px] text-ink">
        <p>{at("market.crashed")}</p>
        <button type="button" className="mt-2 rounded-lg border border-border px-3 py-1.5" onClick={() => this.setState((s) => ({ failed: false, attempt: s.attempt + 1 }))}>{at("market.retry")}</button>
      </div>
    );
  }
}

function PanelKey({ children }: { children: ReactNode }) { return <>{children}</>; }
