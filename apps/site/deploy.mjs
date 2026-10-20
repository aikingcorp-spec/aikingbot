// Copyright (c) 2026 AIKING.
// Publishes the public site to Cloudflare: builds the website, copies it (and, on request, the installers and the update
// feed) into the R2 bucket, then uploads the Worker that serves the bucket. Credentials come from the environment and are
// never printed:  CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID.
//   node deploy.mjs --site-url https://… --app-url https://… [--downloads <web>/downloads --updates <web>/updates]
//                   [--domain www.example.com] [--name aikingbot-site] [--bucket aikingbot-staging-sites] [--status-path /__relay/health]
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cloudflare } from "../../scripts/cloudflare.mjs";

const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const token = process.env.CLOUDFLARE_API_TOKEN, account = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!token || !account) throw new Error("CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required");
const name = option("name", "aikingbot-site"), bucket = option("bucket", "aikingbot-staging-sites");
const siteUrl = option("site-url"), appUrl = option("app-url"), downloads = option("downloads"), updates = option("updates");
if (!siteUrl || !appUrl) throw new Error("--site-url and --app-url are required");
const here = fileURLToPath(new URL(".", import.meta.url));

const api = async (path, init = {}) => {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });
  const payload = await response.json().catch(() => ({}));
  if (!payload.success) throw new Error(`${init.method ?? "GET"} ${path}: ${JSON.stringify(payload.errors ?? payload).slice(0, 300)}`);
  return payload.result;
};
// R2's S3 endpoint accepts the API token as a key pair: the token's id, and the SHA-256 of its value.
const tokenId = (await api("/user/tokens/verify")).id;
const rcloneEnv = {
  ...process.env, RCLONE_CONFIG: "/dev/null", RCLONE_CONFIG_R2_TYPE: "s3", RCLONE_CONFIG_R2_PROVIDER: "Cloudflare",
  RCLONE_CONFIG_R2_ENDPOINT: `https://${account}.r2.cloudflarestorage.com`, RCLONE_CONFIG_R2_ACCESS_KEY_ID: tokenId,
  RCLONE_CONFIG_R2_SECRET_ACCESS_KEY: createHash("sha256").update(token).digest("hex"),
};
const rclone = (...rest) => execFileSync("rclone", [...rest, "--checksum", "--no-update-modtime", "--s3-no-check-bucket"], { env: rcloneEnv, stdio: ["ignore", "inherit", "inherit"] });

const work = mkdtempSync(join(tmpdir(), "aikingbot-site-"));
try {
  const releaseJson = downloads ? join(downloads, "release.json") : undefined;
  execFileSync(process.execPath, [join(here, "website/build.mjs"), "--out", join(work, "site"), "--origin", siteUrl, "--app-url", appUrl,
    "--status-path", option("status-path", "/__relay/health"), "--no-github", ...(releaseJson ? ["--release", releaseJson] : [])], { stdio: ["ignore", "inherit", "inherit"] });
  rclone("sync", join(work, "site"), `r2:${bucket}/site`);
  if (downloads) {
    const release = JSON.parse(readFileSync(releaseJson, "utf8"));
    const folders = [...new Set(release.files.map((file) => file.url.split("/")[2]))];
    for (const folder of folders) rclone("copy", join(downloads, folder), `r2:${bucket}/downloads/${folder}`);
    for (const file of ["release.json", "SHA256SUMS", "index.html"]) rclone("copyto", join(downloads, file), `r2:${bucket}/downloads/${file}`);
  }
  // The update feed names the installer relative to itself, so the installer is copied next to it.
  if (updates) rclone("copy", updates, `r2:${bucket}/updates`);

  const form = new FormData();
  form.set("metadata", new Blob([JSON.stringify({ main_module: "worker.mjs", compatibility_date: "2026-08-01", bindings: [{ type: "r2_bucket", name: "SITE", bucket_name: bucket }] })], { type: "application/json" }));
  form.set("worker.mjs", new Blob([readFileSync(join(here, "worker.mjs"))], { type: "application/javascript+module" }), "worker.mjs");
  await api(`/accounts/${account}/workers/scripts/${name}`, { method: "PUT", body: form });
  await api(`/accounts/${account}/workers/scripts/${name}/subdomain`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: true, previews_enabled: false }) });
  const subdomain = (await api(`/accounts/${account}/workers/subdomain`)).subdomain;
  console.log(`deployed https://${name}.${subdomain}.workers.dev`);
  const domain = option("domain");
  if (domain) { const attached = await cloudflare({ token, account }).attachDomain(name, domain); console.log(`serving https://${attached.hostname} (zone ${attached.zone})`); }
} finally { rmSync(work, { recursive: true, force: true }); }
