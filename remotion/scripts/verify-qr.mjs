/**
 * Decodes public/qr.png and asserts it resolves to the exact intended URL.
 *
 * Generating a QR and looking at it is not verification — a wrong payload
 * looks identical to a right one. This decodes the actual rendered pixels,
 * which is the only check that would catch a bad target before a video ships.
 */

import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import jsQR from "jsqr";
import { QR_TARGET } from "./qr-target.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const QR_FILE = resolve(HERE, "../public/qr.png");

const png = PNG.sync.read(await readFile(QR_FILE));
const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);

if (!decoded) {
  console.error("FAIL: public/qr.png could not be decoded at all.");
  process.exit(1);
}
if (decoded.data !== QR_TARGET) {
  console.error(`FAIL: QR decodes to "${decoded.data}", expected "${QR_TARGET}".`);
  process.exit(1);
}

console.log(`QR verified: decodes to ${decoded.data}`);
