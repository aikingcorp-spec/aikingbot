/**
 * Credentials an agent may ask the person to provide through an inline
 * card. The id is the entire authority surface: agents never choose a
 * config path, label, URL, or arbitrary field name.
 */
export const CREDENTIAL_TARGETS = {
  xaiApiKey: {
    label: "xAI API key",
    description: "Used by the built-in Grok provider.",
    placeholder: "xai-…",
    helpUrl: "https://console.x.ai/",
  },
  boxToken: {
    label: "Boat API key",
    description: "Gives bots an isolated cloud computer when Boat is selected.",
    placeholder: "Paste your Boat API key",
    helpUrl: "https://docs.boat.dev/api-keys",
  },
  opencodeGoApiKey: {
    label: "OpenCode API key",
    description: "Used for OpenCode Zen and Go.",
    placeholder: "Paste your OpenCode API key",
    helpUrl: "https://opencode.ai/docs/providers/",
  },
  ttsKey: {
    label: "ElevenLabs API key",
    description: "Enables text-to-speech voices in calls.",
    placeholder: "Paste your ElevenLabs API key",
    helpUrl: "https://elevenlabs.io/app/settings/api-keys",
  },
  fishAudioKey: {
    label: "Fish Audio API key",
    description: "Enables Fish Audio voices in calls.",
    placeholder: "Paste your Fish Audio API key",
    helpUrl: "https://fish.audio/app/api-keys/",
  },
  openaiImageApiKey: {
    label: "OpenAI API key",
    description: "Used only to generate custom bot avatar images.",
    placeholder: "sk-…",
    helpUrl: "https://platform.openai.com/api-keys",
  },
} as const;

export type CredentialTargetId = keyof typeof CREDENTIAL_TARGETS;
export type CredentialConfig = {
  xai?: { key?: string };
  box?: { token?: string };
  opencodeGo?: { apiKey?: string };
  tts?: { key?: string; fishKey?: string };
  imageGen?: { key?: string };
};

export function isCredentialTargetId(value: unknown): value is CredentialTargetId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(CREDENTIAL_TARGETS, value);
}

export function credentialConfigPatch(id: CredentialTargetId, value: string): CredentialConfig {
  switch (id) {
    case "xaiApiKey":
      return { xai: { key: value } };
    case "boxToken":
      return { box: { token: value } };
    case "opencodeGoApiKey":
      return { opencodeGo: { apiKey: value } };
    case "ttsKey":
      return { tts: { key: value } };
    case "fishAudioKey":
      return { tts: { fishKey: value } };
    case "openaiImageApiKey":
      return { imageGen: { key: value } };
  }
}

export function credentialIsConfigured(config: CredentialConfig, id: CredentialTargetId): boolean {
  switch (id) {
    case "xaiApiKey":
      return Boolean(config.xai?.key);
    case "boxToken":
      return Boolean(config.box?.token);
    case "opencodeGoApiKey":
      return Boolean(config.opencodeGo?.apiKey);
    case "ttsKey":
      return Boolean(config.tts?.key);
    case "fishAudioKey":
      return Boolean(config.tts?.fishKey);
    case "openaiImageApiKey":
      return Boolean(config.imageGen?.key);
  }
}

/** A still-pending credential card for this target — the set a newer
 * request supersedes. Provided, dismissed, and already-superseded cards
 * keep their settled state untouched. */
export function isPendingCredentialRequest(
  message: {
    kind?: unknown;
    secret?: { target?: unknown; provided?: unknown; dismissed?: unknown; superseded?: unknown };
    from?: { botId?: unknown };
  },
  target: CredentialTargetId,
  requestingBotId: string,
  roomThread: boolean,
): boolean {
  return (
    message.kind === "secret" &&
    message.secret?.target === target &&
    message.secret.provided !== true &&
    message.secret.dismissed !== true &&
    message.secret.superseded !== true &&
    (!roomThread || message.from?.botId === requestingBotId)
  );
}

export function credentialResumeOutcome(state: {
  provided?: unknown;
  dismissed?: unknown;
}): "provided" | "dismissed" | null {
  const provided = state.provided === true;
  const dismissed = state.dismissed === true;
  if (provided === dismissed) return null;
  return provided ? "provided" : "dismissed";
}

