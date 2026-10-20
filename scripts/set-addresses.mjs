// Copyright (c) 2026 AIKING.
// Points the product at its own domain once the web service is live: the address the desktop app uses for "Remote access"
// and the "open the web app" link on the site. Run it, run the release gate, commit, build the release.
//   node scripts/set-addresses.mjs --app-url https://app.example.com
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const appUrl = args[args.indexOf("--app-url") + 1]?.replace(/\/+$/, "");
if (!appUrl || !/^https:\/\/[a-z0-9.-]+$/i.test(appUrl)) { console.error("usage: node scripts/set-addresses.mjs --app-url https://app.example.com"); process.exit(2); }
const file = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url));
const edit = (path, pattern, replacement) => {
  const source = readFileSync(file(path), "utf8");
  if (!pattern.test(source)) throw new Error(`${path}: the address was not found where expected`);
  writeFileSync(file(path), source.replace(pattern, replacement));
  console.log(`updated ${path}`);
};
edit("apps/desktop/server/aiking/relay.ts", /export const DEFAULT_RELAY_URL = "[^"]+";/, `export const DEFAULT_RELAY_URL = "${appUrl}";`);
edit("apps/site/website/site.config.json", /"appUrl": "[^"]+"/, `"appUrl": "${appUrl}"`);
