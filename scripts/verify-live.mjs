// Copyright (c) 2026 AIKING.
// A light check of the live web service and site after a deploy (about fifteen requests, no sign-in, nothing is changed).
//   node scripts/verify-live.mjs --app https://app.example.com [--site https://www.example.com]
// Exit code 1 when a check fails.
const args = process.argv.slice(2);
const option = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const app = option("app")?.replace(/\/+$/, ""), site = option("site")?.replace(/\/+$/, "");
if (!app) { console.error("usage: node scripts/verify-live.mjs --app https://… [--site https://…]"); process.exit(2); }
let failed = 0;
const check = async (name, fn) => {
  try { const detail = await fn(); console.log(`PASS  ${name}${detail ? `  (${detail})` : ""}`); }
  catch (error) { failed += 1; console.log(`FAIL  ${name}  (${String(error.message).slice(0, 160)})`); }
};
const get = (url, init = {}) => fetch(url, { redirect: "manual", signal: AbortSignal.timeout(15000), ...init });
const expect = (condition, message) => { if (!condition) throw new Error(message); };

await check("the web client answers over https", async () => { const r = await get(`${app}/__relay/health`); expect(r.status === 200, `status ${r.status}`); const j = await r.json(); expect(j.status === "ready", JSON.stringify(j)); });
await check("the sign-in page is served", async () => { const r = await get(`${app}/__relay/`); const t = await r.text(); expect(r.status === 200 && /<html/i.test(t), `status ${r.status}`); expect(!/srv1866690|hstgr\.cloud/.test(t), "mentions the old staging server"); });
await check("a stranger is sent to sign in, not given data", async () => { const r = await get(`${app}/`, { headers: { accept: "text/html" } }); expect(r.status === 302 && /\/__relay\//.test(r.headers.get("location") ?? ""), `status ${r.status}`); });
await check("the computer list refuses a stranger", async () => { const r = await get(`${app}/__relay/api/hosts`); expect(r.status === 401, `status ${r.status}`); });
await check("a forged session is refused", async () => { const r = await get(`${app}/__relay/api/hosts`, { headers: { cookie: "rl_session=forged.forged" } }); expect(r.status === 401, `status ${r.status}`); });
await check("the connection endpoint refuses a computer without a key", async () => {
  const outcome = await new Promise((resolve) => {
    const socket = new WebSocket(`${app.replace(/^http/, "ws")}/__relay/connect`);
    const timer = setTimeout(() => { socket.close(); resolve("stayed open"); }, 8000);
    socket.onopen = () => { clearTimeout(timer); socket.close(); resolve("accepted"); };
    socket.onerror = () => { clearTimeout(timer); resolve("refused"); };
    socket.onclose = () => { clearTimeout(timer); resolve("refused"); };
  });
  expect(outcome === "refused", outcome);
});

if (site) {
  await check("the home page (Vietnamese)", async () => { const r = await get(`${site}/`); expect(r.status === 200, `status ${r.status}`); const t = await r.text(); expect(t.includes(new URL(app).host), "the page does not link to the web app"); });
  await check("the home page (English)", async () => { const r = await get(`${site}/en/`); expect(r.status === 200, `status ${r.status}`); });
  await check("the docs page", async () => { const r = await get(`${site}/docs/`); expect(r.status === 200, `status ${r.status}`); });
  await check("the download list is published", async () => { const r = await get(`${site}/downloads/release.json`); expect(r.status === 200, `status ${r.status}`); const j = await r.json(); expect(Array.isArray(j.files) && j.files.length > 0, "no files listed"); return `${j.files.length} files`; });
  await check("the update feed is published", async () => { const r = await get(`${site}/updates/windows/latest.yml`); expect(r.status === 200, `status ${r.status}`); const t = await r.text(); expect(/^version:/m.test(t), "no version line"); return t.match(/^version:\s*(.+)$/m)?.[1]; });
}
console.log(`\n${failed ? `${failed} check(s) failed` : "all checks passed"}`);
process.exit(failed ? 1 : 0);
