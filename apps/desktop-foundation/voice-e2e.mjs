import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { foundationRoot, runtimeRoot, sourceRoot } from "./setup.mjs";

const info = JSON.parse(readFileSync(join(runtimeRoot, "offline-runtime.json"), "utf8"));
assert.equal(info.mode, "offline-verification");
assert.equal(new URL(info.uiUrl).hostname, "127.0.0.1");
const { WebSocketServer } = await import(pathToFileURL(join(sourceRoot, "node_modules/ws/wrapper.mjs")).href);
const server = new WebSocketServer({ host: "127.0.0.1", port: 0, path: "/v1/voice/sessions" });
await new Promise((resolve) => server.once("listening", resolve));
const endpoint = `ws://127.0.0.1:${server.address().port}/v1/voice/sessions`;
const wire = { starts: [], frames: 0, nonzero: 0, endpoints: 0, cancellations: 0, closes: 0, sizes: new Set() };
let connections = 0;
server.on("connection", (socket) => {
  const number = ++connections;
  let rateDeclared = false;
  socket.on("message", (data, binary) => {
    if (binary) {
      assert.ok(rateDeclared, "session.start preceded input audio");
      assert.equal(data.length, 640, "20 ms PCM16 mono input frames");
      wire.frames++; wire.sizes.add(data.length);
      for (let i = 0; i < data.length; i += 2) if (data.readInt16LE(i) !== 0) { wire.nonzero++; break; }
      if (number === 1 && wire.frames === 8) socket.close(1012, "Reconnect fixture");
      return;
    }
    const event = JSON.parse(data.toString());
    if (event.type === "session.start") {
      assert.deepEqual(event.format, { sampleRate: 16000, encoding: "pcm16" });
      wire.starts.push(event); rateDeclared = true;
      socket.send(JSON.stringify({ type: "session.ready", resumeToken: "e2e-resume" }));
    } else if (event.type === "input.end") {
      wire.endpoints++;
      socket.send(JSON.stringify({ type: "transcript", role: "user", text: "JFK microphone fixture received (scripted transcript).", final: true }));
      socket.send(JSON.stringify({ type: "response.thinking" }));
      socket.send(JSON.stringify({ type: "transcript", role: "agent", text: "WebSocket protocol v1 reply (offline).", final: true }));
      socket.send(JSON.stringify({ type: "response.audio.start", sampleRate: 24000 }));
      const pcm = Buffer.alloc(24000 * 2 * 2);
      for (let i = 0; i < pcm.length / 2; i++) pcm.writeInt16LE(Math.round(Math.sin(2 * Math.PI * i * 440 / 24000) * 1600), i * 2);
      socket.send(pcm);
      socket.send(JSON.stringify({ type: "response.audio.end" }));
    } else if (event.type === "response.cancel") wire.cancellations++;
    else if (event.type === "session.close") wire.closes++;
  });
});