/** How long a credential card accepts a first submit. This is the age of the
 * card, not of the secret: a write admitted before expiry may still finish. */
export const CREDENTIAL_REQUEST_TTL_MS = 10 * 60 * 1000;

export type CredentialAdmissionRefusal =
  | "missing"
  | "provided"
  | "dismissed"
  | "superseded"
  | "expired"
  | "stopped";

export interface CredentialCardState {
  provided?: unknown;
  dismissed?: unknown;
  superseded?: unknown;
  stopped?: unknown;
  expiresAt?: unknown;
}

/** When the card stops accepting a first submit. Legacy cards carry no
 * server-issued expiry, so they age from the message time. */
export function credentialCardExpiresAt(card: CredentialCardState | undefined, messageAt: unknown): number | null {
  if (card && typeof card.expiresAt === "number" && Number.isFinite(card.expiresAt)) return card.expiresAt;
  return typeof messageAt === "number" && Number.isFinite(messageAt) ? messageAt + CREDENTIAL_REQUEST_TTL_MS : null;
}

/** Pure admission decision for a credential write. `now >= expiresAt` is expired. */
export function credentialCardAdmission(
  card: CredentialCardState | undefined,
  messageAt: unknown,
  now: number,
): { ok: true } | { ok: false; reason: CredentialAdmissionRefusal } {
  if (!card) return { ok: false, reason: "missing" };
  if (card.provided === true) return { ok: false, reason: "provided" };
  if (card.dismissed === true) return { ok: false, reason: "dismissed" };
  if (card.superseded === true) return { ok: false, reason: "superseded" };
  if (card.stopped === true) return { ok: false, reason: "stopped" };
  const expiresAt = credentialCardExpiresAt(card, messageAt);
  if (expiresAt === null || now >= expiresAt) return { ok: false, reason: "expired" };
  return { ok: true };
}

/** Fixed, localized refusals. They never echo a payload or a secret. */
export const CREDENTIAL_REFUSAL_MESSAGES: Record<CredentialAdmissionRefusal | "busy", { en: string; vi: string }> = {
  missing: { en: "This key request is no longer available. Ask the bot to request it again.", vi: "Yêu cầu khóa này không còn. Hãy nhờ bot yêu cầu lại." },
  provided: { en: "This key was already provided.", vi: "Khóa này đã được cung cấp." },
  dismissed: { en: "This key request was dismissed. Ask the bot to request it again.", vi: "Yêu cầu khóa này đã bị bỏ qua. Hãy nhờ bot yêu cầu lại." },
  superseded: { en: "A newer request replaced this one. Use the newest key request.", vi: "Một yêu cầu mới hơn đã thay thế yêu cầu này. Hãy dùng yêu cầu mới nhất." },
  stopped: { en: "This key request was stopped. Ask the bot to request it again.", vi: "Yêu cầu khóa này đã dừng. Hãy nhờ bot yêu cầu lại." },
  expired: { en: "This key request expired. Ask the bot to request it again.", vi: "Yêu cầu khóa này đã hết hạn. Hãy nhờ bot yêu cầu lại." },
  busy: { en: "This key is already being saved. Wait a moment.", vi: "Khóa này đang được lưu. Vui lòng chờ." },
};

export const CREDENTIAL_REMOTE_DENIED_MESSAGE = {
  en: "Credentials can only be saved from the owner's own device.",
  vi: "Khóa chỉ có thể được lưu từ thiết bị của chủ sở hữu.",
};

// Config paths that hold the six card credentials. Same mapping as credentialConfigPatch.
const CREDENTIAL_CONFIG_PATHS: ReadonlyArray<readonly [string, string]> = [
  ["xai", "key"],
  ["box", "token"],
  ["opencodeGo", "apiKey"],
  ["tts", "key"],
  ["tts", "fishKey"],
  ["imageGen", "key"],
];

/** True when a PUT /api/config body touches any of the six card credentials,
 * including mixed bodies that also carry other settings. */
