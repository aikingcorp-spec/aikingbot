// 3.4 + 1.6: a capability list per engine account, and routing a job to a teammate whose engine can do it.
export const CAPABILITIES = ["text", "tools", "code", "web_search", "web_browse", "image_input", "image_generate", "video_generate", "computer_use", "voice"] as const;
export type Capability = typeof CAPABILITIES[number];

const AGENT: Capability[] = ["text", "tools", "code"];
/** Declared by the engine itself; an account can add or remove via its config (3.4). Unknown drivers get text only. */
const BY_DRIVER: Record<string, Capability[]> = {
  codex: [...AGENT, "web_search", "image_input", "image_generate"],
  claudeAgent: [...AGENT, "web_search", "image_input"],
  grok: ["text", "tools", "web_search", "image_input", "image_generate", "video_generate"],
  grokAgent: [...AGENT, "web_search"],
  geminiAgent: [...AGENT, "web_search", "image_input"],
  antigravityAgent: [...AGENT, "web_browse", "image_input"],
  cursorAgent: AGENT, kimiAgent: AGENT, droidAgent: AGENT, opencodeGo: AGENT, qwenAgent: AGENT,
  hermesAgent: AGENT, clineAgent: AGENT, customAcp: AGENT, piAgent: AGENT, museCode: AGENT,
  "aiking-core": ["text", "tools"],
  "openai-compat": ["text", "tools"], mistral: ["text", "tools"], cerebras: ["text", "tools"],
  groq: ["text", "tools"], meta: ["text", "tools"], minimax: ["text", "tools", "voice"],
};

export interface CapabilityOverride { add?: readonly string[]; remove?: readonly string[] }
const isCapability = (value: string): value is Capability => (CAPABILITIES as readonly string[]).includes(value);

/** What the app adds to any engine with its tool bridge: the built-in browser and the computer. */
export interface AppSurfaces { browser?: boolean; computer?: boolean }

export function accountCapabilities(driverKind: string, override?: CapabilityOverride, surfaces: AppSurfaces = {}): Capability[] {
  const set = new Set<Capability>(BY_DRIVER[driverKind] ?? ["text"]);
  if (surfaces.browser) set.add("web_browse");
  if (surfaces.computer) set.add("computer_use");
  for (const value of override?.add ?? []) if (isCapability(value)) set.add(value);
  for (const value of override?.remove ?? []) if (isCapability(value)) set.delete(value);
  return CAPABILITIES.filter((capability) => set.has(capability));
}

export interface RoutableTeammate { id: string; name: string; capabilities: readonly Capability[] }

/** Teammates that have every needed capability, fewest extra capabilities first (the most specialised fit). */
export function routeByCapability(need: readonly Capability[], teammates: readonly RoutableTeammate[]): RoutableTeammate[] {
  return teammates
    .filter((mate) => need.every((capability) => mate.capabilities.includes(capability)))
    .sort((a, b) => a.capabilities.length - b.capabilities.length || a.name.localeCompare(b.name));
}

const JOB_HINTS: Array<[Capability, RegExp]> = [
  ["video_generate", /\b(video|clip|phim|dung video|tao video)\b/],
  ["image_generate", /\b(anh|hinh|poster|image|picture|logo|ve)\b/],
  ["web_browse", /\b(luot web|mo trang|website|browse|dang nhap)\b/],
  ["web_search", /\b(tra cuu|tim kiem|search|nghien cuu|research)\b/],
  ["code", /\b(code|lap trinh|script|bug|repo)\b/],
];
/** Rough job → capability guess from folded text; used for tests and as a hint, never as a hard gate. */
export function capabilitiesForJob(foldedText: string): Capability[] {
  return JOB_HINTS.filter(([, pattern]) => pattern.test(foldedText)).map(([capability]) => capability);
}

export function engineRosterPrompt(teammates: readonly RoutableTeammate[]): string {
  if (!teammates.length) return "";
  const rows = teammates.slice(0, 30).map((mate) => `- ${mate.name} (${mate.id}): ${mate.capabilities.join(", ")}`).join("\n");
  return `What each teammate's engine can do:\n${rows}\nWhen a job needs a capability you lack (image_generate, video_generate, web_browse, …), give it with coordinate_bots to a teammate that has it; prefer the one with the fewest other capabilities.`;
}
