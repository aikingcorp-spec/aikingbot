import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const svg = readFileSync(join(root, "public/app-icon.svg"), "utf8");
for (const [file, size] of [["electron/resources/app-icon.png", 256], ["public/apple-touch-icon.png", 180]]) {
  const target = join(root, file);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng());
}
console.log("Prepared original AIKINGBOT desktop and home-screen icons.");