const out = join(runtimeRoot, "evidence", process.env.AIKING_VERIFY_STAGE === "shipping" ? "shipping" : "stage2", "voice");
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.AIKING_CHROME || "/usr/bin/chromium", headless: true, args: [
  "--use-fake-device-for-media-stream",
  `--use-file-for-fake-audio-capture=${join(foundationRoot, "fixtures/voice/jfk-16k.wav")}`,
] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ["microphone"] });
await context.addInitScript(() => { try { localStorage.setItem("aiking-email-gate", "skipped"); } catch {} });
await context.addInitScript(() => {
  const metrics = { contexts: [], tracks: [], playbackRates: [], sinks: [] };
  window.voiceEvidence = metrics;
  const Original = window.AudioContext;
  window.AudioContext = class extends Original {
    constructor(...args) { super(...args); metrics.contexts.push(this); }
    createBufferSource() {
      const source = super.createBufferSource();
      const start = source.start.bind(source);
      source.start = (...args) => { metrics.playbackRates.push(source.buffer?.sampleRate); return start(...args); };
      return source;
    }
    async setSinkId(id) { metrics.sinks.push(id); return super.setSinkId(id); }
  };
  const get = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async (...args) => {
    const stream = await get(...args); metrics.tracks.push(...stream.getTracks()); return stream;
  };
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const steps = [];
async function step(name, run) {
  await run(); await page.screenshot({ path: join(out, `${name}.png`) }); steps.push({ name, ok: true }); console.log(`ok ${name}`);
}
const dialog = () => page.getByRole("dialog", { name: /^Voice call with / });
async function openCall() {
  await page.getByRole("button", { name: /^Voice call with / }).first().click();
  await dialog().waitFor();
}
async function closedAudio() {
  await page.waitForFunction(() => window.voiceEvidence.tracks.every((track) => track.readyState === "ended") && window.voiceEvidence.contexts.every((context) => context.state === "closed"));
}
let ok = false;
let failure;
try {
  await page.goto(info.uiUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.getByRole("textbox", { name: /^Message / }).first().waitFor({ timeout: 120000 });
  const skip = page.getByRole("button", { name: "Skip tour", exact: true });
  if (await skip.isVisible()) await skip.click();
  await step("voice-devices", async () => {
    await openCall();
    await page.waitForFunction(() => document.querySelector('select[aria-label="Microphone"]')?.options.length > 1);
    await dialog().getByLabel("Microphone", { exact: true }).selectOption({ index: 1 });
    const selected = await dialog().getByLabel("Microphone", { exact: true }).inputValue();
    assert.ok(selected);
    await dialog().getByLabel("Speaker", { exact: true }).selectOption({ index: 1 });
    const selectedSpeaker = await dialog().getByLabel("Speaker", { exact: true }).inputValue();
    assert.ok(selectedSpeaker);
    await page.getByRole("button", { name: "Close voice call", exact: true }).click();
    await openCall();
    assert.equal(await dialog().getByLabel("Microphone", { exact: true }).inputValue(), selected);
    assert.equal(await dialog().getByLabel("Speaker", { exact: true }).inputValue(), selectedSpeaker);
  });
  await step("voice-readiness", async () => {
    const checks = dialog().getByRole("list", { name: "Voice call readiness" });
    for (const id of ["platform", "engine", "speech"]) await checks.locator(`[data-voice-check="${id}"][data-voice-check-ok="true"]`).waitFor({ timeout: 30000 });
    assert.equal(await page.getByRole("button", { name: "Start voice call", exact: true }).isEnabled(), true);
  });
  await step("voice-loopback-audio", async () => {
    await page.getByRole("button", { name: "Test microphone and speaker", exact: true }).click();
    await page.locator('[data-voice-phase="agent-speaking"]').waitFor({ timeout: 45000 });
    await page.getByRole("log", { name: "Voice transcript" }).getByText(/Offline microphone test/).waitFor();
    assert.ok(Number(await page.locator("[data-voice-frames]").getAttribute("data-voice-frames")) > 10);
    assert.ok(await page.evaluate(() => window.voiceEvidence.playbackRates.includes(24000)));
    assert.equal(await page.evaluate(() => window.voiceEvidence.sinks[0]), await dialog().getByLabel("Speaker", { exact: true }).inputValue());
    await page.getByRole("button", { name: "Interrupt reply", exact: true }).click();
    assert.ok(Number(await page.locator("[data-voice-interruptions]").getAttribute("data-voice-interruptions")) >= 1);
  });
  await step("voice-mute-and-minimize", async () => {
    await page.getByRole("button", { name: "Mute microphone", exact: true }).click();
    const before = Number(await page.locator("[data-voice-frames]").getAttribute("data-voice-frames"));
    await page.waitForTimeout(750);
    assert.equal(Number(await page.locator("[data-voice-frames]").getAttribute("data-voice-frames")), before);
    assert.ok(await page.evaluate(() => window.voiceEvidence.tracks.every((track) => !track.enabled)));
    await page.getByRole("button", { name: "Minimize voice call", exact: true }).click();
    await page.getByRole("textbox", { name: /^Message / }).first().waitFor();
    await page.getByRole("button", { name: "Return to voice call", exact: true }).click();
    await page.getByRole("button", { name: "Unmute microphone", exact: true }).click();
    await page.getByRole("button", { name: "Hang up voice call", exact: true }).click();
    await closedAudio();
  });
  await step("voice-websocket-reconnect", async () => {
    await dialog().getByText("Advanced voice options", { exact: true }).click();
    await dialog().getByLabel("Voice service", { exact: true }).selectOption("websocket");
    await dialog().getByLabel("Voice server URL", { exact: true }).fill(endpoint);
    await page.getByRole("button", { name: /^(Start voice call|Call again)$/ }).click();
    await page.waitForFunction(() => Number(document.querySelector("[data-voice-reconnects]")?.getAttribute("data-voice-reconnects")) >= 1, null, { timeout: 45000 });
    await page.locator('[data-voice-phase="agent-speaking"]').waitFor({ timeout: 45000 });
    assert.ok(wire.starts.length >= 2); assert.equal(wire.starts[1].resumeToken, "e2e-resume");
    assert.ok(wire.frames > 8 && wire.nonzero > 8 && wire.endpoints > 0);
    assert.ok(wire.starts.every((event) => event.botId === wire.starts[0].botId && event.threadId === wire.starts[0].threadId));
    await page.getByRole("button", { name: "Interrupt reply", exact: true }).click();
    await page.waitForTimeout(100); assert.ok(wire.cancellations > 0);
    await page.getByRole("button", { name: "Hang up voice call", exact: true }).click();
    await closedAudio(); await page.waitForTimeout(100); assert.ok(wire.closes > 0);
  });
  await step("voice-permission-denied", async () => {
    await page.getByRole("button", { name: "Close voice call", exact: true }).click();
    const cdp = await context.newCDPSession(page);
    const { targetInfo } = await cdp.send("Target.getTargetInfo");
    await cdp.send("Browser.setPermission", { permission: { name: "microphone" }, setting: "denied", origin: new URL(info.uiUrl).origin, browserContextId: targetInfo.browserContextId });
    await openCall();
    await dialog().getByLabel("Microphone", { exact: true }).selectOption("");
    await dialog().getByLabel("Speaker", { exact: true }).selectOption("");
    await page.getByRole("button", { name: "Test microphone and speaker", exact: true }).click();
    await page.locator('[data-voice-error="permission-denied"]').waitFor();
    await closedAudio();
  });
  assert.deepEqual(errors, []); ok = true;
} catch (error) {
  failure = String(error);
  await page.screenshot({ path: join(out, "voice-e2e-failed.png") }).catch(() => {});
  throw error;
} finally {
  const report = { ok, failure, steps, rendererErrors: errors, fixture: "jfk-16k.wav", realSttVerified: false, realProviderVerified: false, protocol: 1, wire: { ...wire, sizes: [...wire.sizes] }, playback: await page.evaluate(() => ({ rates: window.voiceEvidence?.playbackRates, sinks: window.voiceEvidence?.sinks, tracks: window.voiceEvidence?.tracks.map((track) => track.readyState), contexts: window.voiceEvidence?.contexts.map((context) => context.state) })).catch(() => null) };
  writeFileSync(join(out, "chromium-voice-e2e.json"), `${JSON.stringify(report, null, 2)}\n`);
  await browser.close();
  for (const socket of server.clients) socket.terminate();
  await new Promise((resolve) => server.close(resolve));
}
