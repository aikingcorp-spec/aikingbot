// Generates overrides/src/locales/en.json from the pinned upstream catalog:
// AIKINGBOT calls its assistants "agents", as the OpenBot reference does.
// Placeholders such as {bot}, product names (AIKINGBOT, OpenMausBot) and real
// chat-platform bots (a Telegram or Slack bot) keep their words.
//   node apps/desktop-foundation/terminology.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const source = join(root, "../../vendor/openmausbot/src/locales/en.json");
const target = join(root, "overrides/src/locales/en.json");

const PLATFORM_KEYS = /^(telegram|slack|discord|whop|whatsapp|twilio)\b/i;
const PLATFORM_BEFORE = /(Telegram|Slack|Discord|Whop|WhatsApp|Twilio|chat|Chat|the platform's)\s+$/;
const PHRASES = [[/\bbot-to-bot\b/g, "agent-to-agent"], [/\bBot-to-bot\b/g, "Agent-to-agent"], [/\bbot-derived\b/g, "agent-derived"], [/\bbots\/groups\b/g, "agents/groups"]];
const WORD = /\b(an?\s+)?(bots?|Bots?|BOTS?)\b/g;

function agentWord(word) {
  const plural = /s$/i.test(word);
  if (word === word.toUpperCase()) return plural ? "AGENTS" : "AGENT";
  if (word[0] === "B") return plural ? "Agents" : "Agent";
  return plural ? "agents" : "agent";
}

export function toAgents(input) {
  const value = PHRASES.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), input);
  let depth = 0;
  const braces = [];
  for (let i = 0; i < value.length; i += 1) {
    if (value[i] === "{") depth += 1;
    braces.push(depth > 0);
    if (value[i] === "}") depth = Math.max(0, depth - 1);
  }
  return value.replace(WORD, (match, article, word, offset) => {
    const at = offset + (article?.length ?? 0);
    if (braces[at]) return match;
    if (PLATFORM_BEFORE.test(value.slice(0, offset))) return match;
    const next = value[at + word.length];
    if (next === "-" || next === "_" || next === "/") return match;
    if (next === "." && /[a-z]/i.test(value[at + word.length + 1] ?? "")) return match;
    if (value[at - 1] === "/" || value[at - 1] === "-" || value[at - 1] === "@") return match;
    let replaced = agentWord(word);
    // Title Case action labels ("New Bot") read as sentence case in the reference ("New agent").
    if (replaced === "Agent" && /\b(New|Add|Create|Edit|Delete|Share|Archive)\s+$/.test(value.slice(0, offset))) replaced = "agent";
    if (!article) return replaced;
    const a = article.trim();
    if (/s$/i.test(word)) return `${article}${replaced}`;
    return `${a[0] === "A" ? "An" : "an"} ${replaced}`;
  });
}

// Keys AIKINGBOT adds to the catalog. Other languages fall back to English for them.
const ADDED = {
  "settings.group.connectors": "Connectors",
};

const upstream = JSON.parse(readFileSync(source, "utf8"));
const out = {};
let changed = 0;
for (const [key, value] of Object.entries(upstream)) {
  const next = typeof value === "string" && !PLATFORM_KEYS.test(key) ? toAgents(value) : value;
  if (next !== value) changed += 1;
  out[key] = next;
}
Object.assign(out, ADDED);
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, `${JSON.stringify(out, null, 2)}\n`);
console.log(`Wrote ${target}: ${changed} of ${Object.keys(upstream).length} strings use "agent".`);
