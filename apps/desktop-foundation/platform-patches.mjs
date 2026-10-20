// Copyright (c) 2026 AIKING.
import { readFileSync,writeFileSync } from "node:fs";
import { join } from "node:path";
export const PLATFORM_PATCHED_FILES = ["server/index.ts","src/main.tsx","src/pair/BrowserSignInPage.tsx","src/pair/PairPage.tsx","src/lib/composer-attachments.ts","src/components/AttachmentPreview.tsx","src/components/UsageHistory.tsx","src/components/ActivitySection.tsx","src/components/ScreenFrame.tsx","src/components/WorkspaceBackupSettings.tsx"];
export function patchPlatform(source) {
 const edit=(name,pairs)=>{const path=join(source,name);let data=readFileSync(path,"utf8").replaceAll("\r\n","\n");
  for(const [before,after] of pairs){if(name==="src/lib/composer-attachments.ts"&&before.trim().startsWith("return `/api/attachments/")){if(data.includes(after))continue;if(data.split(before).length!==3)throw new Error("Attachment URL anchors changed");data=data.replaceAll(before,after);continue;}if(data.split(before).length!==2)throw new Error("Platform anchor changed: "+name+": "+before.slice(0,70));data=data.replace(before,after);}writeFileSync(path,data);};
 edit("server/index.ts",[
  ['import { createAikingServices } from "./aiking/services.ts";','import { createAikingServices } from "./aiking/services.ts";\nimport { createPlatformRuntime } from "./aiking/platform-runtime.ts";'],
  ['// Public like the loopback listener it stands in for: the state is the credential, checked once.','if (await platformRuntime(req, res, path, method)) return;\n    // Public like the loopback listener it stands in for: the state is the credential, checked once.'],
  ['let restartRequested = false;',`const platformRuntime = createPlatformRuntime({
 key: process.env.AIKING_PLATFORM_RUNTIME_KEY, serverId: process.env.AIKING_PLATFORM_SERVER_ID,
 sessions, scopesFor: email => allowedScopes(email, signInAllowList()),
 accountCookie: (identity, label, req) => AIKING_OPEN_ACCOUNTS ? accountRoutes.signInCookie(identity, label, req) : null,
});
let restartRequested = false;`]
 ]);
 edit("src/main.tsx",[["import { initializeLocale } from \"./aiking/initial-locale\";", "import { serverLocalPath } from \"./aiking/platform-transport\";\nimport { initializeLocale } from \"./aiking/initial-locale\";"], ["location.pathname === \"/pair\"", "serverLocalPath(location.pathname) === \"/pair\""], ["location.pathname === \"/desktop-viewer\"", "serverLocalPath(location.pathname) === \"/desktop-viewer\""]]);
 edit("src/pair/BrowserSignInPage.tsx",[["import { useState } from \"react\";", "import { serverPagePath } from \"../aiking/platform-transport\";\nimport { useState } from \"react\";"], ["location.replace(\"/\")", "location.replace(serverPagePath(\"/\"))"]]);
 edit("src/lib/composer-attachments.ts",[["import { isCitationAttachment, serializeCitation, type CitationAttachment } from \"./citations.ts\";", "import { serverAPIPath } from \"../../shared/server-scope.ts\";\nimport { isCitationAttachment, serializeCitation, type CitationAttachment } from \"./citations.ts\";"], ["  return `/api/attachments/${encodeURIComponent(name)}`;", "  return serverAPIPath(`/api/attachments/${encodeURIComponent(name)}`);"], ["  return `/api/attachments/${encodeURIComponent(name)}`;", "  return serverAPIPath(`/api/attachments/${encodeURIComponent(name)}`);"]]);
 edit("src/components/AttachmentPreview.tsx",[["// Security: model text never turns an arbitrary local path into a browser request; transcript paths resolve through", "import { serverAPIPath } from \"@/aiking/platform-transport\";\n// Security: model text never turns an arbitrary local path into a browser request; transcript paths resolve through"], ["  return `/api/threads/${encodeURIComponent(message.threadId)}/messages/${encodeURIComponent(message.messageId)}/file?preview=1&ref=${sourceOffset}`;", "  return serverAPIPath(`/api/threads/${encodeURIComponent(message.threadId)}/messages/${encodeURIComponent(message.messageId)}/file?preview=1&ref=${sourceOffset}`);"]]);
 edit("src/components/UsageHistory.tsx",[["import { useEffect, useState } from \"react\";", "import { serverAPIPath } from \"@/aiking/platform-transport\";\nimport { useEffect, useState } from \"react\";"], ["  return `/api/usage.csv?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`;", "  return serverAPIPath(`/api/usage.csv?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`);"]]);
 edit("src/components/ActivitySection.tsx",[["import { useCallback, useEffect, useState } from \"react\";", "import { serverAPIPath } from \"@/aiking/platform-transport\";\nimport { useCallback, useEffect, useState } from \"react\";"], ["href={`/api/admin-activity.csv${query}`}", "href={serverAPIPath(`/api/admin-activity.csv${query}`)}"]]);
 edit("src/components/ScreenFrame.tsx",[["import { useState } from \"react\";", "import { serverAPIPath } from \"@/aiking/platform-transport\";\nimport { useState } from \"react\";"], ["  const src = `/api/threads/${encodeURIComponent(message.threadId)}/messages/${encodeURIComponent(message.messageId)}/image`;", "  const src = serverAPIPath(`/api/threads/${encodeURIComponent(message.threadId)}/messages/${encodeURIComponent(message.messageId)}/image`);"]]);
 edit("src/components/WorkspaceBackupSettings.tsx",[["import { useEffect, useRef, useState, type ReactNode } from \"react\";", "import { serverAPIPath } from \"@/aiking/platform-transport\";\nimport { useEffect, useRef, useState, type ReactNode } from \"react\";"], ["    const url = `/api/workspace-backup/download/${encodeURIComponent(result.id)}`;", "    const url = serverAPIPath(`/api/workspace-backup/download/${encodeURIComponent(result.id)}`);"]]);
 const pairFile=join(source,"src/pair/PairPage.tsx");
 let pair=readFileSync(pairFile,"utf8").replaceAll("\r\n","\n");
 const redirect="location.replace(pairedDestination(location.search))";
 if(pair.split(redirect).length!==4)throw new Error("Pair redirect anchor changed");
 pair='import { serverPagePath } from "../aiking/platform-transport";\n'+pair.replaceAll(redirect,"location.replace(serverPagePath(pairedDestination(location.search)))");
 if(pair.split('href="/"').length!==2)throw new Error("Pair app link anchor changed");
 pair=pair.replace('href="/"','href={serverPagePath("/")}');
 writeFileSync(pairFile,pair);

}
