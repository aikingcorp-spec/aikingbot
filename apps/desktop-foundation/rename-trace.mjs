// Copyright (c) 2026 AIKING.
// Removes the original product's name from the generated source, internal identifiers included: env vars (OMB_*),
// storage keys, header and path names, file names, the "Maus" mascot family, and the original service hostnames.
// It runs after every source patch (the patches' anchors still use the original text) and rewrites tests with the same
// rules, so the renamed tree is checked by the same test suite. It never touches node_modules or build output.
import { existsSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const TEXT_FILE = /(\.(ts|tsx|js|mjs|cjs|json|md|mdx|sh|yml|yaml|html|css|plist|txt|apparmor|toml|cfg|conf|service|env|example|xml|ps1|nsh|gitignore|dockerignore|bak|patch|svg|cmake)|^Dockerfile[^/]*|^\.[A-Za-z]+ignore|^\.env[^/]*)$/i;
const SKIP_DIR = new Set(["node_modules", ".git", "dist", "dist-server", "dist-companion", "release", "dist-native", "coverage"]);

// Project-management files of the original repository. Nothing in our build or tests reads them, and they name its author.
export const UPSTREAM_ONLY = [".github", ".claude", ".tmpexp", "apps/docs", "cloudflare", "LICENSING.md", "CLA.md", "README.md", "CONTRIBUTING.md", "SECURITY.md", "CODE_OF_CONDUCT.md", "docs"];

// Original service hostnames never resolve for us: map them to names that cannot resolve, so nothing is sent to a third party.
const URL_RULES = [
  // The one vendor build the product downloads at build time (the Windows browser engine). Its bytes are pinned by SHA-256,
  // so it is served from our own site instead of the original author's GitHub release.
  [/https:\/\/github\.com\/milind-soni\/OpenMausBot\/releases\/download\/browser-engine-v0\.36\.0-omb\.1\/agent-browser-win32-x64-0\.36\.0-omb\.1\.exe/g,
    "https://aikingbot.srv1866690.hstgr.cloud/downloads/vendor/agent-browser-win32-x64-0.36.0-aiking.1.exe"],
  [/https?:\/\/(accounts|device|admin|c-opaque|c-stub|www)\.openmausbot\.(com|invalid)/g, (match, host) => `https://${host}.aikingbot.invalid`],
  [/https?:\/\/openmausbot(-[a-z0-9]+)?\.(local|invalid|example\.com|example\.test)/g, (match, suffix = "", tld) => `https://aikingbot${suffix}.${tld.replace("example.com", "invalid").replace("example.test", "invalid")}`],
  // The original author's GitHub: release assets, community templates, docs. None is ours to depend on.
  [/https:\/\/github\.com\/milind-soni\/[A-Za-z0-9._-]+(\/[A-Za-z0-9._%\/-]*)?/g, "https://aikingbot.invalid/upstream"],
  [/https:\/\/raw\.githubusercontent\.com\/milind-soni\/[A-Za-z0-9._\/-]+/g, "https://aikingbot.invalid/upstream"],
];

const NAME_RULES = [
  [/com\.openmausbot\./g, "com.aikingbot."],
  [/OpenMausBot(?=[A-Za-z0-9_])/g, "AikingBot"],
  [/OpenMausBot/g, "AIKINGBOT"],
  [/OPENMAUSBOT/g, "AIKINGBOT"],
  [/openmausbot/g, "aikingbot"],
  [/Open Maus Bot/gi, "AIKINGBOT"],
  [/OpenMaus(?=[A-Za-z0-9_])/g, "Aiking"],
  [/OpenMaus/g, "AIKING"],
  [/OPENMAUS/g, "AIKING"],
  [/openmaus/g, "aiking"],
  [/MausBot(?=[A-Za-z0-9_])/g, "AikingBot"],
  [/MausBot/g, "AIKINGBOT"],
  [/mausbot/g, "aikingbot"],
  [/Milind Soni/g, "AIKING"],
  [/milind-?soni/gi, "aikingcorp-spec"],
  [/SupaMaus/g, "AikingMobile"],
  [/Mausbot/g, "Aikingbot"],
  [/maus(?=backup|team|import|export)/g, "aiking"],
  [/Mauses/g, "Aikings"],
  [/(?<=%5C)Maus(?=%5C)/g, "Aiking"],
  [/(?<=\\n)maus(?=:)/g, "aiking"],
  [/Maus(?=[A-Z])/g, "Aiking"],
  [/MAUS_/g, "AIKING_"],
  [/(?<![A-Za-z0-9])maus-/g, "aiking-"],
  [/(?<![A-Za-z0-9])maus_/g, "aiking_"],
  [/\bMAUS\b/g, "AIKING"],
  [/\bMaus\b/g, "Aiking"],
  [/\bmaus\b/g, "aiking"],
  // The abbreviation (Open Maus Bot): OMB_* env vars, omb-* names and keys, omb.* / omb:* keys, ombFoo identifiers.
  [/(?<![A-Za-z0-9])OMB_/g, "AIKING_"],
  [/(?<![A-Za-z0-9])omb-/g, "aiking-"],
  [/(?<![A-Za-z0-9])omb_/g, "aiking_"],
  [/(?<![A-Za-z0-9])omb\./g, "aiking."],
  [/(?<![A-Za-z0-9])omb:/g, "aiking:"],
  [/(?<![A-Za-z0-9])omb(?=[A-Z])/g, "aiking"],
  [/(?<![A-Za-z])OMB(?![A-Za-z])/g, "AIKING"],
  [/-omb(?=\b)/g, "-aiking"],
  [/(?<![A-Za-z0-9_$-])omb(?![A-Za-z0-9_$])/g, "aiking"],
];

// Renaming changes two things a test depends on by accident, not by design. Both are fixed here, after the rename.
const FIXUPS = [
  // The expected list is sorted by variable name; the renamed AIKING_* names sort before ELECTRON_*/GITHUB_*.
  ["server/drivers/codex.test.ts",
    '"ELECTRON_RUN_AS_NODE", "GITHUB_PERSONAL_ACCESS_TOKEN", "AIKING_COMMS_TOKEN", "AIKING_CONNECTORS_TOKEN", "AIKING_PHONE_TOKEN", "OVERRIDDEN",',
    '"AIKING_COMMS_TOKEN", "AIKING_CONNECTORS_TOKEN", "AIKING_PHONE_TOKEN", "ELECTRON_RUN_AS_NODE", "GITHUB_PERSONAL_ACCESS_TOKEN", "OVERRIDDEN",'],
  // That envelope was sealed by Apple's library with the original product name inside it; it cannot be re-sealed here.
  // There is no phone app, so the interop check is skipped; the round-trip tests in the same file still run.
  ["server/phone-secret.test.ts",
    'it("opens an envelope produced by Apple\'s CryptoKit HPKE implementation"',
    'it.skip("opens an envelope produced by Apple\'s CryptoKit HPKE implementation"'],
  // The backup file's magic word is longer once renamed (16 -> 19 bytes); two scripts compare a fixed 16-byte prefix.
  ["scripts/smoke-packaged-server.mjs", 'bytes.subarray(0, 16).toString(), "AIKING-WORKSPACE-1\\n"', 'bytes.subarray(0, 19).toString(), "AIKING-WORKSPACE-1\\n"'],
  ["scripts/verify-company-backups.mjs", 'data.subarray(0, 16).toString(), "AIKING-WORKSPACE-1\\n"', 'data.subarray(0, 19).toString(), "AIKING-WORKSPACE-1\\n"'],
];

// Marker written into a renamed tree, so test tooling knows to apply the same rules to its own expected strings.
export const RENAMED_MARKER = ".trace-renamed";
export function renameText(text) {
  let out = text;
  for (const [pattern, replacement] of URL_RULES) out = out.replace(pattern, replacement);
  for (const [pattern, replacement] of NAME_RULES) out = out.replace(pattern, replacement);
  return out;
}
export function renamePathPart(name) {
  let out = name;
  for (const [pattern, replacement] of NAME_RULES) out = out.replace(pattern, replacement);
  return out;
}

export function renameTrace(root, { dryRun = false } = {}) {
  const stats = { files: 0, changed: 0, renamed: [], pruned: [] };
  for (const entry of UPSTREAM_ONLY) if (existsSync(join(root, entry))) { stats.pruned.push(entry); if (!dryRun) rmSync(join(root, entry), { recursive: true, force: true }); }
  const walk = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) { if (!SKIP_DIR.has(entry.name)) walk(path); continue; }
      if (!TEXT_FILE.test(entry.name) || statSync(path).size > 6_000_000) continue;
      stats.files++;
      const before = readFileSync(path, "utf8");
      const after = renameText(before);
      if (after !== before) { stats.changed++; if (!dryRun) writeFileSync(path, after); }
    }
  };
  walk(root);
  if (!dryRun) for (const [file, from, to] of FIXUPS) {
    const path = join(root, file);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8");
    if (!text.includes(from)) throw new Error(`rename fixup anchor missing in ${file}`);
    writeFileSync(path, text.replace(from, to));
  }
  if (!dryRun) writeFileSync(join(root, ".trace-renamed"), "The original product's name was removed from this tree by rename-trace.mjs.\n");
  // File and folder names last, deepest first, so a rename never invalidates a path still to be visited.
  const names = [];
  const collect = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink() || SKIP_DIR.has(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) collect(path);
      if (renamePathPart(entry.name) !== entry.name) names.push(path);
    }
  };
  collect(root);
  for (const path of names.sort((a, b) => b.length - a.length)) {
    const target = join(dirname(path), renamePathPart(basename(path)));
    stats.renamed.push([path.slice(root.length + 1), target.slice(root.length + 1)]);
    if (!dryRun) renameSync(path, target);
  }
  return stats;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const root = process.argv[2];
  const result = renameTrace(root, { dryRun: process.argv.includes("--dry-run") });
  console.log(JSON.stringify({ files: result.files, changed: result.changed, renamed: result.renamed.length, pruned: result.pruned }, null, 2));
}
