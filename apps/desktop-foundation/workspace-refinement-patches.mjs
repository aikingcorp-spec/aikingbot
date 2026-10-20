// Copyright (c) 2026 AIKING.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const patches = {
  "electron/environments.cjs": [
    [
      "    if (url.username || url.password || url.search || ![\"/\", \"/pair\", \"/pair/\"].includes(url.pathname)) return null;",
      "    if (url.username || url.password || ![\"/\", \"/pair\", \"/pair/\"].includes(url.pathname)) return null;\n    const keys = [...url.searchParams.keys()];\n    const email = url.searchParams.get(\"email\");\n    if (keys.some(key => key !== \"email\") || keys.length > 1 || (email !== null && (email.length > 320 || !/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(email)))) return null;"
    ],
    [
      "    return parsed;\n  } catch {\n    return null;\n  }\n}\n\n/** Remote renderers",
      "    return email === null ? parsed : { ...parsed, url: `${url.origin}/pair${url.search}${parsed.code ? \"#code=\" + encodeURIComponent(parsed.code) : \"\"}` };\n  } catch {\n    return null;\n  }\n}\n\n/** Remote renderers"
    ]
  ],
  "src/state/store.tsx": [
    [
      "WireMessage, \"widget\">",
      "WireMessage, \"widget\" | \"sender\">"
    ]
  ],
  "src/components/GroupView.tsx": [
    [
      "    <div {...{ [MESSAGE_ROW]: \"\" }} className={cn(\"group flex w-full flex-col\", user ? \"items-end\" : \"items-start\")}>\n",
      "    <div {...{ [MESSAGE_ROW]: \"\" }} className={cn(\"group flex w-full flex-col\", user ? \"items-end\" : \"items-start\")}>\n      {user && m.sender?.name && <span data-message-sender className=\"mb-1 max-w-[78%] truncate text-[11.5px] text-ink-secondary\">{m.sender.name}</span>}\n"
    ],
    [
      "pinned.role === \"user\" ? t(\"chat.you\") :",
      "pinned.role === \"user\" ? (pinned.sender?.name ?? t(\"chat.you\")) :"
    ]
  ]
};
export const WORKSPACE_REFINEMENT_PATCHED_FILES = Object.keys(patches);
export function patchWorkspaceRefinement(source) {
  for (const [path, pairs] of Object.entries(patches)) {
    const file = join(source, path); let text = readFileSync(file, "utf8").replaceAll("\r\n", "\n");
    for (const [before, after] of pairs) {
      if (!text.includes(before)) throw new Error("Workspace refinement anchor changed: " + path + ": " + before.slice(0, 70));
      text = text.replace(before, after);
    }
    writeFileSync(file, text);
  }
}
