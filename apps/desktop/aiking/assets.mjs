import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const svg = readFileSync(join(root, "public/app-icon.svg"), "utf8");
const png = size => new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng();
for (const [file, size] of [["electron/resources/app-icon.png", 256], ["public/apple-touch-icon.png", 180], ["public/app-icon-192.png", 192], ["public/app-icon-512.png", 512]]) {
  const target = join(root, file);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, png(size));
}
mkdirSync(join(root, "build/icons"), { recursive: true });
writeFileSync(join(root, "build/icon.svg"), svg);
for (const size of [16, 24, 32, 48, 64, 128, 256, 512, 1024]) writeFileSync(join(root, `build/icons/${size}x${size}.png`), png(size));
const windowsPng = png(256); const ico = Buffer.alloc(22);
ico.writeUInt16LE(1, 2); ico.writeUInt16LE(1, 4); ico.writeUInt16LE(1, 10); ico.writeUInt16LE(32, 12); ico.writeUInt32LE(windowsPng.length, 14); ico.writeUInt32LE(22, 18);
writeFileSync(join(root, "build/icon.ico"), Buffer.concat([ico, windowsPng]));
const chunks = [["ic07", 128], ["ic08", 256], ["ic09", 512], ["ic10", 1024]].map(([type, size]) => {
  const data = png(size); const header = Buffer.alloc(8); header.write(type); header.writeUInt32BE(data.length + 8, 4); return Buffer.concat([header, data]);
});
const icns = Buffer.alloc(8); icns.write("icns"); icns.writeUInt32BE(8 + chunks.reduce((size, chunk) => size + chunk.length, 0), 4);
writeFileSync(join(root, "build/icon.icns"), Buffer.concat([icns, ...chunks]));
console.log("Prepared AIKINGBOT desktop, installer and home-screen icons.");
