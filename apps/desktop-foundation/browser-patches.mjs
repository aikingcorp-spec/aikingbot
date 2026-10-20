// Copyright (c) 2026 AIKING.
// Agents' browser on an AIKINGBOT server: a real (headed) Chrome on a private virtual display when the image ships Xvfb
// (AIKING_BROWSER_VIRTUAL_DISPLAY=1), because headless Chrome announces itself as HeadlessChrome and many sites refuse
// it, and Chrome's automation flag (navigator.webdriver) makes Google refuse searches; and Google as the address
// bar's search.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const BROWSER_PATCHED_FILES = ["server/browser-engine.ts", "server/browser-runtime.ts", "server/browser-live.ts", "server/browser-live.test.ts", "server/browser-engine.test.ts", "src/lib/browser-address.ts", "src/lib/browser-address.test.ts"];

export function patchBrowser(source) {
  const edit = (path, ...pairs) => {
    const file = join(source, path); let text = readFileSync(file, "utf8").replaceAll("\r\n", "\n");
    for (const [before, after, all] of pairs) {
      if (!text.includes(before) || (!all && text.split(before).length !== 2)) throw new Error(`Browser patch anchor changed or is not unique: ${path}: ${before.slice(0, 80)}`);
      text = all ? text.replaceAll(before, after) : text.replace(before, after);
    }
    writeFileSync(file, text);
  };
  edit("server/browser-engine.ts",
    ["    if (input.headless !== false || displayless) {", `    // agent-browser starts a private Xvfb display for a headed launch when none is set (agent-browser 0.37 README).
    if ((input.platform ?? process.platform) === "linux" && sourceEnv.AIKING_BROWSER_VIRTUAL_DISPLAY === "1" && input.headless !== true) {
      env.AGENT_BROWSER_HEADED = "1";
      // Without it Chrome sets navigator.webdriver, and Google answers searches with its "unusual traffic" page.
      env.AGENT_BROWSER_ARGS = VIRTUAL_DISPLAY_ARGS;
      // The page size is then the server's to set too (ownsBrowserViewport).
      env.AIKING_BROWSER_VIRTUAL_DISPLAY = "1";
    } else if (input.headless !== false || displayless) {`]);
  // Every agent-browser call must ask for the same launch, or the daemon relaunches Chrome between calls and the
  // action in flight is lost ("A browser action was interrupted"). Control calls carry no flags, only this config.
  edit("server/browser-engine.ts",
    [`function ensureManagedBrowserConfig(env: NodeJS.ProcessEnv): string {
  const path = managedBrowserConfigPath(env);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  try { writeFileSync(path, "{}\\n", { flag: "wx", mode: 0o600 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if (readFileSync(path, "utf8").trim() !== "{}") throw new Error("The managed browser configuration was changed. Restore it to an empty JSON object before connecting.");
  }
  return path;
}`, `/** The launch every call shares: a headed Chrome without the automation flag on a server with a virtual display. */
export function managedBrowserLaunch(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  return platform === "linux" && env.AIKING_BROWSER_VIRTUAL_DISPLAY === "1"
    ? JSON.stringify({ headed: true, args: VIRTUAL_DISPLAY_ARGS })
    : "{}";
}
const VIRTUAL_DISPLAY_ARGS = "--disable-blink-features=AutomationControlled";

function ensureManagedBrowserConfig(env: NodeJS.ProcessEnv): string {
  const path = managedBrowserConfigPath(env);
  const expected = managedBrowserLaunch();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  try { writeFileSync(path, \`\${expected}\\n\`, { flag: "wx", mode: 0o600 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const current = readFileSync(path, "utf8").trim();
    if (current !== expected) {
      // Only this server's own two contents are replaced; anything else is someone's edit.
      if (current !== "{}" && current !== managedBrowserLaunch({ AIKING_BROWSER_VIRTUAL_DISPLAY: "1" }, "linux")) {
        throw new Error("The managed browser configuration was changed. Restore it to an empty JSON object before connecting.");
      }
      writeFileSync(path, \`\${expected}\\n\`, { mode: 0o600 });
    }
  }
  // Calls that name no config read the user-level one: it must ask for the same launch.
  if (expected !== "{}") {
    const user = join(dirname(path), "config.json");
    let existing = "";
    try { existing = readFileSync(user, "utf8").trim(); } catch { /* none yet */ }
    if (!existing || existing === "{}" || existing === expected) writeFileSync(user, \`\${expected}\\n\`, { mode: 0o600 });
  }
  return path;
}`]);
  // Headed Chrome on the 1280x720 display opens a 1050x557 page, but agent-browser reports its frames as 1280x720, so
  // the live view scaled every click away from the pointer. The server sizes the page, as it does for headless Chrome.
  edit("server/browser-runtime.ts",
    ['  return env.AGENT_BROWSER_HEADLESS === "1" && !attachesToChrome(env);',
    '  return (env.AGENT_BROWSER_HEADLESS === "1" || (env.AGENT_BROWSER_HEADED === "1" && env.AIKING_BROWSER_VIRTUAL_DISPLAY === "1")) && !attachesToChrome(env);']);
  // A key or click the engine answered with a failure has ended: nothing is left running, so it must not demand a restart
  // (upstream treated every refused input as a lost one). Only an input that got no answer keeps the restart barrier.
  edit("server/browser-live.ts",
    [`      if (!(await relay(viewer.port, command, { timeoutMs: 30_000, maxBytes: 65_536 })).success) throw new Error("input failed");
      if (command.action === "press"`, `      const answer = await relay(viewer.port, command, { timeoutMs: 30_000, maxBytes: 65_536 });
      if (!answer.success) {
        // Names only: the engine's text may echo what was typed.
        console.warn(\`browser \${viewer.session}: input refused: \${String(command.action)} \${String(eventType)} \${[...key].length > 1 ? key : "(character)"}\`);
        if (type === "input_keyboard" && eventType === "keyDown") viewer.pressedKeys.delete(key);
        if (type === "input_mouse" && eventType === "mousePressed") viewer.pressedButtons.delete(String(fields.button));
        throw new BrowserInputRefused();
      }
      if (command.action === "press"`],
    [`    } catch { throw new BrowserLiveError("The browser could not confirm this input.`, `    } catch (error) { if (error instanceof BrowserInputRefused) throw error; throw new BrowserLiveError("The browser could not confirm this input.`],
    [`export class BrowserActionFailedError extends BrowserLiveError {`, `/** The engine answered that it did not take this input: finished, so nothing needs restarting. */
export class BrowserInputRefused extends BrowserLiveError {
  readonly settled = true;
  constructor() { super("The browser did not accept that input. Try again.", 422); this.name = "BrowserInputRefused"; }
}

export class BrowserActionFailedError extends BrowserLiveError {`]);
  edit("server/browser-live.test.ts",
    [`  it("keeps uncertain discrete key presses behind the existing restart barrier and hides raw failures", async () => {`, `  it("does not demand a restart when the engine answers that it refused a key", async () => {
    runtime = new BrowserRuntime(); live = new BrowserLive({ runtime });
    const a = await open(); await a.action({ type: "take" });
    nativeInput.mockImplementationOnce(async () => Response.json({ success: false, error: "password=private" }));
    await expect(a.action({ type: "input_keyboard", eventType: "keyDown", key: "Enter" })).rejects.toThrow("did not accept that input");
    await a.action({ type: "release" });
    await expect(runtime.withAgentAction("profile-a", async () => true)).resolves.toBe(true);
  });
  it("keeps an input that got no answer behind the restart barrier and hides raw failures", async () => {`],
    [`    nativeInput.mockImplementationOnce(async () => Response.json({ success: false, error: "password=private" }));
    await expect(a.action({ type: "input_keyboard", eventType: "keyDown", key: "Enter" })).rejects.toThrow("could not confirm this input");
    expect(JSON.parse(nativeInput.mock.calls[0]![1].body)).toEqual({ action: "press", key: "Enter" });`, `    nativeInput.mockImplementationOnce(async () => { throw new Error("socket hang up password=private"); });
    await expect(a.action({ type: "input_keyboard", eventType: "keyDown", key: "Enter" })).rejects.toThrow("could not confirm this input");
    expect(JSON.parse(nativeInput.mock.calls[0]![1].body)).toEqual({ action: "press", key: "Enter" });`],
    [`    nativeInput.mockImplementationOnce(async () => Response.json({ success: false }));
    await expect(a.action({ type: "input_keyboard", eventType: "keyDown", key: "Enter" })).rejects.toThrow("could not confirm this input");
    await expect(a.action({ type: "back" }))`, `    nativeInput.mockImplementationOnce(async () => { throw new Error("socket hang up"); });
    await expect(a.action({ type: "input_keyboard", eventType: "keyDown", key: "Enter" })).rejects.toThrow("could not confirm this input");
    await expect(a.action({ type: "back" }))`]);
  edit("server/browser-engine.test.ts",
    ["import { removeTempDir } from \"./testing/cleanup.ts\";\n", "import { removeTempDir } from \"./testing/cleanup.ts\";\nimport { ownsBrowserViewport } from \"./browser-runtime.ts\";\n"],
    ["  agentBrowserIntegration,\n", "  agentBrowserIntegration,\n  managedBrowserLaunch,\n"],
    [`  it("keeps saved state separate for different bots and never saves guest state", () => {`, `  it("runs a headed Chrome on a server that ships a virtual display, unless headless is asked for", () => {
    const linux = { binaryPath: "/x/agent-browser", session: "s", encryptionKey: "k", platform: "linux" as const, env: { PATH: "/usr/bin", AIKING_BROWSER_VIRTUAL_DISPLAY: "1" } };
    expect(agentBrowserIntegration(linux).env).toMatchObject({ AGENT_BROWSER_HEADED: "1", AGENT_BROWSER_ARGS: "--disable-blink-features=AutomationControlled" });
    expect(agentBrowserIntegration(linux).env.AGENT_BROWSER_HEADLESS).toBeUndefined();
    // The page is sized by the server, so the live view's frames and clicks share one size.
    expect(ownsBrowserViewport(agentBrowserIntegration(linux).env)).toBe(true);
    expect(ownsBrowserViewport({ AGENT_BROWSER_HEADED: "1" })).toBe(false);
    expect(agentBrowserIntegration({ ...linux, headless: true }).env).toMatchObject({ AGENT_BROWSER_HEADLESS: "1", AGENT_BROWSER_HEADED: "0" });
    expect(agentBrowserIntegration({ ...linux, platform: "darwin" }).env).toMatchObject({ AGENT_BROWSER_HEADLESS: "1" });
  });

  it("gives calls without flags the same launch as the agent's, so the browser is not relaunched between them", () => {
    expect(JSON.parse(managedBrowserLaunch({ AIKING_BROWSER_VIRTUAL_DISPLAY: "1" }, "linux"))).toEqual({ headed: true, args: "--disable-blink-features=AutomationControlled" });
    expect(managedBrowserLaunch({}, "linux")).toBe("{}");
    expect(managedBrowserLaunch({ AIKING_BROWSER_VIRTUAL_DISPLAY: "1" }, "darwin")).toBe("{}");
  });

  it("keeps saved state separate for different bots and never saves guest state", () => {`]);
  edit("src/lib/browser-address.ts", ['const SEARCH_URL = "https://duckduckgo.com/?q=";', 'const SEARCH_URL = "https://www.google.com/search?q=";']);
  edit("src/lib/browser-address.test.ts", ["https://duckduckgo.com/?q=", "https://www.google.com/search?q=", true]);
}
