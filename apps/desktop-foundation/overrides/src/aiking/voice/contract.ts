// Copyright (c) 2026 AIKING. Voice contract for stage 3. Interfaces only:
// no implementation ships in stage 2 (see docs/stage-2-ui-parity.md → Voice).
// Audio on the wire: 16 kHz mono PCM16 frames of 20 ms from the client;
// the server declares its own output sample rate per reply.

export type VoiceErrorCode =
  | "permission-denied" | "no-microphone" | "device-lost"
  | "transport-failed" | "provider-unavailable" | "audio-unsupported";
export type VoiceError = { code: VoiceErrorCode; message: string; retryable: boolean };

export type VoicePhase =
  | { phase: "idle" }
  | { phase: "requesting-permission" }
  | { phase: "connecting"; attempt: number }
  | { phase: "listening" }
  | { phase: "user-speaking" }
  | { phase: "thinking" }
  | { phase: "agent-speaking" }
  | { phase: "reconnecting"; attempt: number; inMs: number }
  | { phase: "ended"; reason: "hangup" | "remote" | "idle-timeout" }
  | { phase: "error"; error: VoiceError };

export type AudioFrame = { pcm: Int16Array; sampleRate: 16000; at: number };
export type AudioChunk = { pcm: Int16Array; sampleRate: number };

export interface VoiceTransportEvents {
  onOpen(info: { resumeToken?: string }): void;
  onClose(info: { expected: boolean; error?: string }): void;
  onTranscript(line: { role: "user" | "agent"; text: string; final: boolean }): void;
  onAgentThinking(): void;
  onAgentAudio(chunk: AudioChunk): void;
  onAgentAudioEnd(): void;
  onError(error: VoiceError): void;
}

/** One live voice session. A realtime provider or an STT → agent → TTS pipeline implements it. */
export interface VoiceTransport {
  readonly id: string;
  connect(events: VoiceTransportEvents, options: { botId: string; threadId: string; resumeToken?: string }): Promise<void>;
  sendAudio(frame: AudioFrame): void;
  /** Client-side VAD decided the user stopped talking. */
  endOfUtterance(): void;
  /** Barge-in: drop the reply in flight. */
  interrupt(): void;
  close(): void;
}

/** Pipeline parts, so STT, the agent and TTS can come from different providers. */
export interface SpeechToText { transcribe(pcm: Int16Array, sampleRate: number, signal: AbortSignal): Promise<string> }
export interface AgentReplies { reply(input: { botId: string; threadId: string; text: string }, signal: AbortSignal): Promise<string> }
export interface TextToSpeech { synthesize(text: string, signal: AbortSignal): AsyncIterable<AudioChunk> }

/** Reconnect policy the session applies when a transport closes unexpectedly. */
export const VOICE_RECONNECT = { attempts: 3, delaysMs: [500, 1_000, 2_000] } as const;

/**
 * Stage 3 WebSocket protocol (AIKING Core), `wss://{core}/v1/voice/sessions`:
 *   client → {type:"session.start", botId, threadId, resumeToken?, format:{sampleRate:16000, encoding:"pcm16"}}
 *   server → {type:"session.ready", resumeToken}
 *   client → binary PCM16 frames · {type:"input.end"} · {type:"response.cancel"} · {type:"session.close"}
 *   server → {type:"transcript", role, text, final} · {type:"response.thinking"}
 *            {type:"response.audio.start", sampleRate} · binary PCM16 · {type:"response.audio.end"}
 *            {type:"error", code, message, retryable}
 */
export const VOICE_PROTOCOL_VERSION = 1;
