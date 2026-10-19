export type AlertKind = "account_expired" | "account_reconnecting_stuck" | "job_dead_lettered";

export interface AlertEvent {
  kind: AlertKind;
  accountId?: number;
  title: string;
  detail?: string;
  ts: number;
}

export interface AlertNotifier {
  readonly channel: "telegram" | "webhook";
  send(alert: AlertEvent): Promise<void>;
}

export type AlertSignal =
  | { type: "status"; accountId: number; status: "connected" | "reconnecting" | "expired" }
  | { type: "dead_letter"; kind: string; dedupKey: string };
