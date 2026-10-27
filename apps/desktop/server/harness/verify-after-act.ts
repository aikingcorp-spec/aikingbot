// 1.8: after a send, submit or file write, the turn does not end on "done" until something read the result back.
const ACTS = /(?:^|_)(?:send|post|submit|reply|publish|write|create|update|delete|upload|fill|attach_file|vm_exec|execute|multi_execute|click|type)(?:_|$)/;
const READS = /(?:^|_)(?:read|get|list|search|fetch|snapshot|screenshot|status|find|describe|view|navigate|session_search|assignment_status)(?:_|$)/;

export type ToolEffect = "act" | "read" | "other";

export function effectOf(tool: string): ToolEffect {
  if (tool === "search_tools" || tool === "ask_user") return "other";
  if (READS.test(tool) && !/execute|multi_execute/.test(tool)) return "read";
  if (ACTS.test(tool)) return "act";
  return "other";
}

export interface VerifyState { acts: string[]; pending: string | null; verified: number; nudged: boolean }

export function createVerifyState(): VerifyState { return { acts: [], pending: null, verified: 0, nudged: false }; }

export function observeTool(state: VerifyState, tool: string, ok: boolean): void {
  const effect = effectOf(tool);
  if (effect === "act" && ok) { state.acts.push(tool); state.pending = tool; }
  else if (effect === "read" && ok && state.pending) { state.pending = null; state.verified += 1; }
}

export const VERIFY_NUDGE = "Before you tell the person it is done: read back or screenshot what you just changed (the sent message, the saved file, the submitted form) and confirm it. If you cannot check, say clearly that it is not verified.";

/** The reply the model wants to end on still owes a read-back. */
export function owesReadBack(state: VerifyState): boolean { return state.pending !== null; }

export interface VerifyReport { acted: number; verified: boolean; unverified?: string }

export function verifyReport(state: VerifyState): VerifyReport | undefined {
  if (!state.acts.length) return undefined;
  return { acted: state.acts.length, verified: state.pending === null, ...(state.pending ? { unverified: state.pending } : {}) };
}
