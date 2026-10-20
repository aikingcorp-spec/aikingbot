// Copyright (c) 2026 AIKING.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const patches = {
  "server/index.ts": [
    [
      "import { json, onJsonBody, parsedBodyOf, readBody } from \"./harness/http.ts\";",
      "import { json, onJsonBody, parsedBodyOf, readBody } from \"./harness/http.ts\";\nimport { publicAuthRefusal, securityResponseHeaders } from \"./aiking/request-guard.ts\";"
    ],
    [
      "  const method = req.method ?? \"GET\";\n  let m:",
      "  const method = req.method ?? \"GET\";\n  securityResponseHeaders(res, path);\n  const refusal = publicAuthRefusal(req, path, method);\n  if (refusal) {\n    if (refusal.retryAfter) res.setHeader(\"retry-after\", String(refusal.retryAfter));\n    return json(res, refusal.status, {error: refusal.error});\n  }\n  let m:"
    ],
    [
      "createServer(handleRequest)",
      "createServer({ requestTimeout: 60_000, headersTimeout: 15_000, maxHeaderSize: 16_384 }, handleRequest)"
    ]
  ],
  "server/account-signin.ts": [
    [
      "import type { Scope } from \"./sessions.ts\";",
      "import type { Scope } from \"./sessions.ts\";\nimport { WindowLimiter } from \"./aiking/request-guard.ts\";"
    ],
    [
      "  openIdentity?: boolean;",
      "  openIdentity?: boolean;\n  now?: () => number;"
    ],
    [
      "  const env = options.env ?? process.env;",
      "  const env = options.env ?? process.env;\n  const emailStarts = new WindowLimiter(5, 10 * 60_000, 1000, options.now ?? Date.now);"
    ],
    [
      "      try {\n        await controlPlane().requestOTP(email);",
      "      if (emailStarts.take(email)) return {ok:false,status:429,error:\"Too many codes requested for this address; wait before requesting another.\"};\n      try {\n        await controlPlane().requestOTP(email);"
    ]
  ],
  "server/data/engine.ts": [
    [
      "env.OMB_DUCKDB_MAX_TEMP_SIZE || \"20GB\"",
      "env.OMB_DUCKDB_MAX_TEMP_SIZE || \"512MB\""
    ],
    [
      "  private queue: Promise<unknown> = Promise.resolve();",
      "  private queue: Promise<unknown> = Promise.resolve();\n  private pending = 0;"
    ],
    [
      "    const turn = this.queue.then(() => this.execute(sql, options, work));",
      "    if (this.pending >= 32) return Promise.reject(new DataFailure({ code: \"engine_unavailable\", message: \"Database query queue is full. Retry after pending queries finish.\", retryable: true }));\n    this.pending++;\n    const turn = this.queue.then(() => this.execute(sql, options, work)).finally(() => { this.pending--; });"
    ]
  ]
};
patches["server/index.ts"].push(...[
[
  "import { existsSync, readFileSync, realpathSync, rmSync, mkdirSync } from \"node:fs\";",
  "import { existsSync, realpathSync, rmSync, mkdirSync } from \"node:fs\";"
],
  [
    "import { publicAuthRefusal, securityResponseHeaders } from \"./aiking/request-guard.ts\";",
    "import { publicAuthRefusal, securityResponseHeaders } from \"./aiking/request-guard.ts\";\nimport { readPublicAsset } from \"./aiking/public-assets.ts\";"
  ],
  [
    "  const safe = path === \"/\" ? \"/index.html\" : path.replace(/\\.\\./g, \"\");",
    "  const safe = path === \"/\" ? \"/index.html\" : path;"
  ],
  [
    "    const data = readFileSync(file);",
    "    const data = readPublicAsset(STATIC_DIR, safe);"
  ],
  [
    "      const data = readFileSync(join(STATIC_DIR, \"index.html\"));",
    "      const data = readPublicAsset(STATIC_DIR, \"/index.html\");"
  ]
]);
patches["src/lib/session.ts"] = [
[
  "export interface EnvironmentDescriptor {",
  "import { at } from \"../aiking/strings\";\n\nexport interface EnvironmentDescriptor {"
],
  [
    "  if (record.kind === \"session\" && typeof record.id === \"string\") {",
    "  if (record.kind === \"session\" && typeof record.id === \"string\" && record.id.trim() &&\n      Array.isArray(record.scopes) && record.scopes.every(scope => typeof scope === \"string\") &&\n      typeof record.expiresAt === \"number\" && Number.isFinite(record.expiresAt) && record.expiresAt > 0) {"
  ],
  [
    "  return record.trust === \"service\" ? { kind: \"loopback\", trust: \"service\" } : { kind: \"loopback\" };",
    "  if (record.kind === \"loopback\" && (record.trust === undefined || record.trust === \"service\")) {\n    return record.trust === \"service\" ? { kind: \"loopback\", trust: \"service\" } : { kind: \"loopback\" };\n  }\n  return { kind: \"unreachable\", error: at(\"pair.sessionUnavailable\") };"
  ],
  [
    "  return decodeURIComponent(m[1]);",
    "  try { return decodeURIComponent(m[1]); } catch { return null; }"
  ]
];
patches["src/main.tsx"] = [
  [
    "  const session = await readSessionState();",
    "  const session = await readSessionState();\n  if (session.kind === \"unreachable\") return <PairPage initialCode={null} reason={session.error} />;"
  ]
];
export const SECURITY_REFINEMENT_PATCHED_FILES = Object.keys(patches);
export function patchSecurityRefinement(source) {
  for (const [path, pairs] of Object.entries(patches)) {
    const file = join(source, path); let text = readFileSync(file, "utf8").replaceAll("\r\n", "\n");
    for (const [before, after] of pairs) {
      if (!text.includes(before)) throw new Error("Security refinement anchor changed: " + path + ": " + before.slice(0, 70));
      text = text.replaceAll(before, after);
    }
    writeFileSync(file, text);
  }
}
