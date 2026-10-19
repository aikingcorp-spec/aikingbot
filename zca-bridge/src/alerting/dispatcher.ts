import type { AlertEvent, AlertKind, AlertNotifier, AlertSignal } from "./types.js";

export interface DispatcherOpts {
  cooldownMs: number;
  reconnectingThresholdMs: number;
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => { cancel: () => void };
}

export class AlertDispatcher {
  private lastSent = new Map<string, number>();
  private reconnectTimers = new Map<number, { cancel: () => void }>();
  private now: () => number;
  private schedule: (fn: () => void, ms: number) => { cancel: () => void };

  constructor(private notifiers: AlertNotifier[], private opts: DispatcherOpts) {
    this.now = opts.now ?? (() => Date.now());
    this.schedule = opts.schedule ?? ((fn, ms) => { const t = setTimeout(fn, ms); return { cancel: () => clearTimeout(t) }; });
  }

  handle(signal: AlertSignal): void {
    if (signal.type === "dead_letter") {
      this.fire({ kind: "job_dead_lettered", detail: `job kind: ${signal.kind}` }, `job_dead_lettered:${signal.kind}`);
      return;
    }
    if (signal.status === "reconnecting") {
      this.armReconnect(signal.accountId);
      return;
    }
    this.cancelReconnect(signal.accountId);
    if (signal.status === "expired") {
      this.fire({ kind: "account_expired", accountId: signal.accountId }, `account_expired:${signal.accountId}`);
    }
    // "connected" → recovered; nothing to send.
  }

  private armReconnect(accountId: number): void {
    this.cancelReconnect(accountId);
    const timer = this.schedule(() => {
      this.reconnectTimers.delete(accountId);
      this.fire({ kind: "account_reconnecting_stuck", accountId }, `account_reconnecting_stuck:${accountId}`);
    }, this.opts.reconnectingThresholdMs);
    this.reconnectTimers.set(accountId, timer);
  }

  private cancelReconnect(accountId: number): void {
    const t = this.reconnectTimers.get(accountId);
    if (t) { t.cancel(); this.reconnectTimers.delete(accountId); }
  }

  private fire(partial: { kind: AlertKind; accountId?: number; detail?: string }, cooldownKey: string): void {
    const now = this.now();
    const last = this.lastSent.get(cooldownKey);
    if (last != null && now - last < this.opts.cooldownMs) return;
    this.lastSent.set(cooldownKey, now);
    const event: AlertEvent = { ...partial, title: titleFor(partial.kind, partial.accountId), ts: now };
    for (const n of this.notifiers) {
      n.send(event).catch((err) => console.error(`alert send failed (${n.channel}):`, err));
    }
  }
}

function titleFor(kind: AlertKind, accountId?: number): string {
  switch (kind) {
    case "account_expired": return `⚠️ Account ${accountId} mất đăng nhập — cần quét lại QR`;
    case "account_reconnecting_stuck": return `⚠️ Account ${accountId} mất kết nối kéo dài — đang thử reconnect`;
    case "job_dead_lettered": return `❌ Job thất bại (dead-letter) — tin nhắn không xử lý được`;
  }
}
