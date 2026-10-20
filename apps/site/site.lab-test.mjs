// Copyright (c) 2026 AIKING. Lab test of the site Worker against a simulated R2 bucket (Miniflare):
//   RELAY_LAB_DIR=<dir with miniflare> node site.lab-test.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(process.env.RELAY_LAB_DIR ? `${process.env.RELAY_LAB_DIR}/` : import.meta.url);
const { Miniflare } = require("miniflare");
const mf = new Miniflare({ scriptPath: fileURLToPath(new URL("./worker.mjs", import.meta.url)), modules: true, compatibilityDate: "2026-08-01", r2Buckets: ["SITE"] });
const bucket = await mf.getR2Bucket("SITE");
const big = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251));
await bucket.put("site/index.html", "<h1>vi</h1>");
await bucket.put("site/en/index.html", "<h1>en</h1>");
await bucket.put("site/docs/index.html", "<h1>docs</h1>");
await bucket.put("site/404.html", "<h1>nope</h1>");
await bucket.put("site/assets/app.abc.css", "body{}");
await bucket.put("site/robots.txt", "User-agent: *");
await bucket.put("downloads/0.3.0/AIKINGBOT-setup.exe", big);
await bucket.put("downloads/index.html", "<h1>downloads</h1>");
await bucket.put("downloads/release.json", '{"version":"0.3.0"}');
await bucket.put("updates/windows/latest.yml", "version: 0.3.0\n");
const get = (path, init) => mf.dispatchFetch(`http://site.test${path}`, init);
const results = [];
const check = async (name, fn) => { try { await fn(); results.push(1); console.log("ok  ", name); } catch (error) { results.push(0); console.log("FAIL", name, "\n    ", error.message.split("\n")[0]); } };

await check("home, a language folder and a docs folder", async () => {
  for (const [path, text] of [["/", "vi"], ["/en/", "en"], ["/en", "en"], ["/docs/", "docs"], ["/docs", "docs"]]) { const r = await get(path); assert.equal(r.status, 200, path); assert.match(await r.text(), new RegExp(text)); }
});
await check("types and caching: html short, fingerprinted assets forever, feed one minute", async () => {
  assert.equal((await get("/")).headers.get("content-type"), "text/html; charset=utf-8");
  assert.match((await get("/assets/app.abc.css")).headers.get("cache-control"), /immutable/);
  assert.equal((await get("/robots.txt")).headers.get("content-type"), "text/plain; charset=utf-8");
  assert.match((await get("/updates/windows/latest.yml")).headers.get("cache-control"), /max-age=60/);
  assert.equal((await get("/")).headers.get("x-content-type-options"), "nosniff");
});
await check("an unknown page is a 404 with the site's own page", async () => {
  const r = await get("/nothing-here"); assert.equal(r.status, 404); assert.match(await r.text(), /nope/);
  assert.equal((await get("/downloads/missing.exe")).status, 404);
  assert.equal((await get("/downloads/")).status, 200);
  assert.equal((await get("/updates/")).status, 404);
});
await check("an installer downloads whole, with a file name, and in ranges", async () => {
  const path = "/downloads/0.3.0/AIKINGBOT-setup.exe";
  const whole = await get(path); assert.equal(whole.status, 200);
  assert.match(whole.headers.get("content-disposition"), /attachment; filename="AIKINGBOT-setup.exe"/);
  assert.equal(Buffer.from(await whole.arrayBuffer()).equals(big), true);
  const part = await get(path, { headers: { range: "bytes=100-199" } });
  assert.equal(part.status, 206); assert.equal(part.headers.get("content-range"), "bytes 100-199/1000");
  assert.equal(Buffer.from(await part.arrayBuffer()).equals(big.subarray(100, 200)), true);
  const tail = await get(path, { headers: { range: "bytes=-50" } }); assert.equal(tail.status, 206);
  assert.equal(Buffer.from(await tail.arrayBuffer()).equals(big.subarray(950)), true);
  const open = await get(path, { headers: { range: "bytes=990-" } }); assert.equal(Buffer.from(await open.arrayBuffer()).equals(big.subarray(990)), true);
  assert.equal((await get(path, { headers: { range: "bytes=5000-6000" } })).status, 416);
});
await check("a repeat visit is answered 304, and HEAD has a length but no body", async () => {
  const first = await get("/downloads/release.json"); const etag = first.headers.get("etag"); await first.text();
  assert.equal((await get("/downloads/release.json", { headers: { "if-none-match": etag } })).status, 304);
  const head = await get("/downloads/0.3.0/AIKINGBOT-setup.exe", { method: "HEAD" });
  assert.equal(head.status, 200); assert.equal(head.headers.get("content-length"), "1000"); assert.equal((await head.text()).length, 0);
});
await check("path tricks and other methods are refused", async () => {
  for (const path of ["/..%2f..%2fsecret", "/a/../b", "//evil", "/%00"]) assert.ok([400, 404].includes((await get(path)).status), path);
  assert.equal((await get("/", { method: "POST", body: "x" })).status, 405);
});
await mf.dispose();
console.log(`site: ${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
