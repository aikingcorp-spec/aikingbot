import type { Bot, BotAnnouncement } from "./store";

export type BotUpdatePatch = Partial<
  Pick<
    Bot,
    | "name"
    | "title"
    | "description"
    | "soul"
    | "notifications"
    | "cloudBackend"
    | "autoStartVps"
    | "color"
    | "mascotExpression"
    | "mascotLook"
    | "avatarUrl"
    | "avatarCrop"
    | "avatarZoom"
    | "avatarFocusX"
    | "avatarFocusY"
    | "autoApprove"
    | "approvalMode"
    | "outbound"
    | "fallback"
    | "speakReplies"
    | "voice"
    | "voiceNotes"
    | "pinned"
    | "hidden"
    | "section"
    | "pinnedMessageId"
    | "chiefOfStaff"
    | "approvePeerComms"
    | "composio"
    | "browser"
    | "browserProfile"
    | "memoryUpkeep"
    | "cacheKeepWarm"
    | "mcpServers"
    | "modelSelection"
  >
> & {
  computer?: Bot["computer"] | null;
  connectorTools?: Bot["connectorTools"] | null;
  connectorScopes?: Bot["connectorScopes"] | null;
  /** The server's proof the local-auto warning was shown: wire-only, never folded into bot state. */
  acknowledgeLocalAuto?: boolean;
  applyToAllThreads?: boolean;
  keepThreadModels?: boolean;
};

export type BotStatePatch = Omit<
  BotUpdatePatch,
  "computer" | "connectorTools" | "connectorScopes" | "acknowledgeLocalAuto" | "applyToAllThreads" | "keepThreadModels"
> & {
  computer?: Bot["computer"];
  connectorTools?: Bot["connectorTools"];
  connectorScopes?: Bot["connectorScopes"];
};

interface BotPatchQueueEntry {
  botId: string;
  fallback: BotAnnouncement;
  pending: BotUpdatePatch;
  inFlight: BotUpdatePatch;
  timer: ReturnType<typeof setTimeout> | null;
  running: boolean;
  controller: AbortController | null;
  cancelled: boolean;
  /** Bumped by observe(): a server event newer than this lane's last read arrived. */
  epoch: number;
  idleWaiters: Array<(bot: BotAnnouncement | null) => void>;
}

export interface BotPatchQueueOptions {
  delayMs?: number;
  send: (
    botId: string,
    patch: BotUpdatePatch,
    signal: AbortSignal,
    current: BotAnnouncement,
  ) => Promise<BotAnnouncement>;
  reconcile: (botId: string, signal: AbortSignal) => Promise<BotAnnouncement | null>;
  onAuthoritative: (bot: BotAnnouncement, optimisticOverlay: BotStatePatch) => void;
  onError: (error: Error) => void;
  /**
   * Optional: the bounded re-read could not settle (read failed, or events kept arriving). The base is the commit response / latest event, not verified.
   * committed=true: our write succeeded (the user's change is saved). committed=false: it was rejected/lost; onError carries that failure.
   */
  onUnconverged?: (botId: string, info: { committed: boolean }) => void;
}

/** Initial read + at most 2 re-reads when an event overlaps a read. Never loops beyond this. */
export const MAX_RECONCILE_READS = 3;

export interface BotPatchQueue {
  enqueue: (botId: string, patch: BotUpdatePatch, fallback: BotAnnouncement) => void;
  /** Resolves the best-known base (commit response or latest event). Not proof of freshness: check isUnverified after it settles. */
  flush: (botId: string) => Promise<BotAnnouncement | null>;
  /**
   * True from a settle whose latest state could not be confirmed until a stable fresh read, an overlap-free success, cancel or dispose.
   * Held per bot id independently of the lane, so it stays true after the lane is idle/deleted.
   */
  isUnverified: (botId: string) => boolean;
  /**
   * Narrower than isUnverified: true only while a save that touched approval / memory / model (execution-critical fields) is unresolved.
   * An unrelated successful name/title/visual save does not clear it; only a stable fresh read, an overlap-free success of a critical save, cancel or dispose does.
   */
  isExecutionUnverified: (botId: string) => boolean;
  overlayFor: (botId: string) => BotStatePatch;
  cancel: (botId: string) => void;
  /** Latest server snapshot from a broadcast event. It becomes the rollback base; pending edits stay on top via overlayFor. No-op without a lane. */
  observe: (bot: BotAnnouncement) => void;
  /** Undo a dispose: StrictMode's dev mount probe runs the cleanup once against the same memoized queue. */
  revive: () => void;
  dispose: () => void;
}

const hasFields = (patch: BotUpdatePatch): boolean => Object.keys(patch).length > 0;
const hasOwn = (value: object, key: PropertyKey): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

