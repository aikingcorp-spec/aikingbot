// Copyright (c) 2026 AIKING.
// Uploads the relay Worker to Cloudflare through the API (no wrangler). Reads CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID
// from the environment, and the cookie-signing key from RELAY_COOKIE_KEY (created on first deploy, never printed).
//   node deploy.mjs [--name aikingbot-relay] [--auth aikingbot-auth-staging]
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const name = option("name", "aikingbot-relay");
const authScript = option("auth", "aikingbot-auth-staging");
const token = process.env.CLOUDFLARE_API_TOKEN, account = process.env.CLOUDFLARE_ACCOUNT_ID, cookieKey = process.env.RELAY_COOKIE_KEY;
if (!token || !account) throw new Error("CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required");
const base = `https://api.cloudflare.com/client/v4/accounts/${account}`;
const call = async (path, init = {}) => {
  const response = await fetch(`${base}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });
  const payload = await response.json().catch(() => ({}));
  if (!payload.success) throw new Error(`${init.method ?? "GET"} ${path}: ${JSON.stringify(payload.errors ?? payload).slice(0, 400)}`);
  return payload.result;
};

const existing = await call("/workers/scripts").then((list) => list.some((script) => script.id === name));
const subdomain = (await call("/workers/subdomain")).subdomain;
const bindings = [
  { type: "durable_object_namespace", name: "INDEX", class_name: "Index" },
  { type: "durable_object_namespace", name: "USER", class_name: "User" },
  { type: "durable_object_namespace", name: "HOST", class_name: "Host" },
  { type: "plain_text", name: "AUTH_API", text: `https://${authScript}.${subdomain}.workers.dev` },
  { type: "service", name: "AUTH", service: authScript, environment: "production" },
];
// An existing deployment keeps its signing key (people stay signed in); a first deployment needs one.
if (cookieKey) bindings.push({ type: "secret_text", name: "COOKIE_KEY", text: cookieKey });
else if (!existing) throw new Error("RELAY_COOKIE_KEY is required on the first deployment");
const metadata = { main_module: "worker.mjs", compatibility_date: "2026-08-01", bindings, keep_bindings: existing && !cookieKey ? ["secret_text"] : [] };
if (!existing) metadata.migrations = { new_tag: "v1", new_sqlite_classes: ["Index", "User", "Host"] };
const form = new FormData();
form.set("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
form.set("worker.mjs", new Blob([readFileSync(fileURLToPath(new URL("./worker.mjs", import.meta.url)))], { type: "application/javascript+module" }), "worker.mjs");
await call(`/workers/scripts/${name}`, { method: "PUT", body: form });
await call(`/workers/scripts/${name}/subdomain`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: true, previews_enabled: false }) });
console.log(`deployed https://${name}.${subdomain}.workers.dev`);
