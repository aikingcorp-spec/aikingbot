// Copyright (c) 2026 AIKING.
// Native realtime voice over the workspace's own Codex (ChatGPT) sign-in: server routes behind the workspace gate
// (owner/admin only by the gate's default deny).
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const REALTIME_VOICE_PATCHED_FILES = ["server/index.ts"];

export function patchRealtimeVoice(source) {
  const edit = (path, ...pairs) => {
    const file = join(source, path); let text = readFileSync(file, "utf8").replaceAll("\r\n", "\n");
    for (const [before, after] of pairs) {
      if (text.split(before).length !== 2) throw new Error(`Realtime voice patch anchor changed or is not unique: ${path}: ${before.slice(0, 80)}`);
      text = text.replace(before, after);
    }
    writeFileSync(file, text);
  };

  edit("server/index.ts",
    ['import { createAikingServices } from "./aiking/services.ts";', 'import { createAikingServices } from "./aiking/services.ts";\nimport { AgentVoices, createRealtimeVoice, spawnCodexAppServer } from "./aiking/realtime-voice.ts";'],
    ["sessions.onSessionRevoked(owner => aikingServices.revokeOwner(owner));\n", `sessions.onSessionRevoked(owner => aikingServices.revokeOwner(owner));
const realtimeVoice = createRealtimeVoice({
  spawnAppServer: () => spawnCodexAppServer(),
  codexHome: () => process.env.CODEX_HOME?.trim() || join(homedir(), ".codex"),
  resolveTarget: (botId, threadId) => {
    const bot = store.bot(botId);
    if (!bot) return null;
    const thread = threadId ?? bot.threadId;
    if (store.botByThread(thread)?.id !== bot.id) return null;
    return {
      botId: bot.id, threadId: thread, botName: bot.name, cwd: ensureTaskWorkspace(bot.id, thread),
      // The realtime model is OpenAI's, reached through the agent's own Codex sign-in.
      voiceSupported: registry.get(bot.modelSelection.instanceId)?.driverKind === "codex",
    };
  },
  // The call's request is an ordinary message of the agent's conversation: its engine, tools and approvals run
  // and show in chat. Hanging up stops waiting for the answer, never the agent's work.
  askAgent: async (target, request, signal) => {
    const { botId, threadId } = target;
    if (!store.taskByThread(botId, threadId)) throw new Error("This conversation does not belong to that agent.");
    if (threadBusy(botId, threadId)) throw new Error(\`\${target.botName} is already working in this conversation. Wait for that to finish or stop it in chat.\`);
    const before = new Set(store.activePath(threadId).map(message => message.id));
    await startOrQueueDirectMessage(botId, threadId, \`🎙️ \${request}\`);
    const deadline = Date.now() + 15 * 60_000;
    let started = false;
    for (;;) {
      signal.throwIfAborted();
      if (!botForThread(botId, threadId)) throw new Error("The conversation was removed.");
      const busy = threadBusy(botId, threadId);
      started ||= busy;
      const fresh = store.activePath(threadId).filter(message => !before.has(message.id) && message.role === "bot");
      if (!busy && (started || fresh.length)) {
        const texts = fresh.filter(message => message.kind === "text").map(message => String(message.text ?? "").trim()).filter(Boolean);
        return texts.at(-1) ?? "";
      }
      if (Date.now() > deadline) throw new Error(\`\${target.botName} is still working after 15 minutes; the result will appear in chat.\`);
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  },
  voices: new AgentVoices(join(DATA_DIR, "aiking", "agent-voices.json")),
  log: (line) => console.log(line),
});
sessions.onSessionRevoked(owner => realtimeVoice.revokeOwner(owner));
`],
    // Before aikingServices, which answers every other /api/aiking/ path as unknown.
    ["    if (await aikingServices.handle({ req, res, url, path, method, auth, json, readBody })) return;\n", "    if (await realtimeVoice.handle({ req, res, path, method, owner: auth.kind === \"session\" ? auth.session.id : \"loopback\", json, readBody })) return;\n    if (await aikingServices.handle({ req, res, url, path, method, auth, json, readBody })) return;\n"]);

}