const isAbortError = (error: unknown): boolean =>
  Boolean(error && typeof error === "object" && (error as { name?: unknown }).name === "AbortError");

const stateOverlay = (patch: BotUpdatePatch): BotStatePatch => {
  const {
    acknowledgeLocalAuto: _localAck,
    applyToAllThreads: _allThreads,
    keepThreadModels: _keepThreadModels,
    computer,
    connectorTools,
    connectorScopes,
    ...fields
  } = patch;
  const normalized: BotStatePatch = { ...fields };
  if (computer === null) normalized.computer = undefined;
  else if (computer !== undefined) normalized.computer = computer;
  if (connectorTools === null) normalized.connectorTools = undefined;
  else if (connectorTools !== undefined) normalized.connectorTools = connectorTools;
  if (connectorScopes === null) normalized.connectorScopes = undefined;
  else if (connectorScopes !== undefined) normalized.connectorScopes = connectorScopes;
  return normalized;
};

export function createBotPatchQueue(options: BotPatchQueueOptions): BotPatchQueue {
  const entries = new Map<string, BotPatchQueueEntry>();
  const delayMs = options.delayMs ?? 400;
  let disposed = false;

  // Both sets outlive the lane (a settled lane is deleted). unverified: any settle that could not be confirmed.
  // executionUnverified: the unconfirmed save carried approval/memory/model. Cleared by a stable read, cancel and dispose; unverified also by any overlap-free success,
  // executionUnverified only by an overlap-free success of a critical save.
  const unverified = new Set<string>();
  const executionUnverified = new Set<string>();
  const touchesExecution = (patch: BotStatePatch | BotUpdatePatch) =>
    hasOwn(patch, "approvalMode") || hasOwn(patch, "memoryEnabled") || hasOwn(patch, "modelSelection");
  const markUnverified = (botId: string, patch: BotStatePatch | BotUpdatePatch) => {
    unverified.add(botId);
    if (touchesExecution(patch)) executionUnverified.add(botId);
  };
  const markVerified = (botId: string, criticalSettled: boolean) => {
    unverified.delete(botId);
    if (criticalSettled) executionUnverified.delete(botId);
  };

  const settleIfIdle = (entry: BotPatchQueueEntry) => {
    if (entry.running || entry.timer !== null || hasFields(entry.pending)) return;
    entries.delete(entry.botId);
    for (const resolve of entry.idleWaiters.splice(0)) resolve(entry.fallback);
  };

  /**
   * Bounded authoritative read. A read that overlapped a broadcast event cannot be ordered against it by arrival,
   * so it is repeated (max MAX_RECONCILE_READS in total) until one completes with no event in between.
   * Only a stable read (no event between request and response) is returned; an overlapped read is never promoted, so the caller keeps the lane's
   * own base (commit response / latest observed event). null = not converged (read threw/returned null, or events kept arriving).
   */
  const reread = async (entry: BotPatchQueueEntry, signal: AbortSignal): Promise<BotAnnouncement | null> => {
    for (let i = 0; i < MAX_RECONCILE_READS; i++) {
      const epoch = entry.epoch;
      let read: BotAnnouncement | null;
      try {
        read = await options.reconcile(entry.botId, signal);
      } catch {
        return null;
      }
      if (disposed || entry.cancelled) return null;
      if (!read) return null;
      if (entry.epoch === epoch) return read;
    }
    return null;
  };

  const drain = async (entry: BotPatchQueueEntry): Promise<void> => {
    if (disposed || entry.running || entry.timer !== null || !hasFields(entry.pending)) return;
    entry.running = true;
    const patch = entry.pending;
    entry.pending = {};
    entry.inFlight = patch;
    const controller = new AbortController();
    entry.controller = controller;
    const sentEpoch = entry.epoch;

    try {
      const bot = await options.send(entry.botId, patch, controller.signal, entry.fallback);
      if (disposed || entry.cancelled) return;
      // The response is commit-ordered (it is the server's answer to our write): always the base, never dropped for an overlapping event.
      entry.fallback = bot;
      // Committed: its fields now live in the response, so an event arriving during the re-read must not be masked by the in-flight overlay.
      entry.inFlight = {};
      options.onAuthoritative(bot, stateOverlay(entry.pending));
      // An event that overlapped the request cannot be ordered against it by arrival: read once more after the write settled.
      if (entry.epoch !== sentEpoch) {
        const read = await reread(entry, controller.signal);
        if (disposed || entry.cancelled) return;
        if (read) {
          entry.fallback = read;
          markVerified(entry.botId, true);
          options.onAuthoritative(read, stateOverlay(entry.pending));
        } else {
          markUnverified(entry.botId, patch);
          options.onUnconverged?.(entry.botId, { committed: true });
        }
      } else {
        markVerified(entry.botId, touchesExecution(patch));
      }
    } catch (caught) {
      if (!disposed && !entry.cancelled) {
        const supersededApproval = controller.signal.aborted &&
          hasOwn(entry.pending, "approvalMode") &&
          isAbortError(caught);
        if (supersededApproval) return;
        // A lost HTTP response may still have committed and broadcast: re-read before rolling back.
        entry.inFlight = {};
        // null / throw = bot absent or read failed: keep the latest known base (last event or previous snapshot); never remove or re-add the bot.
        const read = await reread(entry, controller.signal);
        // Deletion may cancel this lane mid-read; folding the result back would resurrect the bot.
        if (disposed || entry.cancelled) return;
        if (read) entry.fallback = read;
        if (read) markVerified(entry.botId, true);
        else markUnverified(entry.botId, patch);
        options.onAuthoritative(entry.fallback, stateOverlay(entry.pending));
        if (!read) options.onUnconverged?.(entry.botId, { committed: false });
        options.onError(caught instanceof Error ? caught : new Error(String(caught)));
      }
    } finally {
      entry.controller = null;
      entry.inFlight = {};
      entry.running = false;
      if (!disposed && !entry.cancelled) {
        if (hasFields(entry.pending) && entry.timer === null) void drain(entry);
        settleIfIdle(entry);
      }
    }
  };

  const schedule = (entry: BotPatchQueueEntry) => {
    if (entry.timer !== null) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      entry.timer = null;
      void drain(entry);
    }, delayMs);
  };

  return {
    enqueue(botId, patch, fallback) {
      if (disposed || !hasFields(patch)) return;
      const entry = entries.get(botId) ?? {
        botId,
        fallback,
        pending: {},
        inFlight: {},
        timer: null,
        running: false,
        controller: null,
        cancelled: false,
        epoch: 0,
        idleWaiters: [],
      };
      entries.set(botId, entry);
      entry.pending = { ...entry.pending, ...patch };
      if (hasOwn(patch, "approvalMode") && !hasOwn(patch, "applyToAllThreads")) delete entry.pending.applyToAllThreads;
      // A private Full/Custom grant cannot be cancelled once it crosses the Electron bridge.
      const inFlightMode = entry.inFlight.approvalMode;
      if (
        entry.running &&
        (inFlightMode === "full" || inFlightMode === "custom") &&
        hasOwn(patch, "approvalMode") &&
        patch.approvalMode !== inFlightMode
      ) {
        entry.controller?.abort();
      }
      // Execution-boundary edits skip the debounce: work must never start under stale permissions or revoked tools.
      const immediate = Object.prototype.hasOwnProperty.call(patch, "approvalMode") ||
        Object.prototype.hasOwnProperty.call(patch, "modelSelection") ||
        Object.prototype.hasOwnProperty.call(patch, "connectorTools");
      if (immediate) {
        if (entry.timer !== null) clearTimeout(entry.timer);
        entry.timer = null;
        void drain(entry);
      } else {
        schedule(entry);
      }
    },

    flush(botId) {
      const entry = entries.get(botId);
      if (!entry) return Promise.resolve(null);
      if (entry.timer !== null) {
        clearTimeout(entry.timer);
        entry.timer = null;
      }
      const idle = new Promise<BotAnnouncement | null>((resolve) => entry.idleWaiters.push(resolve));
      void drain(entry);
      settleIfIdle(entry);
      return idle;
    },

    isUnverified(botId) {
      return unverified.has(botId);
    },

    isExecutionUnverified(botId) {
      return executionUnverified.has(botId);
    },

    overlayFor(botId) {
      const entry = entries.get(botId);
      return entry ? stateOverlay({ ...entry.inFlight, ...entry.pending }) : {};
    },

    cancel(botId) {
      // Clear first: an idle or already-deleted id has no lane, but its flags must still go.
      unverified.delete(botId);
      executionUnverified.delete(botId);
      const entry = entries.get(botId);
      if (!entry) return;
      entry.cancelled = true;
      if (entry.timer !== null) clearTimeout(entry.timer);
      entry.controller?.abort();
      entries.delete(botId);
      for (const resolve of entry.idleWaiters.splice(0)) resolve(null);
    },

    observe(bot) {
      const entry = entries.get(bot.id);
      if (!entry || entry.cancelled || disposed) return;
      entry.fallback = bot;
      entry.epoch++;
    },

    revive() {
      disposed = false;
    },

    dispose() {
      disposed = true;
      unverified.clear();
      executionUnverified.clear();
      for (const entry of entries.values()) {
        entry.cancelled = true;
        if (entry.timer !== null) clearTimeout(entry.timer);
        entry.controller?.abort();
        for (const resolve of entry.idleWaiters.splice(0)) resolve(null);
      }
      entries.clear();
    },
  };
}
