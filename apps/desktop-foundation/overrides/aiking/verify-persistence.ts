import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { launchVerificationServer, runControlOmb, verificationServerArgs, verificationServerEnvironment } from "../scripts/control-omb.ts";

const source = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const evidence = resolve(source, "../evidence");
mkdirSync(evidence, { recursive: true });
const fixture = await launchVerificationServer();
let restarted: ChildProcess | undefined;
const prompt = "AIKINGBOT persistence verification: keep this message after a harness restart.";

async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((done) => { child.once("exit", () => done()); child.kill("SIGTERM"); });
}

try {
  const created = await runControlOmb(["new-bot", "--name", "Persistence Check", "--url", fixture.info.url]) as { bot: { id: string } };
  const id = created.bot.id;
  await runControlOmb(["send", "--bot", id, "--text", prompt, "--url", fixture.info.url]);
  await runControlOmb(["wait", "--bot", id, "--timeout", "30", "--url", fixture.info.url]);
  const before = await runControlOmb(["messages", "--bot", id, "--url", fixture.info.url]);
  if (!JSON.stringify(before).includes(prompt)) throw new Error("The sent message was not saved.");
  await stop(fixture.child);
  const env = verificationServerEnvironment(process.env, fixture.info.dataDir, Number(new URL(fixture.info.url).port));
  restarted = spawn(process.execPath, verificationServerArgs(env), { cwd: source, env, stdio: "ignore" });
  const deadline = Date.now() + 20_000;
  for (;;) {
    if (restarted.exitCode !== null) throw new Error("Restarted harness exited.");
    try {
      if ((await fetch(`${fixture.info.url}/api/health`, { signal: AbortSignal.timeout(500) })).ok) break;
    } catch { }
    if (Date.now() >= deadline) throw new Error("Restarted harness did not become ready.");
    await new Promise((done) => setTimeout(done, 100));
  }
  const after = await runControlOmb(["messages", "--bot", id, "--url", fixture.info.url]);
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error("Saved messages changed across restart.");
  const bots = await runControlOmb(["bots", "--url", fixture.info.url]);
  if (!JSON.stringify(bots).includes(id)) throw new Error("Agent identity was lost across restart.");
  const result = { ok: true, mode: "offline-verification", agentIdentityPreserved: true, messagesPreservedAfterProcessRestart: true, botId: id };
  writeFileSync(join(evidence, "persistence.json"), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result));
} finally {
  if (restarted) await stop(restarted);
  await fixture.close();
}
