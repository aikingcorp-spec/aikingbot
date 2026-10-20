#!/usr/bin/env node
// Copyright (c) 2026 AIKING.
// Publishes an AIKINGBOT desktop release into the web root served by
// deploy/aikingbot-web: verified files under downloads/<version>/, the
// download manifest the website reads, and the electron-updater feeds.
//
//   node publish-release.mjs publish <web-root> <source-dir> --sums <SHA256SUMS> [--commit <sha>] [--ci-run <id>]
//        [--notes-vi <text>] [--notes-en <text>] [--keep 3] [--dry-run]
//   node publish-release.mjs rollback <web-root> <version>
//   node publish-release.mjs status <web-root>
//
// Every file must match the SHA-256 in --sums (produced where it was built), so a
// truncated or altered transfer is refused. Nothing visible changes until all
// files are verified and staged; the public pointers (release.json, SHA256SUMS,
// latest, updates/*/latest*.yml) are then swapped with atomic renames.
import { createHash } from "node:crypto";
import { createReadStream, existsSync, linkSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync, copyFileSync, lstatSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const PATTERNS = [
  { re: /^AIKINGBOT-(.+)-setup\.exe$/, platform: "windows", kind: "installer", feed: "windows" },
  { re: /^AIKINGBOT-(.+)-x64\.zip$/, platform: "windows", kind: "portable" },
  { re: /^AIKINGBOT-(.+)-amd64\.deb$/, platform: "linux", kind: "deb" },
  { re: /^AIKINGBOT-(.+)-x86_64\.AppImage$/, platform: "linux", kind: "appimage", feed: "linux" },
];
const FEED_FILE = { windows: "latest.yml", linux: "latest-linux.yml" };
const STABLE_NAME = { "windows/installer": "AIKINGBOT-setup.exe", "windows/portable": "AIKINGBOT-portable-x64.zip" };

function fail(message) { console.error(`publish-release: ${message}`); process.exit(1); }
function options(args) {
  const out = { _: [] };
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith("--")) { out._.push(args[i]); continue; }
    const key = args[i].slice(2);
    if (key === "dry-run") out.dryRun = true; else out[key] = args[++i];
  }
  return out;
}
const digest = (file, algorithm, encoding) => new Promise((done, reject) => {
  const hash = createHash(algorithm);
  createReadStream(file).on("data", (chunk) => hash.update(chunk)).on("error", reject).on("end", () => done(hash.digest(encoding)));
});
function readSums(file) {
  const sums = new Map();
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.trim().match(/^([0-9a-f]{64})\s+\*?(.+)$/i);
    if (match) sums.set(basename(match[2].trim()), match[1].toLowerCase());
  }
  return sums;
}
const yamlString = (value) => `'${String(value).replaceAll("'", "''")}'`;
function feedYaml(entry, releasedAt, notes) {
  const lines = [`version: ${entry.version}`, "files:", `  - url: ${entry.name}`, `    sha512: ${entry.sha512}`, `    size: ${entry.size}`,
    `path: ${entry.name}`, `sha512: ${entry.sha512}`, `releaseDate: ${yamlString(releasedAt)}`];
  if (notes) lines.push(`releaseNotes: ${yamlString(notes)}`);
  return `${lines.join("\n")}\n`;
}
function atomicWrite(path, content) {
  const temp = `${path}.tmp-${process.pid}`;
  writeFileSync(temp, content, { mode: 0o644 });
  renameSync(temp, path);
}
function atomicSymlink(target, path) {
  const temp = `${path}.tmp-${process.pid}`;
  rmSync(temp, { force: true });
  symlinkSync(target, temp);
  renameSync(temp, path);
}
const human = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;
const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function readJson(path, fallback) { try { return JSON.parse(readFileSync(path, "utf8")); } catch { return fallback; } }

