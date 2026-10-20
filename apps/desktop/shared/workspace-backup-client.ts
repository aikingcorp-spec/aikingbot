// Exact app-owned browser state that belongs in an encrypted full backup.
// Never include cookies, authentication tokens, connection caches or unknown keys.
export const WORKSPACE_BACKUP_CLIENT_KEYS = [
  "aiking-drafts",
  "aiking-draft-attachments",
  "aiking-draft-send-ids",
  "aiking-draft-channel-modes",
  "aiking-skin",
  "aiking-show-threads",
  "aiking-show-run-card",
  "aiking-send-key",
  "aiking-color-user-bubbles",
  "aikingbot.sidebarDensity",
  "aikingbot.sidebarCollapsedSections.v1",
  "aikingbot.sidebarSectionOrder.v1",
  "aiking-analytics-opt-out",
  "aikingbot.remote-voice.v1",
] as const;

export type WorkspaceBackupClientState = Partial<Record<(typeof WORKSPACE_BACKUP_CLIENT_KEYS)[number], string>>;
