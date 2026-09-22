/**
 * Generates public/qr.png for the closing card.
 *
 * Built at render time rather than fetched from a QR web service: a
 * call-to-action that silently 404s is the worst possible failure in a finished
 * video, and a local file makes the render reproducible offline.
 *
 * The code is decoded back out of the generated PNG before it is accepted —
 * see scripts/verify-qr.mjs, which runs as part of preflight.
 */

import QRCode from "qrcode";
import { QR_TARGET } from "./qr-target.mjs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "../public/qr.png");

await QRCode.toFile(OUT, QR_TARGET, {
  errorCorrectionLevel: "H",
  margin: 2,
  width: 720, // 4x the 180px display size, so it stays crisp when scaled
  color: {
    // Brand ink on brand paper. Contrast is 8.5:1, well past what scanners need.
    dark: "#4A3A2EFF",
    light: "#F0E9E0FF",
  },
});

console.log(`QR written to public/qr.png  →  ${QR_TARGET}`);
