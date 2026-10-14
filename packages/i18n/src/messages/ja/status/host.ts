import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/host";

export const messages = {
  // Status lines of the WebRTC host.
  "status.host.registered": "この AIKINGBOT を WebRTC アクセス用に登録しました。",
  "status.host.identityUpdated": "サーバーの ID を更新しました。",
  "status.host.starting": "WebRTC ホストを起動しています…",
  "status.host.ready": "この AIKINGBOT は WebRTC 接続の準備ができています。",
  "status.host.stopping": "この AIKINGBOT を非公開にしています…",
  "status.host.private": "この AIKINGBOT は非公開です。",
} as const satisfies PartialTranslation<typeof source>;
