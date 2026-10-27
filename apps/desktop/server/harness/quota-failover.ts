// 1.12 / 3.1: switch account or provider only when the current one is out of quota; stay on the new one (no switching back).
const QUOTA = /\b402\b|insufficient[_ ]quota|quota[_ ]exceeded|exceeded (?:your|the) (?:current )?quota|out of (?:credit|credits|quota)|credit balance|no (?:remaining )?credits?|billing (?:hard )?limit|usage limit (?:reached|exceeded)|payment required|character limit|quota/i;
/** A plain rate limit or an outage is retried in place, never failed over. */
const NOT_QUOTA = /rate.?limit(?!.*quota)|try again in a moment|wait a moment|timed? ?out|timeout|ECONNRESET|503\b|overloaded/i;

export function isQuotaError(error: unknown): boolean {
  const status = typeof error === "object" && error !== null ? (error as { status?: unknown }).status : undefined;
  if (status === 402) return true;
  const text = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (!text) return false;
  if (QUOTA.test(text)) return !NOT_QUOTA.test(text) || /quota|credit|402/i.test(text);
  return false;
}

export interface FailoverNotice { from: string; to: string; stage: string; message: string }

export class QuotaExhaustedError extends Error {
  readonly stage: string;
  readonly tried: string[];
  constructor(stage: string, tried: string[], cause: unknown) {
    super(`Every ${stage} account is out of quota (${tried.join(", ")}).`, { cause });
    this.stage = stage;
    this.tried = tried;
  }
}

/** One pool per stage (stt, llm, tts, realtime). The index only moves forward. */
export class FailoverPool<A extends { id: string }> {
  private index = 0;
  private readonly exhausted = new Set<string>();

  readonly stage: string;
  private readonly accounts: readonly A[];
  private readonly notify?: (notice: FailoverNotice) => void;
  constructor(stage: string, accounts: readonly A[], notify?: (notice: FailoverNotice) => void) {
    this.stage = stage;
    this.accounts = accounts;
    this.notify = notify;
  }

  current(): A | undefined { return this.accounts[this.index]; }
  exhaustedIds(): string[] { return [...this.exhausted]; }

  async run<T>(call: (account: A) => Promise<T>): Promise<T> {
    let lastError: unknown;
    while (this.index < this.accounts.length) {
      const account = this.accounts[this.index]!;
      try {
        return await call(account);
      } catch (error) {
        if (!isQuotaError(error)) throw error;
        lastError = error;
        this.exhausted.add(account.id);
        const next = this.accounts[this.index + 1];
        this.index += 1;
        if (next) this.notify?.({ from: account.id, to: next.id, stage: this.stage, message: `${account.id} hết hạn mức, đã chuyển sang ${next.id}.` });
      }
    }
    throw new QuotaExhaustedError(this.stage, this.accounts.map((account) => account.id), lastError);
  }
}

export interface VoicePipelineStages<In, Text, Audio> {
  stt: (input: In) => Promise<Text>;
  llm: (text: Text) => Promise<Text>;
  tts: (text: Text) => Promise<Audio>;
}

/** Realtime first; once its quota is gone the turn (and later turns, via `state`) run STT→LLM→TTS. */
export async function voiceTurn<In, Text, Audio>(
  input: In,
  state: { realtimeExhausted: boolean },
  realtime: ((input: In) => Promise<Audio>) | undefined,
  pipeline: VoicePipelineStages<In, Text, Audio>,
  notify?: (notice: FailoverNotice) => void,
): Promise<{ audio: Audio; via: "realtime" | "pipeline" }> {
  if (realtime && !state.realtimeExhausted) {
    try {
      return { audio: await realtime(input), via: "realtime" };
    } catch (error) {
      if (!isQuotaError(error)) throw error;
      state.realtimeExhausted = true;
      notify?.({ from: "realtime", to: "pipeline", stage: "realtime", message: "Realtime hết hạn mức, đã chuyển sang STT→LLM→TTS." });
    }
  }
  const heard = await pipeline.stt(input);
  const reply = await pipeline.llm(heard);
  return { audio: await pipeline.tts(reply), via: "pipeline" };
}
