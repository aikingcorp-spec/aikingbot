// Copyright (c) 2026 AIKING.
// The AIKINGBOT public site on Cloudflare: the landing page, the documents, the installers and the update feed, all read
// from one R2 bucket. Nothing here runs per visitor except a key lookup, so it stays inside the free plan.
//   site/…        the built website (apps/website)      →  served at /
//   downloads/…   installers, checksums, release.json    →  served at /downloads/…
//   updates/…     the desktop update feed                →  served at /updates/…
const TYPES = {
  html: "text/html; charset=utf-8", css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8", mjs: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8", xml: "application/xml; charset=utf-8", txt: "text/plain; charset=utf-8", yml: "text/yaml; charset=utf-8",
  svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", ico: "image/x-icon",
  woff2: "font/woff2", woff: "font/woff", exe: "application/vnd.microsoft.portable-executable", zip: "application/zip", blockmap: "application/octet-stream",
  appimage: "application/octet-stream", deb: "application/vnd.debian.binary-package", gz: "application/gzip", sha256: "text/plain; charset=utf-8",
};
const SAFE = /^\/[A-Za-z0-9._~!$&'()*+,;=:@%\/-]*$/;

export default {
  async fetch(request, env) {
    if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
    const url = new URL(request.url);
    let path;
    try { path = decodeURIComponent(url.pathname); } catch { return new Response("Bad request", { status: 400 }); }
    if (!SAFE.test(url.pathname) || path.includes("..") || path.includes("\\") || path.includes("\0") || path.includes("//")) return new Response("Bad request", { status: 400 });

    const outside = path.startsWith("/downloads/") || path.startsWith("/updates/");
    const candidates = outside ? [path.endsWith("/") ? `${path.slice(1)}index.html` : path.slice(1)] : path.endsWith("/") ? [`site${path}index.html`] : /\.[A-Za-z0-9]{1,10}$/.test(path) ? [`site${path}`] : [`site${path}`, `site${path}/index.html`];
    for (const key of candidates) {
      const served = await serve(env, request, key, outside);
      if (served) return served;
    }
    return notFound(env, request);
  },
};

async function notFound(env, request) {
  const object = await env.SITE.get("site/404.html");
  return new Response(request.method === "HEAD" ? null : object?.body ?? "Not found", { status: 404, headers: { "content-type": TYPES.html, "cache-control": "no-store", ...security() } });
}
const security = () => ({ "x-content-type-options": "nosniff", "referrer-policy": "strict-origin-when-cross-origin" });

async function serve(env, request, key, outside) {
  const head = await env.SITE.head(key);
  if (!head) return null;
  const extension = (key.split(".").pop() ?? "").toLowerCase();
  const type = TYPES[extension] ?? "application/octet-stream";
  const immutable = key.startsWith("site/assets/");
  const headers = new Headers({
    "content-type": type, etag: head.httpEtag, "accept-ranges": "bytes", ...security(),
    "cache-control": immutable ? "public, max-age=31536000, immutable" : outside ? (extension === "yml" || extension === "json" ? "public, max-age=60" : "public, max-age=3600") : "public, max-age=300",
  });
  if (outside && ["exe", "zip", "appimage", "deb"].includes(extension)) headers.set("content-disposition", `attachment; filename="${key.split("/").pop()}"`);
  if (request.headers.get("if-none-match") === head.httpEtag) return new Response(null, { status: 304, headers });

  const range = parseRange(request.headers.get("range"), head.size);
  if (range === "invalid") { headers.set("content-range", `bytes */${head.size}`); return new Response(null, { status: 416, headers }); }
  if (request.method === "HEAD") { headers.set("content-length", String(head.size)); return new Response(null, { status: 200, headers }); }
  if (range) {
    const object = await env.SITE.get(key, { range: { offset: range.start, length: range.end - range.start + 1 } });
    if (!object) return null;
    headers.set("content-range", `bytes ${range.start}-${range.end}/${head.size}`);
    headers.set("content-length", String(range.end - range.start + 1));
    return new Response(object.body, { status: 206, headers });
  }
  const object = await env.SITE.get(key);
  if (!object) return null;
  headers.set("content-length", String(head.size));
  return new Response(object.body, { status: 200, headers });
}

/** One "bytes=a-b", "bytes=a-" or "bytes=-n" range; anything else is served whole. */
function parseRange(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === "" && match[2] === "")) return null;
  let start, end;
  if (match[1] === "") { const last = Number(match[2]); if (last === 0) return "invalid"; start = Math.max(0, size - last); end = size - 1; }
  else { start = Number(match[1]); end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1); }
  if (!(start <= end) || start >= size) return "invalid";
  return { start, end };
}
