// 1.2: a turn lists a small core of tools; every other mounted tool stays callable but is found through search_tools.
import { bm25Ranker, inputSignature, oneLine, type CatalogTool } from "../mcp-directory.ts";
import { PROMPT_BUDGET_TOKENS, estimateTokens } from "./prompt-budget.ts";

export interface RoutedDefinition { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } }

export const HARNESS_SEARCH_TOOL = "search_tools";
const SEARCH_HITS_DEFAULT = 5;
const SEARCH_HITS_MAX = 8;

export const HARNESS_SEARCH_DEFINITION: RoutedDefinition = {
  type: "function",
  function: {
    name: HARNESS_SEARCH_TOOL,
    description: "Find a tool that is not listed yet. Describe the job in a few words (any language); the best matches become callable on your next step.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "What you need to do, e.g. 'send email', 'đặt lịch', 'list routines'." }, limit: { type: "integer", minimum: 1, maximum: SEARCH_HITS_MAX } },
      required: ["query"],
    },
  },
};

/** ARCH §8 core, in priority order: delegate, memory, ask, attach, then one or two per surface. search_tools is always first. */
export const CORE_PRIORITY: readonly RegExp[] = [
  /^ask_user$/,
  /^agents_coordinate_bots$/,
  /^agents_session_search$/,
  /^agents_attach_file$/,
  /^agents_load_skill$|^agents_skills_list$/,
  /^browser_(?:browser_)?navigate$/,
  /^browser_(?:browser_)?(?:snapshot|read|read_page)$/,
  /^computer_(?:computer_)?screenshot$/,
  /^computer_(?:computer_)?(?:left_)?click$/,
  /^composio_composio_search_tools$/,
  /^composio_composio_multi_execute_tool$/,
  /^agents_memory_update$/,
  /^agents_request_sign_in$/,
];

export interface ToolRoute {
  /** search_tools first, then the core in priority order, then tools found this turn (appended, so the cached prefix holds). */
  visible: RoutedDefinition[];
  deferred: number;
  routed: boolean;
}

export interface ToolRouterOptions {
  /** Ceiling on the token estimate of the listed definitions (system prompt excluded); found tools are evicted oldest-first to stay under it. */
  maxToolTokens?: number;
}

/** Of a tier's cap, how many slots are kept for tools found this turn; the rest is the stable core (search_tools included). */
/** Without a measured system prompt, tools may use half the 8k budget; the rest is reserved for the system prompt. */
export const DEFAULT_TOOL_TOKENS = PROMPT_BUDGET_TOKENS / 2;

export function foundSlotsFor(maxTools: number): number {
  return Math.max(2, Math.floor(maxTools / 2));
}

const toolTokens = (definitions: readonly RoutedDefinition[]) => definitions.length ? estimateTokens(JSON.stringify(definitions)) : 0;

/**
 * 1.1/1.7: the tier cap holds for the WHOLE turn. Found tools live in a fixed window after the core; a new hit evicts
 * the least recently used one (and more if the listed definitions would go over the token ceiling). An evicted tool is
 * still mounted: naming it again, or finding it again, lists it again.
 */
export class ToolRouter<D extends RoutedDefinition = RoutedDefinition> {
  private readonly all: D[];
  private readonly core: D[];
  private found: D[] = [];
  private readonly evictedNames: string[] = [];
  readonly routed: boolean;
  readonly maxTools: number;
  readonly foundSlots: number;
  private readonly maxToolTokens: number;

  constructor(definitions: readonly D[], maxTools: number, options: ToolRouterOptions = {}) {
    this.all = [...definitions];
    this.maxTools = maxTools;
    this.maxToolTokens = options.maxToolTokens ?? DEFAULT_TOOL_TOKENS;
    this.routed = definitions.length > maxTools;
    if (!this.routed) { this.core = [...definitions]; this.foundSlots = 0; return; }
    this.foundSlots = Math.min(foundSlotsFor(maxTools), maxTools - 1);
    const coreCap = maxTools - this.foundSlots - 1;
    const picked: D[] = [];
    for (const pattern of CORE_PRIORITY) {
      for (const definition of definitions) {
        if (picked.length >= coreCap) break;
        if (pattern.test(definition.function.name) && !picked.includes(definition)) picked.push(definition);
      }
    }
    this.core = [HARNESS_SEARCH_DEFINITION as D, ...picked];
  }

