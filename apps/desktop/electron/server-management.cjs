// Copyright (c) 2026 AIKING.
const { LOCAL_ID } = require("./environments.cjs");

function serverDirectory(state, { packaged, companion = false }) {
  if (companion) return { activeId: "companion", canCreate: false, servers: [] };
  return {
    activeId: state.activeId, canCreate: packaged,
    servers: [
      { id: LOCAL_ID, name: "This computer", local: true, missing: false },
      ...state.environments.map(entry => ({
        id: entry.id, name: entry.name, local: entry.kind === "local", missing: entry.missing === true,
      })),
    ],
  };
}

function createServerActions({ readState, allowed, packaged, companion, confirm, create, select, connect }) {
  let pending = false;
  return async function act(event, action, input) {
    if (!allowed(event) || companion()) throw new Error("Server management is unavailable in this window.");
    if (pending) return { ok: false, error: "busy" };
    if (!["select", "create", "connect"].includes(action)) throw new Error("Unsupported server action.");
    let value;
    let label;
    if (action === "select") {
      if (typeof input !== "string") throw new Error("Invalid server.");
      const entry = serverDirectory(readState(), { packaged: packaged() }).servers.find(item => item.id === input && !item.missing);
      if (!entry) throw new Error("Unknown server.");
      value = entry.id; label = entry.name;
    } else if (action === "create") {
      if (!packaged() || typeof input !== "string" || !input.trim() || input.trim().length > 60 || /[\u0000-\u001f\u007f]/.test(input)) throw new Error("Invalid server name.");
      value = input.trim(); label = value;
    } else {
      const { parseHostedWorkspaceLink } = require("./environments.cjs");
      const link = typeof input === "string" && input.length <= 2048 ? parseHostedWorkspaceLink(input) : null;
      if (!link) throw new Error("Invalid server link.");
      value = link.url; label = new URL(link.origin).host;
    }
    const initialId = readState().activeId;
    const initialURL = event.senderFrame?.url;
    pending = true;
    try {
      if (!await confirm(event, action, label)) return { ok: false, error: "cancelled" };
      // A dialog may outlive its renderer. Never apply that renderer's action to the next server.
      if (!allowed(event) || companion() || readState().activeId !== initialId || event.senderFrame?.url !== initialURL) throw new Error("The active server changed.");
      if (action === "select") {
        if (!serverDirectory(readState(), { packaged: packaged() }).servers.some(item => item.id === value && !item.missing)) throw new Error("Unknown server.");
        const result = await select(value);
        return result?.ok === false ? result : { ok: true };
      }
      if (action === "connect") return { ok: await connect(value, event) !== false };
      const before = new Set(readState().environments.map(item => item.id));
      const result = await create(value);
      if (!result?.ok) return { ok: false, error: result?.error || "create" };
      const entry = readState().environments.find(item => item.kind === "local" && !before.has(item.id));
      if (!entry) return { ok: false, error: "create" };
      if (!allowed(event) || companion() || readState().activeId !== initialId || event.senderFrame?.url !== initialURL) throw new Error("The active server changed.");
      const switched = await select(entry.id);
      return switched?.ok === false ? switched : { ok: true };
    } finally { pending = false; }
  };
}
function newServerDataDir(home, name) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return require("node:path").join(home, `.aikingbot-${slug || "server"}-${require("node:crypto").randomUUID()}`);
}
module.exports = { serverDirectory, createServerActions, newServerDataDir };
