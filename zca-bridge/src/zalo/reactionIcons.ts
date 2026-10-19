// Map zca-js Reactions codes (e.g. "/-heart") to a human emoji for the Chatwoot note.
// Only the common ones are mapped; anything else falls back to a generic marker.
const REACTION_EMOJI: Record<string, string> = {
  "/-heart": "❤️",
  "/-strong": "👍",
  ":>": "😆",
  ":o": "😮",
  ":-((": "😢",
  ":-h": "😡",
  ":-*": "😘",
  ":')": "😂",
  "/-rose": "🌹",
  "/-break": "💔",
  "/-weak": "👎",
  ";xx": "😍",
  "/-ok": "👌",
  "/-thanks": "🙏",
  "/-no": "🚫",
};

const REMOVED = "";

export function isReactionRemoval(code: string): boolean {
  return code === REMOVED;
}

export function reactionEmoji(code: string): string {
  return REACTION_EMOJI[code] ?? "❤️";
}