export function configPatchTouchesCredential(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const record = body as Record<string, unknown>;
  return CREDENTIAL_CONFIG_PATHS.some(([section, field]) => {
    const part = record[section];
    return !!part && typeof part === "object" && Object.prototype.hasOwnProperty.call(part, field);
  });
}

/** Fixed localized text for a refusal carried by an IPC error code or by the
 * server's fixed English message. Returns null for anything else, so no raw
 * payload is ever shown through this path. */
export function credentialRefusalText(error: unknown, locale: string): string | null {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const lang = locale.toLowerCase().startsWith("vi") ? "vi" : "en";
  const coded = /credential-refused:(\w+)/.exec(message)?.[1];
  if (coded && Object.prototype.hasOwnProperty.call(CREDENTIAL_REFUSAL_MESSAGES, coded)) {
    return CREDENTIAL_REFUSAL_MESSAGES[coded as keyof typeof CREDENTIAL_REFUSAL_MESSAGES][lang];
  }
  for (const entry of Object.values(CREDENTIAL_REFUSAL_MESSAGES)) if (message === entry.en) return entry[lang];
  return message === CREDENTIAL_REMOTE_DENIED_MESSAGE.en ? CREDENTIAL_REMOTE_DENIED_MESSAGE[lang] : null;
}

/** Fixed text for any failure that is not a known refusal: never the stored or backend error. */
export const CREDENTIAL_GENERIC_ERROR = {
  en: "The key could not be saved. Try again.",
  vi: "Không thể lưu khóa. Hãy thử lại.",
};

/** Always a fixed string: a known refusal, or the generic text. Never echoes the error. */
export function credentialErrorText(error: unknown, locale: string): string {
  return credentialRefusalText(error, locale)
    ?? CREDENTIAL_GENERIC_ERROR[locale.toLowerCase().startsWith("vi") ? "vi" : "en"];
}

/** A stored card error only ever records that resuming the bot failed: shown as this fixed text, never as stored. */
export const CREDENTIAL_RESUME_ERROR = {
  en: "The bot could not be resumed.",
  vi: "Không thể tiếp tục bot.",
};

export function credentialResumeErrorText(error: unknown, locale: string): string {
  return credentialRefusalText(error, locale)
    ?? CREDENTIAL_RESUME_ERROR[locale.toLowerCase().startsWith("vi") ? "vi" : "en"];
}

/** The only title, description, placeholder and help link a credential card may show: from the
 * registry, never from stored card text (which older cards filled from agent input). */
export function trustedCredentialCopy(target: CredentialTargetId): {
  label: string;
  description: string;
  placeholder: string;
  helpUrl: string;
} {
  const entry = CREDENTIAL_TARGETS[target];
  return { label: entry.label, description: entry.description, placeholder: entry.placeholder, helpUrl: entry.helpUrl };
}

/** Context a card write carries on PUT /api/config. The server checks it against its own claim. */
export interface CredentialCardContext {
  botId: string;
  threadId: string;
  messageId: string;
  target: CredentialTargetId;
  claimId: string;
}

export function parseCredentialCardContext(value: unknown): CredentialCardContext | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const { botId, threadId, messageId, target, claimId } = record;
  if (
    typeof botId !== "string" || typeof threadId !== "string" || typeof messageId !== "string" ||
    typeof claimId !== "string" || !isCredentialTargetId(target)
  ) return null;
  return { botId, threadId, messageId, target, claimId };
}

/** True when a body (without the card context) writes exactly this target and nothing else. */
export function configPatchIsExactlyCredential(body: unknown, target: CredentialTargetId): boolean {
  if (!body || typeof body !== "object") return false;
  const expected = credentialConfigPatch(target, "x") as Record<string, Record<string, string>>;
  const [section, field] = Object.entries(expected).map(([key, part]) => [key, Object.keys(part)[0]] as const)[0];
  const record = body as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 1 || keys[0] !== section) return false;
  const part = record[section];
  if (!part || typeof part !== "object") return false;
  const fields = Object.keys(part as object);
  return fields.length === 1 && fields[0] === field && typeof (part as Record<string, unknown>)[field] === "string"
    && ((part as Record<string, unknown>)[field] as string) !== "";
}
