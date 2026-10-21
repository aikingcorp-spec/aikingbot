// Copyright (c) 2026 AIKING.
// Puts the web app's own files (the `assets` folder of a build) in the R2 bucket the relay serves them from, each in three forms:
// plain, brotli and gzip. File names carry a hash of their content, so files of every version can sit side by side and a
// version that is not published here is simply served by the person's computer as before.
//   node publish-webui.mjs --ui <folder that holds assets/>  [--bucket aikingbot-staging-sites]
// Credentials come from the environment and are never printed: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const ui = option("ui"), bucket = option("bucket", "aikingbot-staging-sites");
const token = process.env.CLOUDFLARE_API_TOKEN, account = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!ui || !token || !account) { console.error("usage: node publish-webui.mjs --ui <folder with assets/>  (needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID)"); process.exit(2); }
const source = join(ui, "assets");
const COMPRESSIBLE = /\.(js|mjs|css|json|map|svg|txt|wasm)$/i, SERVED_NAME = /^[A-Za-z0-9._-]{1,200}$/;

const tokenId = (await (await fetch("https://api.cloudflare.com/client/v4/user/tokens/verify", { headers: { authorization: `Bearer ${token}` } })).json()).result?.id;
if (!tokenId) throw new Error("the token was not accepted");
const env = { ...process.env, RCLONE_CONFIG: "/dev/null", RCLONE_CONFIG_R2_TYPE: "s3", RCLONE_CONFIG_R2_PROVIDER: "Cloudflare",
  RCLONE_CONFIG_R2_ENDPOINT: `https://${account}.r2.cloudflarestorage.com`, RCLONE_CONFIG_R2_ACCESS_KEY_ID: tokenId,
  RCLONE_CONFIG_R2_SECRET_ACCESS_KEY: createHash("sha256").update(token).digest("hex") };

const work = mkdtempSync(join(tmpdir(), "webui-"));
try {
  const out = join(work, "assets"); mkdirSync(out, { recursive: true });
  let files = 0, plain = 0, compressed = 0, skipped = 0;
  for (const name of readdirSync(source)) {
    const path = join(source, name);
    if (!statSync(path).isFile() || !SERVED_NAME.test(name)) { skipped += 1; continue; }
    const data = readFileSync(path); files += 1; plain += data.length;
    writeFileSync(join(out, name), data);
    if (COMPRESSIBLE.test(name)) {
      const br = brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: data.length } });
      const gz = gzipSync(data, { level: 9 });
      writeFileSync(join(out, `${name}.br`), br); writeFileSync(join(out, `${name}.gz`), gz); compressed += br.length;
    }
  }
  execFileSync("rclone", ["copy", work, `r2:${bucket}/webui`, "--checksum", "--no-update-modtime", "--s3-no-check-bucket", "--transfers", "8"], { env, stdio: ["ignore", "inherit", "inherit"] });
  console.log(`published ${files} files (${(plain / 1048576).toFixed(1)} MB plain, text files ${(compressed / 1048576).toFixed(1)} MB as brotli)${skipped ? `, ${skipped} skipped` : ""}`);
} finally { rmSync(work, { recursive: true, force: true }); }