  visible(): D[] { return [...this.core, ...this.found]; }

  /** Names evicted from the found window this turn, oldest first (for the report and the search reply). */
  evicted(): string[] { return [...this.evictedNames]; }

  route(): ToolRoute {
    const visible = this.visible();
    return { visible, deferred: this.all.length - (visible.length - (this.routed ? 1 : 0)), routed: this.routed };
  }

  isMounted(name: string): boolean { return this.all.some((definition) => definition.function.name === name); }

  /** A model that names a deferred tool directly still reaches it; it takes the newest found slot. */
  enable(name: string): boolean {
    if (!this.routed) return false;
    if (this.core.some((definition) => definition.function.name === name)) return false;
    const listed = this.found.findIndex((definition) => definition.function.name === name);
    if (listed >= 0) {
      // Recently used moves to the end so it is evicted last.
      const [definition] = this.found.splice(listed, 1);
      this.found.push(definition!);
      return false;
    }
    const definition = this.all.find((candidate) => candidate.function.name === name);
    if (!definition) return false;
    this.found.push(definition);
    this.evict();
    return true;
  }

  private evict(): void {
    while (this.found.length > this.foundSlots) this.drop();
    // Keep at least the newest found tool: it is what the model just asked for.
    while (this.found.length > 1 && toolTokens(this.visible()) > this.maxToolTokens) this.drop();
  }

  private drop(): void {
    const gone = this.found.shift();
    if (gone) this.evictedNames.push(gone.function.name);
  }

  async search(args: Record<string, unknown>): Promise<{ ok: boolean; text: string }> {
    const query = typeof args.query === "string" ? args.query.trim().slice(0, 500) : "";
    if (!query) return { ok: false, text: "search_tools needs a query string." };
    const slots = this.routed ? this.foundSlots : SEARCH_HITS_MAX;
    const limit = Math.min(slots, SEARCH_HITS_MAX, Math.max(1, typeof args.limit === "number" ? Math.trunc(args.limit) : SEARCH_HITS_DEFAULT));
    const catalog: CatalogTool[] = this.all.map((definition) => ({ name: definition.function.name, description: definition.function.description ?? "", inputSchema: definition.function.parameters }));
    const hits = await bm25Ranker(foldQuery(query), catalog, limit);
    if (!hits.length) return { ok: true, text: `No tool matches "${query}". Next: try other words, or check memory, a connector, the marketplace, the web, then ask the person.` };
    const before = this.evictedNames.length;
    // Lowest-ranked first, so the best hit is the most recently used and the last to be evicted.
    for (const hit of [...hits].reverse()) this.enable(hit.name);
    const listed = new Set(this.visible().map((definition) => definition.function.name));
    const callable = hits.filter((hit) => listed.has(hit.name));
    const dropped = this.evictedNames.slice(before).filter((name) => !listed.has(name));
    return { ok: true, text: [
      "These tools are now callable:",
      ...callable.map((hit) => `- ${hit.name}(${inputSignature(hit.inputSchema)}): ${oneLine(hit.description, 200)}`),
      ...(dropped.length ? [`No longer listed (search again to use): ${[...new Set(dropped)].join(", ")}`] : []),
    ].join("\n") };
  }
}

const VI_HINTS: ReadonlyArray<[RegExp, string]> = [
  [/gui|gửi/i, "send"], [/thu|email|mail/i, "email"], [/lich|lịch/i, "calendar schedule routine"], [/nho|nhớ|ghi nho/i, "memory"],
  [/tim|tìm/i, "search find"], [/tep|tệp|file/i, "file attach"], [/may|máy/i, "computer vm"], [/dang nhap|đăng nhập/i, "sign in login"],
  [/ket noi|kết nối/i, "connect connector"], [/cai|cài/i, "install"], [/nhom|nhóm|phong|phòng/i, "room team"],
];

/** A Vietnamese query keeps its words and gains the English tool vocabulary. */
export function foldQuery(query: string): string {
  const extra = VI_HINTS.filter(([pattern]) => pattern.test(query)).map(([, words]) => words);
  return extra.length ? `${query} ${extra.join(" ")}` : query;
}
