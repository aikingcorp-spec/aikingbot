// 1.4: a failed tool call gets a type, and a capability gap climbs a fixed ladder instead of ending the turn.
export const LADDER = ["memory", "connector", "marketplace", "web", "browser", "ask_user"] as const;
export type Rung = (typeof LADDER)[number];

export type ToolErrorKind =
  | "not_connected"   // a connector or account is missing
  | "needs_sign_in"   // a connector exists but its sign-in is pending
  | "not_found"       // no tool / skill / record for this
  | "unsupported"     // this engine or surface cannot do it
  | "excluded"        // the owner's tool selection removed it
  | "forbidden"       // the backend refused: permission denied, 403, rejected — another account, connector or route may work
  | "denied"          // a person said no: never retried or routed around, only taken back to the person
  | "transient"       // timeout, rate limit, network
  | "invalid_args"
  | "failed";

export interface TypedToolError { kind: ToolErrorKind; recoverable: boolean; next?: Rung; hint?: string }

// Order matters: a person's "no" first, then sign-in/connection gaps, then a backend refusal, then the rest.
const RULES: ReadonlyArray<[ToolErrorKind, RegExp]> = [
  ["denied", /\b(?:user|owner|person|human)\b[^.\n]{0,40}\b(?:denied|declined|rejected|refused|said no)\b|\b(?:denied|declined|rejected|refused) by (?:the )?(?:user|owner|person|human)\b|the person (?:declined|said no)|was not approved/i],
  ["excluded", /tool selection excludes/i],
  ["needs_sign_in", /sign[- ]?in (?:is )?(?:required|pending|needed)|needs? (?:a )?sign[- ]?in|oauth|not authenticated|unauthori[sz]ed|401\b/i],
  ["not_connected", /not connected|no (?:connected )?account|connect (?:an?|the) |no connection|missing (?:integration|connector)/i],
  ["forbidden", /permission denied|access denied|forbidden|\b403\b|not (?:allowed|permitted) to|insufficient (?:permissions?|scopes?|privileges?)|(?:backend|server|api|service|provider) (?:has )?(?:rejected|refused|denied)|rejected (?:this|the) (?:action|request|call)|refused (?:this|the) (?:action|request|call)/i],
  ["unsupported", /not supported|unsupported|does(?: not|n't) support|not implemented|cannot do this|not available (?:on|in|for) this/i],
  ["not_found", /not found|no such|unknown tool|was not advertised|no tool matches|does not exist|404\b/i],
  ["transient", /timed? ?out|timeout|rate.?limit|429\b|503\b|econnreset|temporarily|try again later/i],
  ["invalid_args", /arguments? (?:do not match|are malformed|must be)|invalid argument|schema/i],
];

/** The kinds that climb the ladder instead of ending the turn. */
export const CLIMBING_KINDS: readonly ToolErrorKind[] = ["not_connected", "needs_sign_in", "forbidden", "not_found", "unsupported", "denied"];

/** The rung after the one this failure came from; a capability gap starts at memory and goes up. */
const START: Partial<Record<ToolErrorKind, Rung>> = {
  not_found: "memory",
  not_connected: "connector",
  needs_sign_in: "connector",
  forbidden: "connector",
  unsupported: "marketplace",
  excluded: "ask_user",
};

export function rungOf(tool: string): Rung | undefined {
  if (/session_search|memory/.test(tool)) return "memory";
  if (/request_connect|composio|connector/.test(tool)) return "connector";
  if (/marketplace|propose_install/.test(tool)) return "marketplace";
  if (/web_search|web_fetch|search_web|fetch_url/.test(tool)) return "web";
  if (tool.startsWith("browser_")) return "browser";
  if (tool === "ask_user") return "ask_user";
  return undefined;
}

export function nextRung(after: Rung | undefined): Rung {
  if (!after) return LADDER[0];
  const index = LADDER.indexOf(after);
  return LADDER[Math.min(LADDER.length - 1, index + 1)];
}

const HINT: Record<Rung, string> = {
  memory: "check memory (session_search) for how this was done before",
  connector: "connect the missing account (request_connect or search_tools 'connect')",
  marketplace: "look for an installable skill or MCP server (marketplace_search, then propose_install)",
  web: "search or read the web",
  browser: "do it in the browser",
  ask_user: "ask the person (ask_user) what to do",
};

export function classifyToolError(tool: string, text: string): TypedToolError {
  const kind = RULES.find(([, pattern]) => pattern.test(text))?.[0] ?? "failed";
  // A person's "no" is never retried or worked around; the only step left is to go back to the person.
  if (kind === "denied") return { kind, recoverable: true, next: "ask_user", hint: "a person declined this: do not retry it or try another route; ask the person (ask_user) what they want instead" };
  if (kind === "transient" || kind === "invalid_args" || kind === "failed") return { kind, recoverable: kind !== "failed" };
  const from = rungOf(tool);
  const start = START[kind] ?? "memory";
  // Climb at least one rung above where the failure happened.
  const next = from && LADDER.indexOf(from) >= LADDER.indexOf(start) ? nextRung(from) : start;
  const hint = kind === "forbidden" && next === "connector"
    ? "the backend refused this: use another connected account or connector that has the permission (request_connect), or reconnect with the missing scope"
    : HINT[next];
  return { kind, recoverable: true, next, hint };
}

export function ladderNote(error: TypedToolError): string {
  if (!error.recoverable || !error.next) return "";
  return `\n[error:${error.kind}] Next step: ${error.hint}. Do not stop or claim this cannot be done until you reach ask_user.`;
}
