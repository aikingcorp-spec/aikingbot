// Copyright (c) 2026 AIKING.
// Puts the web service and the site on the owner's domain, then checks them. Run with --dry-run first: it only checks.
//   set -a; . /srv/aikingbot-staging/.secrets/cloudflare.env; . /srv/aikingbot-staging/.secrets/relay.env; set +a
//   node scripts/go-live.mjs --domain example.com [--app-host app] [--site-host www] [--dry-run]
// Without --site-host the site stays on its workers.dev address. The signing key of the web service is kept (people stay signed in).
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { cloudflare } from "./cloudflare.mjs";

const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const domain = option("domain")?.toLowerCase(), appHost = `${option("app-host", "app")}.${domain}`, siteHost = option("site-host") ? `${option("site-host")}.${domain}` : null;
const dry = args.includes("--dry-run");
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!domain || !token) { console.error("usage: node scripts/go-live.mjs --domain example.com [--app-host app] [--site-host www] [--dry-run]  (needs CLOUDFLARE_API_TOKEN)"); process.exit(2); }
// The account is the token's only account unless CLOUDFLARE_ACCOUNT_ID says otherwise.
let account = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!account) {
  const accounts = (await (await fetch("https://api.cloudflare.com/client/v4/accounts", { headers: { authorization: `Bearer ${token}` } })).json()).result ?? [];
  if (accounts.length !== 1) { console.error(`The token sees ${accounts.length} accounts; set CLOUDFLARE_ACCOUNT_ID.`); process.exit(2); }
  account = accounts[0].id; process.env.CLOUDFLARE_ACCOUNT_ID = account;
}
const root = fileURLToPath(new URL("../", import.meta.url));
const cf = cloudflare({ token, account });
const say = (ok, text) => console.log(`${ok ? "OK   " : "STOP "} ${text}`);
const stop = (text) => { say(false, text); process.exit(1); };

// 1. Everything the deploy needs, checked before anything is changed.
try { await cf.verifyToken(); say(true, "the Cloudflare token works"); } catch (error) { stop(`the Cloudflare token does not work: ${error.message}`); }
let zone; try { zone = await cf.zoneFor(appHost); } catch (error) { stop(`could not look up the domain (the token needs Zone Read): ${error.message}`); }
if (!zone) stop(`${domain} is not in this Cloudflare account yet. Add it, point the name servers at Cloudflare, and give the token Zone Read and Workers Routes permission.`);
if (zone.status !== "active") stop(`${zone.name} is "${zone.status}", not active. The name servers are not pointing at Cloudflare yet.`);
say(true, `${zone.name} is active in this Cloudflare account`);
const scripts = (await cf.api(`/accounts/${account}/workers/scripts`)).map((script) => script.id);
for (const needed of ["aikingbot-relay", "aikingbot-site", "aikingbot-auth-staging"]) say(scripts.includes(needed), `the Worker ${needed} exists`) || (process.exitCode = 1);
if (process.exitCode) stop("a Worker is missing");
for (const host of [appHost, siteHost].filter(Boolean)) {
  const records = await cf.api(`/zones/${zone.id}/dns_records?name=${encodeURIComponent(host)}`).catch(() => []);
  const clash = records.filter((record) => ["A", "AAAA", "CNAME"].includes(record.type));
  if (clash.length) stop(`${host} already has a DNS record (${clash.map((record) => `${record.type} ${record.content}`).join(", ")}). Remove it in Cloudflare so the Worker can take the name.`);
  say(true, `${host} is free to use`);
}
if (dry) { console.log("\nDry run: nothing was changed."); process.exit(0); }

// 2. Deploy, then check.
const run = (label, file, extra) => { console.log(`\n== ${label}`); const result = spawnSync(process.execPath, [file, ...extra], { cwd: root, stdio: "inherit", env: process.env }); if (result.status !== 0) stop(`${label} failed`); };
const appUrl = `https://${appHost}`, siteUrl = siteHost ? `https://${siteHost}` : "https://aikingbot-site.aiking-corp.workers.dev";
run("web service", "apps/web-remote/deploy.mjs", ["--domain", appHost]);
run("site", "apps/site/deploy.mjs", ["--site-url", siteUrl, "--app-url", appUrl, ...(siteHost ? ["--domain", siteHost] : [])]);
console.log("\n== check (DNS and the certificate can take a few minutes; it retries)");
let status = 1;
for (let attempt = 0; attempt < 10 && status !== 0; attempt++) {
  if (attempt) await new Promise((resolve) => setTimeout(resolve, 30000));
  status = spawnSync(process.execPath, ["scripts/verify-live.mjs", "--app", appUrl, "--site", siteUrl], { cwd: root, stdio: "inherit" }).status ?? 1;
}
process.exit(status);
