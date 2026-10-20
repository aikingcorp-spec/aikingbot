#!/usr/bin/env node
// Copyright (c) 2026 AIKING.
// Builds the static AIKINGBOT website for every locale in site.config.json.
//   node apps/website/build.mjs [--out dir] [--release downloads/release.json] [--origin https://…] [--app-url https://…]
// No dependencies: Node 20+ only. Output is plain HTML/CSS/JS with fingerprinted assets.
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { docsPage, homePage, notFoundPage } from "./render.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const out = resolve(arg("out") ?? join(here, "dist"));

const config = JSON.parse(readFileSync(join(here, "site.config.json"), "utf8"));
config.origin = (arg("origin") ?? process.env.SITE_ORIGIN ?? config.origin).replace(/\/$/, "");
config.appUrl = (arg("app-url") ?? process.env.SITE_APP_URL ?? config.appUrl).replace(/\/$/, "");
const releasePath = arg("release");
const release = releasePath && existsSync(releasePath) ? JSON.parse(readFileSync(releasePath, "utf8")) : null;

// ---- i18n: every locale must define exactly the keys of the default locale.
const dictionaries = Object.fromEntries(config.locales.map((l) => [l.code, JSON.parse(readFileSync(join(here, "i18n", `${l.code}.json`), "utf8"))]));
const shape = (value, prefix = "") => {
  if (Array.isArray(value)) return [`${prefix}[${value.length}]`, ...value.flatMap((v, i) => shape(v, `${prefix}[${i}]`))];
  if (value && typeof value === "object") return Object.entries(value).flatMap(([k, v]) => shape(v, prefix ? `${prefix}.${k}` : k));
  return [prefix];
};
const base = config.locales.find((l) => l.default) ?? config.locales[0];
const reference = new Set(shape(dictionaries[base.code]));
for (const locale of config.locales) {
  const keys = new Set(shape(dictionaries[locale.code]));
  const missing = [...reference].filter((k) => !keys.has(k) && !/^docs\.sections\[\d+\]\.paras/.test(k));
  const extra = [...keys].filter((k) => !reference.has(k) && !/^docs\.sections\[\d+\]\.paras/.test(k));
  if (missing.length || extra.length) throw new Error(`i18n/${locale.code}.json differs from ${base.code}: missing ${missing.join(", ") || "-"}; extra ${extra.join(", ") || "-"}`);
}
const translator = (dictionary, code) => (key) => {
  const value = key.split(".").reduce((node, part) => node?.[part], dictionary);
  if (value === undefined) throw new Error(`Missing translation ${code}:${key}`);
  return value;
};

// ---- assets, fingerprinted so they can be cached forever.
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "assets"), { recursive: true });
const emit = (source, name) => {
  const data = readFileSync(source);
  const hash = createHash("sha256").update(data).digest("hex").slice(0, 10);
  const ext = extname(name);
  const file = `assets/${name.slice(0, -ext.length)}.${hash}${ext}`;
  writeFileSync(join(out, file), data);
  return file;
};
const pngSize = (file) => { const b = readFileSync(file); return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) }; };
const assetDir = join(here, "assets");
const fontVi = emit(join(assetDir, "fonts/inter-vietnamese-wght-normal.woff2"), "inter-vietnamese.woff2");
const fontLatin = emit(join(assetDir, "fonts/inter-latin-wght-normal.woff2"), "inter-latin.woff2");
const fontLatinExt = emit(join(assetDir, "fonts/inter-latin-ext-wght-normal.woff2"), "inter-latin-ext.woff2");
copyFileSync(join(assetDir, "fonts/OFL.txt"), join(out, "assets/inter-OFL.txt"));
const cssSource = readFileSync(join(assetDir, "site.css"), "utf8")
  .replaceAll("FONT_VI", `/${fontVi}`).replaceAll("FONT_LATIN_EXT", `/${fontLatinExt}`).replaceAll("FONT_LATIN", `/${fontLatin}`);
writeFileSync(join(out, "assets/.site.css"), cssSource);
const assets = {
  css: emit(join(out, "assets/.site.css"), "site.css"),
  js: emit(join(assetDir, "site.js"), "site.js"),
  favicon: emit(join(assetDir, "logo.svg"), "logo.svg"),
  touchIcon: emit(join(assetDir, "apple-touch-icon.png"), "apple-touch-icon.png"),
  og: emit(join(assetDir, "og.png"), "og.png"),
  fontVi,
  screens: {},
};
rmSync(join(out, "assets/.site.css"));
for (const key of ["chat", "marketplace", "settings"]) {
  const source = join(assetDir, "screens", `${key}.png`);
  if (existsSync(source)) assets.screens[key] = { file: emit(source, `screen-${key}.png`), ...pngSize(source) };
}
copyFileSync(join(assetDir, "logo.svg"), join(out, "favicon.svg"));

// ---- pages
const pages = [];
for (const locale of config.locales) {
  const ctx = { t: translator(dictionaries[locale.code], locale.code), locale, config, release, assets };
  const dir = join(out, locale.path);
  mkdirSync(join(dir, "docs"), { recursive: true });
  writeFileSync(join(dir, "index.html"), homePage(ctx));
  writeFileSync(join(dir, "docs/index.html"), docsPage(ctx));
  writeFileSync(join(dir, "404.html"), notFoundPage(ctx));
  pages.push(locale.path, `${locale.path}docs/`);
}
const lastmod = new Date().toISOString().slice(0, 10);
const alternates = (path) => config.locales.map((l) => `    <xhtml:link rel="alternate" hreflang="${l.htmlLang}" href="${config.origin}${l.path}${path}"/>`).join("\n");
writeFileSync(join(out, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${pages.map((page) => {
  const path = page.replace(/^\/(en\/)?/, "");
  return `  <url>\n    <loc>${config.origin}${page}</loc>\n    <lastmod>${lastmod}</lastmod>\n${alternates(path)}\n  </url>`;
}).join("\n")}
</urlset>
`);
writeFileSync(join(out, "robots.txt"), `User-agent: *\nAllow: /\nDisallow: /updates/\nSitemap: ${config.origin}/sitemap.xml\n`);
writeFileSync(join(out, "build.json"), `${JSON.stringify({ builtAt: new Date().toISOString(), origin: config.origin, appUrl: config.appUrl, release: release?.version ?? null, locales: config.locales.map((l) => l.code), screens: Object.keys(assets.screens) }, null, 2)}\n`);
console.log(`website: ${pages.length} pages, ${config.locales.length} locales, release ${release?.version ?? "none"} → ${out}`);
const files = readdirSync(join(out, "assets"));
console.log(`assets: ${files.length} files`);
