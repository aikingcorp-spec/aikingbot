import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function patchIntegration(source) {
  const replace = (path, before, after) => {
    const file = join(source, path); const text = readFileSync(file, "utf8");
    if (!text.includes(before)) throw new Error(`Pinned integration anchor changed: ${path}`);
    writeFileSync(file, text.replace(before, after));
  };
  replace("src/styles.css", '@import "tailwindcss";', '@import "tailwindcss" source(none);\n@source "./";\n@source "../shared";\n@source "../index.html";');
  replace("server/routes/desktop-viewer.ts", '    server.on("upgrade", (req, socket, head) => {', '    server.on("upgrade", (req, socket, head) => {\n      if (/^\\/(?:api\\/aiking\\/voice\\/sessions|v1\\/voice\\/sessions)(?:\\?|$)/.test(req.url ?? "")) return;');
  replace("server/config.ts", '  const DEFAULT_FLEET: InstanceConfigMap = {', '  const DEFAULT_FLEET: InstanceConfigMap = {\n    aikingCore: { driver: "aiking-core", displayName: "AIKING Core" },');
  replace("server/config.ts", '  const PRODUCT_FLEET_ADDITIONS = {', '  const PRODUCT_FLEET_ADDITIONS = {\n    aikingCore: { driver: "aiking-core", displayName: "AIKING Core" },');
  replace("server/config.ts", '  const compatKeyEnv = routingDefaults?.apiKeyEnv ?? "OPENAI_COMPAT_API_KEY";\n  switch (entry.driver) {', '  const compatKeyEnv = routingDefaults?.apiKeyEnv ?? "OPENAI_COMPAT_API_KEY";\n  switch (entry.driver) {\n    case "aiking-core": return claudeInstanceOwnsRouting(entry.environment);');
  replace("server/config.ts", '  const environment = new Map<string, string>();', '  const environment = new Map<string, string>();\n  if (driver === "aiking-core" && (cfg.anthropic?.key || process.env.ANTHROPIC_API_KEY)) environment.set("ANTHROPIC_API_KEY", cfg.anthropic?.key || process.env.ANTHROPIC_API_KEY!);\n  if (driver === "aiking-core" && cfg.anthropic?.url) environment.set("ANTHROPIC_BASE_URL", cfg.anthropic.url);');
  replace("server/contracts.ts", '  text: string;\n  /** The recall block', '  text: string;\n  /** Owner-assigned reviewed library skills; private skills are resolved by botId. */\n  assignedSkills?: string[];\n  /** The recall block');
  replace("server/index.ts", '        system: prompt.text,', '        system: prompt.text,\n        assignedSkills: (liveBot ?? bot).assignedSkills,');
  replace("server/index.ts", '        system: roomSystem.text,', '        system: roomSystem.text,\n        assignedSkills: readyBot.assignedSkills,');
  replace("server/skills.ts", 'export function installSkill(', readFileSync(new URL("./patches/catalog-skill.ts.inc", import.meta.url), "utf8") + 'export function installSkill(');
  replace("scripts/control-omb.ts", "    instances: {\n", '    instances: {\n      ...(parentEnv.AIKING_CORE_TEST === "1" ? { "aiking-core-test": { driver: "aiking-core", displayName: "AIKING Core · Offline test", config: { mode: "offline" } } } : {}),\n');
  replace("server/index.ts", 'import { createServer, type IncomingMessage, type ServerResponse } from "node:http";', 'import { createServer, type IncomingMessage, type ServerResponse } from "node:http";\nimport { createAikingServices } from "./aiking/services.ts";');
  replace("server/index.ts", "const handleRequest = async", `const aikingServices = createAikingServices({
  dataDir: DATA_DIR,
  isOwnerLive: owner => owner === "loopback" || sessions.isLive(owner),
  offline: Object.values(cfg.instances ?? {}).some(instance => instance.driver === "aiking-core" && (instance.config as { mode?: string })?.mode === "offline"),
  owns: (botId, threadId) => Boolean(store.bot(botId) && store.taskByThread(botId, threadId)),
  reply: async (botId, threadId, text, signal) => {
    if (!store.taskByThread(botId, threadId)) throw new Error("This conversation does not belong to that agent.");
    const initial = botForThread(botId, threadId);
    if (!initial || threadBusy(botId, threadId)) throw new Error("This conversation is busy. End its current turn before starting voice.");
    const before = new Set(store.activePath(threadId).map(message => message.id));
    const abort = () => { void runningTurnInstance(botForThread(botId, threadId), threadId)?.adapter.interruptTurn(threadId); };
    signal.addEventListener("abort", abort, { once: true });
    try {
      await startOrQueueDirectMessage(botId, threadId, text);
      const deadline = Date.now() + 180000;
      for (;;) {
        signal.throwIfAborted();
        const current = botForThread(botId, threadId);
        if (!current) throw new Error("Conversation was removed.");
        const replies = store.activePath(threadId).filter(message => !before.has(message.id) && message.role === "bot" && message.kind === "text");
        if (!threadBusy(botId, threadId) && replies.length) return String(replies.at(-1)!.text ?? "");
        if (Date.now() > deadline) throw new Error("Voice reply timed out. Review pending approvals in chat.");
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } finally { signal.removeEventListener("abort", abort); }
  },
});
sessions.onSessionRevoked(owner => aikingServices.revokeOwner(owner));
const handleRequest = async`);
  replace("server/index.ts", '    if (await dispatchRoutes(ROUTES, { req, res, url, path, method, auth, json, readBody })) return;', '    if (await aikingServices.handle({ req, res, url, path, method, auth, json, readBody })) return;\n    if (await dispatchRoutes(ROUTES, { req, res, url, path, method, auth, json, readBody })) return;');
  replace("server/index.ts", "const server = createServer(handleRequest);", "const server = createServer(handleRequest);\naikingServices.attach(server);");
}
