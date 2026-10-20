// Copyright (c) 2026 AIKING.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
export const SERVER_MANAGEMENT_PATCHED_FILES = ["electron/main.mjs", "electron/preload.cjs", "src/types/ogb.d.ts", "server/remote-sessions.test.ts", "server/people-invite.test.ts", "src/lib/phone-pairing.test.ts", "src/components/ConnectedWorkspacesSettings.test.ts"];
export function patchServerManagement(source) {
  const edit=(path,pairs)=>{
    const file=join(source,path); let text=readFileSync(file,"utf8").replaceAll("\r\n","\n");
    for(const [before,after] of pairs) {
      if(text.split(before).length!==2)throw new Error("Server management anchor changed: "+path+": "+before.slice(0,60)+" count="+(text.split(before).length-1));
      text=text.replace(before,after);
    }
    writeFileSync(file,text);
  };
  edit("electron/main.mjs",[
    ['import environmentsModule from "./environments.cjs";','import environmentsModule from "./environments.cjs";\nimport serverManagement from "./server-management.cjs";'],
    ['async function connectHostedWorkspace(input, name) {','async function connectHostedWorkspace(input, name, stillAllowed = () => true) {'],
    ["    const slug = typeof name === \"string\"\n      ? name.toLowerCase().replace(/[^a-z0-9]+/g, \"-\").replace(/^-|-$/g, \"\")\n      : \"\";\n    if (typeof name !== \"string\" || !name.trim()) return { ok: false, error: \"name\", state };\n    candidateDir = path.join(os.homedir(), `.aikingbot-${slug || randomUUID().slice(0, 8)}`);","    if (typeof name !== \"string\" || !name.trim()) return { ok: false, error: \"name\", state };\n    candidateDir = serverManagement.newServerDataDir(os.homedir(), name);"],
    ['  if (response !== 0) return false;\n  let next = withEnvironment','  if (response !== 0) return false;\n  if (!stillAllowed()) throw new Error("The active server changed.");\n  let next = withEnvironment'],
    ['ipcMain.handle("workspaces:state", workspaceOnly(() => workspaceSummary(environmentsState)));',
`ipcMain.handle("workspaces:state", workspaceOnly(() => workspaceSummary(environmentsState)));
const serverActionAllowed = event => workspaceSenderAllowed(event, mainWindow?.webContents, environmentsState, rendererOrigin());
ipcMain.handle("workspaces:servers", workspaceOnly(() => serverManagement.serverDirectory(environmentsState, {
  packaged: app.isPackaged, companion: Boolean(desktopRemoteAccess),
})));
const actOnServer = serverManagement.createServerActions({
  readState: () => environmentsState, allowed: serverActionAllowed,
  packaged: () => app.isPackaged, companion: () => Boolean(desktopRemoteAccess),
  confirm: async (_event, action, name) => {
    if (action === "connect") return true;
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: "question", buttons: ["Continue", "Cancel"], defaultId: 1, cancelId: 1,
      message: action === "create" ? \`Create and open server “\${name}”?\` : \`Open server “\${name}”?\`,
      detail: "Local server changes restart the app and stop running local tasks. Server data and accounts stay in their own environment.",
    });
    return response === 0;
  },
  create: createLocalEnvironment, select: switchEnvironment,
  connect: (url, event) => {
    const activeId = environmentsState.activeId, frameURL = event.senderFrame?.url;
    return connectHostedWorkspace(url, undefined, () => serverActionAllowed(event)
      && environmentsState.activeId === activeId && event.senderFrame?.url === frameURL);
  },
});
ipcMain.handle("workspaces:server-action", workspaceOnly(actOnServer));`]
  ]);
  edit("electron/preload.cjs",[
    ['    state: () => ipcRenderer.invoke("workspaces:state"),',
`    state: () => ipcRenderer.invoke("workspaces:state"),
    servers: () => ipcRenderer.invoke("workspaces:servers"),
    select: id => ipcRenderer.invoke("workspaces:server-action", "select", id),
    create: name => ipcRenderer.invoke("workspaces:server-action", "create", name),
    connect: link => ipcRenderer.invoke("workspaces:server-action", "connect", link),`],
    ['  // Safe on a cloud page: the person chooses in a native menu; no direct switching, saved-list reads, host files or secrets.',
     '  // Remote pages receive only server names/opaque IDs. Native confirmation guards mutations; paths and secrets stay in main.']
  ]);
  edit("src/types/ogb.d.ts",[
    ['      workspaces?: {',`      workspaces?: {
        /** Names and opaque IDs only; never host paths, origins or credentials. */
        servers?: () => Promise<{ activeId: string; canCreate: boolean; servers: Array<{id:string;name:string;local:boolean;missing:boolean}> }>;
        /** Native confirmation is required before main changes servers or creates an environment. */
        select?: (id: string) => Promise<{ok:boolean;error?:string}>;
        create?: (name: string) => Promise<{ok:boolean;error?:string}>;
        connect?: (link: string) => Promise<{ok:boolean;error?:string}>;`]
  ]);
  edit("server/remote-sessions.test.ts",[
    ['mkdirSync(join(home, ".openmausbot"),','mkdirSync(join(home, ".aikingbot"),'],
    ['join(home, ".openmausbot", "config.json")','join(home, ".aikingbot", "config.json")'],
    ['expect(invite.protocol).toBe("openmausbot:");','expect(invite.protocol).toBe("aikingbot:");']
  ]);
  edit("server/people-invite.test.ts",[
    [`expect(refused.body.error).toMatch(/not on this server's sign-in list/);`,`expect(refused.body.error).toMatch(/not a member of this workspace/);`]
  ]);
  edit("src/lib/phone-pairing.test.ts",[
    ['const fetchImpl = respond({ "/api/auth/session": {}, "/api/config": new Error("offline") });',
     'const fetchImpl = respond({ "/api/auth/session": { kind: "loopback" }, "/api/config": new Error("offline") });']
  ]);

  const testFile=join(source,"src/components/ConnectedWorkspacesSettings.test.ts");
  const testText=readFileSync(testFile,"utf8").replaceAll("\r\n","\n");
  const before="Copy this computer's bots and chats";
  if(testText.split(before).length!==5)throw new Error("Server settings fixture anchor changed");
  writeFileSync(testFile,testText.replaceAll(before,"Copy this computer's agents and chats"));
}
