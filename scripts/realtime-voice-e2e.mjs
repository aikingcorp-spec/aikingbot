// Copyright (c) 2026 AIKING.
// Offline browser WebRTC verification. The SDP broker is a fixture; both audio peers and the call UI are real.
// This does not call a provider or prove live model speech.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { foundationRoot, runtimeRoot } from "./paths.mjs";

const info = JSON.parse(readFileSync(join(runtimeRoot, "offline-runtime.json"), "utf8"));
assert.equal(info.mode, "offline-verification");
assert.equal(new URL(info.uiUrl).hostname, "127.0.0.1");
const out = join(runtimeRoot, "evidence/shipping/realtime-voice");
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.AIKING_CHROME ?? "/usr/bin/chromium", headless: true, args: [
  "--use-fake-device-for-media-stream",
  "--use-file-for-fake-audio-capture=" + join(foundationRoot, "fixtures/voice/jfk-16k.wav"),
] });
const ctx = await browser.newContext({ permissions: ["microphone"], viewport: { width: 1280, height: 900 } });
await ctx.addInitScript(() => {
  localStorage.setItem("aiking-language", "en");
  localStorage.setItem("aiking-email-gate", "skipped");
  window.fixtureMedia = { streams: [], peers: [] };
  const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async (...args) => {
    const stream = await original(...args);
    window.fixtureMedia.streams.push(stream);
    return stream;
  };
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", e => errors.push(e.message));
let ended = false;
let phase = 0;
let finishWork = false;
let offerValidated = false;
let ok = false;
const events = [];
const fulfill = (route, value) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(value) });
await page.route("**/api/aiking/realtime/**", async route => {
  const path = new URL(route.request().url()).pathname;
  if (path.endsWith("/status")) return fulfill(route, { available: true, voices: ["marin"], agent: { supported: true, voice: "marin" } });
  if (path.endsWith("/calls") && route.request().method() === "POST") {
    const body = route.request().postDataJSON();
    assert.match(body.sdp, /^v=0/m);
    assert.match(body.sdp, /m=audio/);
    offerValidated = true;
    const sdp = await page.evaluate(async offer => {
      const peer = new RTCPeerConnection();
      window.fixtureMedia.peers.push(peer);
      const context = new AudioContext();
      const oscillator = context.createOscillator();
      const target = context.createMediaStreamDestination();
      oscillator.frequency.value = 440; oscillator.connect(target); oscillator.start();
      window.fixtureAudio = { context, oscillator, target };
      target.stream.getTracks().forEach(track => peer.addTrack(track, target.stream));
      await peer.setRemoteDescription({ type: "offer", sdp: offer });
      await peer.setLocalDescription(await peer.createAnswer());
      if (peer.iceGatheringState !== "complete") await new Promise(resolve => {
        const timeout = setTimeout(resolve, 3000);
        peer.addEventListener("icegatheringstatechange", () => { if (peer.iceGatheringState === "complete") { clearTimeout(timeout); resolve(); } });
      });
      return peer.localDescription.sdp;
    }, body.sdp);
    return fulfill(route, { id: "offline-webrtc-fixture", sdp });
  }
  if (path.endsWith("/end")) { ended = true; return fulfill(route, { ok: true }); }
  if (path.endsWith("/offline-webrtc-fixture")) {
    phase++;
    const entry = phase === 1 ? { seq: 1, type: "agent-working", request: "Offline browser fixture task" }
      : finishWork ? { seq: 2, type: "agent-done", ok: true, summary: "Offline fixture complete" } : null;
    if (entry) events.push(entry);
    return fulfill(route, { active: !ended, events: entry ? [entry] : [] });
  }
  return route.continue();
});
try {
  await page.goto(info.uiUrl);
  await page.locator("[data-workspace-rail]").waitFor({ timeout: 60000 });
  const skip = page.getByRole("button", { name: "Skip tour", exact: true });
  if (await skip.isVisible()) await skip.click();
  await page.locator("[data-voice-call-button]").first().click();
  await page.locator('[data-realtime-phase="active"]').waitFor({ timeout: 30000 });
  await page.waitForFunction(async () => {
    const peer = window.fixtureMedia.peers[0];
    if (peer?.connectionState !== "connected") return false;
    const stats = [...(await peer.getStats()).values()];
    return stats.some(item => item.type === "inbound-rtp" && item.bytesReceived > 0)
      && stats.some(item => item.type === "outbound-rtp" && item.bytesSent > 0);
  }, null, { timeout: 30000 });
  await page.locator('[data-realtime-working="true"]').waitFor({ timeout: 10000 });
  finishWork = true;
  await page.locator('[data-realtime-working="false"][data-realtime-phase="active"]').waitFor({ timeout: 10000 });
  const mute = page.locator("[data-realtime-call] button[aria-pressed]");
  await mute.click();
  assert.equal(await mute.getAttribute("aria-pressed"), "true");
  assert.equal(await page.evaluate(() => window.fixtureMedia.streams[0].getAudioTracks()[0].enabled), false);
  await mute.click();
  assert.equal(await page.evaluate(() => window.fixtureMedia.streams[0].getAudioTracks()[0].enabled), true);
  await page.screenshot({ path: join(out, "active.png") });
  await page.locator("[data-realtime-call] button").last().click();
  await page.locator("[data-realtime-call]").waitFor({ state: "hidden" });
  assert.ok(ended);
  assert.ok(await page.evaluate(() => window.fixtureMedia.streams.every(stream => stream.getTracks().every(track => track.readyState === "ended"))));
  assert.deepEqual(errors, []);
  ok = true;
  console.log("PASS real WebRTC audio both directions, work events, mute/unmute, hang-up and microphone release (offline SDP fixture)");
} finally {
  await page.evaluate(async () => {
    window.fixtureMedia?.peers.forEach(peer => peer.close());
    const audio = window.fixtureAudio;
    if (audio) { audio.oscillator.stop(); audio.target.stream.getTracks().forEach(track => track.stop()); await audio.context.close(); }
  }).catch(() => {});
  await browser.close();
  writeFileSync(join(out, "verification.json"), JSON.stringify({ ok, offlineBroker: true, liveProvider: false, offerValidated, events, ended, errors }, null, 2));
}
