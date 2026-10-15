// Copyright (c) 2026 AIKING.
// Product experience over the pinned runtime: AIKINGBOT account sign-in for workspaces (first-party Auth API email codes,
// with this server's People list as the membership authority) and access errors that say which sign-in or role fixes them.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const PRODUCT_PATCHED_FILES = ["src/state/store.tsx", "server/account-signin.ts", "server/index.ts", "src/pair/PairPage.tsx", "electron/environments.cjs", "electron/main.mjs", "electron/preload.cjs", "src/types/ogb.d.ts", "src/components/onboarding/beats/HelloBeat.tsx"];

/** The hosted AIKINGBOT workspace a desktop offers without typing an address; AIKING_WORKSPACE_URL overrides it per build or launch. */
export const DEFAULT_WORKSPACE_URL = "https://aikingbot-app.srv1866690.hstgr.cloud";

export function patchProduct(source) {
  const edit = (path, ...pairs) => {
    const file = join(source, path); let text = readFileSync(file, "utf8").replaceAll("\r\n", "\n");
    for (const [before, after] of pairs) {
      if (!text.includes(before)) throw new Error(`Product patch anchor changed: ${path}: ${before.slice(0, 80)}`);
      text = text.replace(before, after);
    }
    writeFileSync(file, text);
  };

  edit("src/state/store.tsx",
    ['import { useChatErrorClear } from "./chat-error";', 'import { useChatErrorClear } from "./chat-error";\nimport { friendlyAccessError } from "@/aiking/access-errors";'],
    ['    throw new ApiError(message, res.status, body);\n  }\n  return body;\n}', '    throw new ApiError(friendlyAccessError(res.status, message), res.status, body);\n  }\n  return body;\n}']);

  // AIKING_ACCOUNT_API_URL selects the AIKINGBOT Auth API; without it the upstream control plane contract is unchanged.
  edit("server/account-signin.ts",
    ['import type { Scope } from "./sessions.ts";', 'import type { Scope } from "./sessions.ts";\nimport { accountApiOrigin, createAikingAccountClient } from "./aiking/account-api.ts";'],
    ['    if (client) return client;\n', '    if (client) return client;\n    const aikingOrigin = accountApiOrigin(env.AIKING_ACCOUNT_API_URL);\n    if (aikingOrigin) {\n      client = createAikingAccountClient({ baseURL: aikingOrigin, fetchImpl: options.fetchImpl }) as unknown as ControlPlaneClient;\n      return client;\n    }\n'],
    ['        await controlPlane().requestOTP(email);\n      } catch (error) {\n', '        await controlPlane().requestOTP(email);\n      } catch (error) {\n        if (error instanceof ControlPlaneError && error.status === 429) {\n          return { ok: false, status: 429, error: "too many codes were requested for this address; wait a few minutes, then request a new one" };\n        }\n'],
    ['"enter the 8-digit code from the email"', '"enter the 8-character code from the email"'],
    ['"this email is not on this server\'s sign-in list; ask the server\'s owner to add it"', '"this email is not a member of this workspace yet; ask the workspace owner to invite it in Settings → People"']);

  // AIKING_WORKSPACE_OWNERS: operator-set owner addresses that are always admins, so a hosted workspace has a first owner
  // without a pairing code. They cannot be removed from the UI and are not written to config.json.
  edit("server/index.ts",
    ['  admins: parseAllowList(config.signIn?.admins?.join(",")),', '  admins: [...parseAllowList(process.env.AIKING_WORKSPACE_OWNERS), ...parseAllowList(config.signIn?.admins?.join(","))],']);

  edit("src/pair/PairPage.tsx",
    ['`We emailed an 8-digit code to ${email}. It works once and expires in ten minutes.`', '`We emailed an 8-character code to ${email} from AIKINGBOT. It works once and expires in ten minutes. Check your spam folder if it has not arrived.`'],
    ['                  placeholder="12345678"\n                  autoComplete="one-time-code"\n                  inputMode="numeric"', '                  placeholder="ABCD-EFGH"\n                  autoComplete="one-time-code"\n                  autoCapitalize="characters"'],
    ['(sent && otp.replace(/\\D/g, "").length < 8)', '(sent && otp.replace(/[^a-z0-9]/gi, "").length < 8)'],
    ['              Have a pairing code instead?', '              Advanced: connect with a pairing code']);

  // Desktop: the hosted workspace is one menu item or one onboarding button away; the server then asks for the email code.
  edit("electron/environments.cjs",
    ['function workspaceMenuTemplate(state, { onSwitch, onConnect, onForget, onAddCloud, sublabels = {} }) {', 'function workspaceMenuTemplate(state, { onSwitch, onConnect, onForget, onAddCloud, onAikingWorkspace, sublabels = {} }) {'],
    ['    ...(onAddCloud ? [{ id: "workspace-add-cloud"', '    ...(onAikingWorkspace ? [{ id: "workspace-aiking", label: "Sign in to my AIKINGBOT workspace…", sublabel: "Email sign-in, no pairing code", click: onAikingWorkspace }] : []),\n    ...(onAddCloud ? [{ id: "workspace-add-cloud"']);
  edit("electron/main.mjs",
    ['function cloudMenuOptions(source = "app_menu") {\n  return { sublabels: cloudMenuSublabels(), ', `const AIKING_WORKSPACE_ORIGIN = (() => { try { const url = new URL(process.env.AIKING_WORKSPACE_URL || "${DEFAULT_WORKSPACE_URL}"); return url.protocol === "https:" && !url.username && !url.password ? url.origin : null; } catch { return null; } })();
function aikingWorkspaceOffer() {
  if (!AIKING_WORKSPACE_ORIGIN || desktopRemoteAccess || environmentsState.environments.some((entry) => entry.origin === AIKING_WORKSPACE_ORIGIN)) return {};
  return { onAikingWorkspace: () => void workspaceMenuAction(connectAikingWorkspace) };
}
async function connectAikingWorkspace() {
  if (!AIKING_WORKSPACE_ORIGIN) throw new Error("No AIKINGBOT workspace is configured for this app.");
  const saved = environmentsState.environments.find((entry) => entry.origin === AIKING_WORKSPACE_ORIGIN);
  if (saved) return switchEnvironment(saved.id);
  // A fixed first-party address the person chose by name: no pasted link to confirm, and no code travels with it.
  let next = withEnvironment(environmentsState, { origin: AIKING_WORKSPACE_ORIGIN, name: "AIKINGBOT workspace" }, () => randomUUID());
  next = withActive(next, next.environments.find((entry) => entry.origin === AIKING_WORKSPACE_ORIGIN).id);
  persistEnvironments(next);
  navigateMainWindow(AIKING_WORKSPACE_ORIGIN);
}
function cloudMenuOptions(source = "app_menu") {
  return { ...aikingWorkspaceOffer(), sublabels: cloudMenuSublabels(), `],
    ['      : "The link has no pairing code; the server will ask for one.",', '      : "You will sign in with your AIKINGBOT email account. The workspace owner decides what you can use there.",'],
    ['ipcMain.handle("workspaces:state", workspaceOnly(() => workspaceSummary(environmentsState)));', 'ipcMain.handle("workspaces:state", workspaceOnly(() => workspaceSummary(environmentsState)));\nipcMain.handle("workspaces:connect-aiking", workspaceOnly(() => workspaceMenuAction(connectAikingWorkspace)));']);
  edit("electron/preload.cjs",
    ['    menu: (options) => ipcRenderer.invoke("workspaces:menu", ...(options?.from === "howto" ? ["howto"] : [])),', '    menu: (options) => ipcRenderer.invoke("workspaces:menu", ...(options?.from === "howto" ? ["howto"] : [])),\n    connectAiking: () => ipcRenderer.invoke("workspaces:connect-aiking"),']);
  edit("src/types/ogb.d.ts",
    ['        menu: (options?: { from?: "howto" }) => Promise<void>;\n      };', '        menu: (options?: { from?: "howto" }) => Promise<void>;\n        /** Opens the hosted AIKINGBOT workspace this app was built for; its page asks for the email code. */\n        connectAiking?: () => Promise<void>;\n      };']);
  edit("src/components/onboarding/beats/HelloBeat.tsx",
    ['      <PrimaryButton onClick={() => void saveProfile()} disabled={!valid || saving} className="animate-rise mt-3" style={staggerIndex(3)}>\n        {t("onboarding.continue")}\n      </PrimaryButton>', `      <PrimaryButton onClick={() => void saveProfile()} disabled={!valid || saving} className="animate-rise mt-3" style={staggerIndex(3)}>
        {t("onboarding.continue")}
      </PrimaryButton>
      {window.ogb?.workspaces?.connectAiking && (
        <button type="button" onClick={() => void window.ogb?.workspaces?.connectAiking?.()} className="animate-rise mt-3 text-[13px] text-ink-secondary underline-offset-2 hover:text-ink hover:underline" style={staggerIndex(4)}>
          Have an AIKINGBOT account? Sign in to your workspace
        </button>
      )}`]);
}
