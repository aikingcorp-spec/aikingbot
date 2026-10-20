// Copyright (c) 2026 AIKING.
// Checks the shared Cloudflare helper against a stand-in API (nothing is contacted):  node scripts/cloudflare.lab-test.mjs
import assert from "node:assert/strict";
import { cloudflare } from "./cloudflare.mjs";

const calls = [];
const fake = (zones) => async (url, init = {}) => {
  const path = url.replace("https://api.cloudflare.com/client/v4", ""); calls.push({ path, method: init.method ?? "GET", body: init.body });
  if (path.startsWith("/zones?name=")) { const name = decodeURIComponent(path.split("=")[1]); return Response.json({ success: true, result: zones.filter((zone) => zone.name === name) }); }
  if (path.endsWith("/workers/domains")) return Response.json({ success: true, result: {} });
  return Response.json({ success: false, errors: [{ message: "unexpected" }] });
};
const results = []; const check = async (name, fn) => { try { await fn(); results.push(1); console.log("ok  ", name); } catch (error) { console.log("FAIL", name, error.message); process.exitCode = 1; } };

await check("a host is attached through the zone of its parent domain", async () => {
  calls.length = 0;
  const cf = cloudflare({ token: "t", account: "a", fetchImpl: fake([{ id: "z1", name: "example.com", status: "active" }]) });
  assert.deepEqual(await cf.attachDomain("aikingbot-relay", "app.example.com"), { hostname: "app.example.com", zone: "example.com" });
  const put = calls.find((call) => call.method === "PUT"); assert.equal(put.path, "/accounts/a/workers/domains");
  assert.deepEqual(JSON.parse(put.body), { hostname: "app.example.com", service: "aikingbot-relay", zone_id: "z1", environment: "production" });
});
await check("an unknown domain says what to do", async () => {
  const cf = cloudflare({ token: "t", account: "a", fetchImpl: fake([]) });
  await assert.rejects(() => cf.attachDomain("x", "app.nowhere.test"), /Add the domain to this Cloudflare account/);
});
await check("a zone that is not active is refused before anything changes", async () => {
  calls.length = 0;
  const cf = cloudflare({ token: "t", account: "a", fetchImpl: fake([{ id: "z1", name: "example.com", status: "pending" }]) });
  await assert.rejects(() => cf.attachDomain("x", "app.example.com"), /not active/);
  assert.equal(calls.filter((call) => call.method === "PUT").length, 0);
});
await check("the token never appears in an error", async () => {
  const cf = cloudflare({ token: "SECRET-TOKEN", account: "a", fetchImpl: async () => Response.json({ success: false, errors: [{ message: "denied" }] }) });
  await assert.rejects(() => cf.zoneFor("app.example.com"), (error) => !error.message.includes("SECRET-TOKEN"));
});
console.log(`${results.length} checks passed`);
