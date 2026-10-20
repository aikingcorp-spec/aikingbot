// Copyright (c) 2026 AIKING.
// Fails when the original product's name (or its abbreviation) is still anywhere in a tree. Use it on the generated source,
// the built UI/server, and an unpacked installer. Usage: node trace-scan.mjs <dir> [--allow <path-fragment>]...
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const WORDS = /open[ _-]?maus|(?<![A-Za-z])maus|milind-?soni/i;
const ABBREVIATION = /(?<![A-Za-z0-9])OMB_|(?<![A-Za-z0-9])omb[-_.:]|(?<![A-Za-z0-9])omb[A-Z]/;
const PATTERN = { test: text => WORDS.test(text) || ABBREVIATION.test(text) };
const TEXT_FILE = /(\.(ts|tsx|js|mjs|cjs|json|md|mdx|sh|yml|yaml|html|css|plist|txt|apparmor|toml|cfg|conf|service|env|example|xml|ps1|nsh|svg|cmake|patch|gitignore|dockerignore)|^Dockerfile[^/]*|^\.[A-Za-z]+ignore|^\.env[^/]*|\.yml\.[a-z]+)$/i;
const SKIP_DIR = new Set(["node_modules", ".git"]);
const allow = [];
const args = process.argv.slice(2);
const root = args.shift();
for (let i = 0; i < args.length; i++) if (args[i] === "--allow") allow.push(args[++i]);
if (!root) { console.error("Usage: node trace-scan.mjs <dir> [--allow <path-fragment>]..."); process.exit(2); }

const hits = [];
let scanned = 0;
const walk = directory => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const path = join(directory, entry.name);
    const relative = path.slice(root.length + 1);
    if (PATTERN.test(entry.name) && !allow.some(fragment => relative.includes(fragment))) hits.push({ path: relative, line: 0, text: "(file name)" });
    if (entry.isDirectory()) { if (!SKIP_DIR.has(entry.name)) walk(path); continue; }
    if (!TEXT_FILE.test(entry.name) || statSync(path).size > 40_000_000 || allow.some(fragment => relative.includes(fragment))) continue;
    let buffer;
    try { buffer = readFileSync(path); } catch { continue; }
    if (buffer.includes(0)) continue; // binary
    scanned++;
    const lines = buffer.toString("utf8").split("\n");
    for (let index = 0; index < lines.length; index++) {
      if (PATTERN.test(lines[index])) hits.push({ path: relative, line: index + 1, text: lines[index].trim().slice(0, 140) });
    }
  }
};
walk(root);
console.log(`scanned ${scanned} text files, ${hits.length} traces`);
for (const hit of hits.slice(0, 40)) console.log(`  ${hit.path}:${hit.line}  ${hit.text}`);
if (hits.length > 40) console.log(`  … and ${hits.length - 40} more`);
process.exit(hits.length ? 1 : 0);