function indexHtml(history) {
  const rows = history.map((release) => `<section><h2>AIKINGBOT ${escapeHtml(release.version)}${release === history[0] ? ' <span class="tag">latest</span>' : ""}</h2>
<p class="meta">${escapeHtml(release.releasedAt)}${release.commit ? ` · commit <code>${escapeHtml(release.commit.slice(0, 12))}</code>` : ""}${release.ciRun ? ` · CI run ${escapeHtml(release.ciRun)}` : ""} · <a href="${escapeHtml(release.version)}/SHA256SUMS">SHA256SUMS</a></p>
<table><thead><tr><th>File</th><th>Size</th><th>SHA-256</th></tr></thead><tbody>
${release.files.map((f) => `<tr><td><a href="${escapeHtml(f.url)}">${escapeHtml(f.name)}</a></td><td>${human(f.size)}</td><td><code>${f.sha256}</code></td></tr>`).join("\n")}
</tbody></table></section>`).join("\n");
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>AIKINGBOT downloads</title><meta name="robots" content="noindex">
<style>body{margin:0;background:#0d0f12;color:#e8eaed;font:15px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}main{max-width:1040px;margin:0 auto;padding:40px 16px}
a{color:#6ee7c0}h1{font-size:28px;margin:0 0 4px}h2{font-size:19px;margin:32px 0 4px}.meta{color:#9aa1ab;margin:0 0 12px;font-size:13px}
.tag{font-size:12px;background:#6ee7c0;color:#0d0f12;border-radius:99px;padding:2px 8px;vertical-align:middle}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:8px;border-bottom:1px solid #23272e;vertical-align:top}
code{font:12px ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all;color:#c9ced6}.scroll{overflow-x:auto}</style></head>
<body><main><h1>AIKINGBOT downloads</h1><p class="meta"><a href="/">← aikingbot</a> · Verify: <code>Get-FileHash .\\FILE -Algorithm SHA256</code> (Windows) or <code>sha256sum -c SHA256SUMS</code></p>
<div class="scroll">${rows || "<p>No release published yet.</p>"}</div></main></body></html>
`;
}

function pointAt(root, release) {
  const downloads = join(root, "downloads");
  atomicWrite(join(downloads, "release.json"), `${JSON.stringify(release, null, 2)}\n`);
  copyFileSync(join(downloads, release.version, "SHA256SUMS"), join(downloads, `SHA256SUMS.tmp-${process.pid}`));
  renameSync(join(downloads, `SHA256SUMS.tmp-${process.pid}`), join(downloads, "SHA256SUMS"));
  atomicSymlink(release.version, join(downloads, "latest"));
  for (const [feed, file] of Object.entries(FEED_FILE)) {
    const source = join(downloads, release.version, `.feed-${file}`);
    if (existsSync(source)) {
      const dir = join(root, "updates", feed);
      mkdirSync(dir, { recursive: true });
      atomicWrite(join(dir, file), readFileSync(source));
    }
  }
}

async function publish(root, source, opts) {
  if (!opts.sums) fail("--sums <SHA256SUMS> is required: every file is verified against the hashes computed where it was built.");
  const expected = readSums(resolve(opts.sums));
  const candidates = readdirSync(source).filter((name) => PATTERNS.some((p) => p.re.test(name)));
  if (!candidates.length) fail(`no AIKINGBOT release files in ${source}`);
  const versions = new Set(candidates.map((name) => PATTERNS.find((p) => p.re.test(name)).re.exec(name)[1]));
  if (versions.size !== 1) fail(`mixed versions in ${source}: ${[...versions].join(", ")}`);
  const [version] = versions;
  if (!VERSION.test(version)) fail(`invalid version ${version}`);

  const downloads = join(root, "downloads");
  const target = join(downloads, version);
  if (existsSync(target)) fail(`${version} is already published (releases are immutable; bump the version or use rollback)`);
  mkdirSync(downloads, { recursive: true });

  const files = [];
  for (const name of candidates.sort()) {
    const path = join(source, name);
    const want = expected.get(name);
    if (!want) fail(`${name} is not listed in ${opts.sums}`);
    const sha256 = await digest(path, "sha256", "hex");
    if (sha256 !== want) fail(`${name}: SHA-256 ${sha256} does not match the expected ${want}`);
    const pattern = PATTERNS.find((p) => p.re.test(name));
    files.push({ name, path, platform: pattern.platform, kind: pattern.kind, feed: pattern.feed, size: statSync(path).size, sha256,
      sha512: pattern.feed ? await digest(path, "sha512", "base64") : undefined });
    console.log(`verified ${name} ${sha256}`);
  }
  if (opts.dryRun) { console.log(`dry run: ${version} verified, nothing published`); return; }

  const releasedAt = new Date().toISOString();
  const notes = { vi: opts["notes-vi"] || undefined, en: opts["notes-en"] || undefined };
  const stage = join(downloads, `.staging-${version}-${process.pid}`);
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });
  for (const file of files) {
    copyFileSync(file.path, join(stage, file.name));
    if ((await digest(join(stage, file.name), "sha256", "hex")) !== file.sha256) fail(`${file.name} changed while copying`);
    const stable = STABLE_NAME[`${file.platform}/${file.kind}`];
    if (stable) linkSync(join(stage, file.name), join(stage, stable));
    const blockmap = join(source, `${file.name}.blockmap`);
    if (file.feed && existsSync(blockmap)) copyFileSync(blockmap, join(stage, `${file.name}.blockmap`));
    if (file.feed) writeFileSync(join(stage, `.feed-${FEED_FILE[file.feed]}`), feedYaml({ ...file, version }, releasedAt, notes.en));
  }
  writeFileSync(join(stage, "SHA256SUMS"), files.map((f) => `${f.sha256}  ${f.name}`).join("\n") + "\n");
  const release = {
    schema: 1, product: "AIKINGBOT", version, channel: version.includes("-") ? "beta" : "stable", releasedAt,
    commit: opts.commit || undefined, ciRun: opts["ci-run"] || undefined, notes,
    files: files.map(({ name, platform, kind, size, sha256 }) => ({ platform, kind, name, url: `/downloads/${version}/${name}`, size, sha256 })),
    updateFeeds: Object.fromEntries(files.filter((f) => f.feed).map((f) => [f.feed, `/updates/${f.feed}/`])),
  };
  writeFileSync(join(stage, "release.json"), `${JSON.stringify(release, null, 2)}\n`);
  renameSync(stage, target);

  // Feed binaries are hard links (same file system), so the updater and the website serve identical bytes.
  for (const file of files.filter((f) => f.feed)) {
    const dir = join(root, "updates", file.feed);
    mkdirSync(dir, { recursive: true });
    for (const name of [file.name, `${file.name}.blockmap`]) {
      if (existsSync(join(target, name)) && !existsSync(join(dir, name))) linkSync(join(target, name), join(dir, name));
    }
  }
  pointAt(root, release);
  const history = [release, ...readJson(join(downloads, "releases.json"), []).filter((r) => r.version !== version)];
  prune(root, history, Number(opts.keep || 3));
  console.log(`published ${version}: ${files.map((f) => f.name).join(", ")}`);
}

function prune(root, history, keep) {
  const downloads = join(root, "downloads");
  const kept = history.slice(0, Math.max(keep, 1));
  for (const old of history.slice(kept.length)) {
    rmSync(join(downloads, old.version), { recursive: true, force: true });
    for (const feed of Object.keys(FEED_FILE)) {
      for (const f of old.files) for (const name of [f.name, `${f.name}.blockmap`]) rmSync(join(root, "updates", feed, name), { force: true });
    }
    console.log(`pruned ${old.version}`);
  }
  atomicWrite(join(downloads, "releases.json"), `${JSON.stringify(kept, null, 2)}\n`);
  atomicWrite(join(downloads, "index.html"), indexHtml(kept));
}

function rollback(root, version) {
  const release = readJson(join(root, "downloads", version, "release.json"), null);
  if (!release) fail(`${version} is not on disk`);
  pointAt(root, release);
  const history = readJson(join(root, "downloads", "releases.json"), []);
  const reordered = [release, ...history.filter((r) => r.version !== version)];
  atomicWrite(join(root, "downloads", "releases.json"), `${JSON.stringify(reordered, null, 2)}\n`);
  atomicWrite(join(root, "downloads", "index.html"), indexHtml(reordered));
  console.log(`latest now points at ${version}. Installed newer versions do not downgrade; ship a higher version to replace a bad one.`);
}

function status(root) {
  const current = readJson(join(root, "downloads", "release.json"), null);
  console.log(current ? `latest: ${current.version} (${current.releasedAt})` : "nothing published");
  for (const [feed, file] of Object.entries(FEED_FILE)) {
    const path = join(root, "updates", feed, file);
    if (existsSync(path)) console.log(`feed ${feed}: ${readFileSync(path, "utf8").split("\n")[0]}`);
  }
  for (const r of readJson(join(root, "downloads", "releases.json"), [])) console.log(`on disk: ${r.version} ${r.files.length} files`);
  const latest = join(root, "downloads", "latest");
  if (existsSync(latest) && lstatSync(latest).isSymbolicLink()) console.log(`downloads/latest -> ${readdirSync(latest).length} files`);
}

const [command, ...rest] = process.argv.slice(2);
const opts = options(rest);
const root = opts._[0] && resolve(opts._[0]);
if (!root) fail("usage: publish-release.mjs publish|rollback|status <web-root> ...");
if (command === "publish") await publish(root, resolve(opts._[1] ?? fail("missing <source-dir>")), opts);
else if (command === "rollback") rollback(root, opts._[1] ?? fail("missing <version>"));
else if (command === "status") status(root);
else fail(`unknown command ${command}`);
