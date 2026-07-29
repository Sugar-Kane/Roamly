/**
 * The three brand typefaces, served from public/fonts/ rather than fetched
 * from Google at frame time.
 *
 * @remotion/google-fonts pulls every weight and subset over the network during
 * the render — hundreds of requests per composition — and if one fails the
 * frame silently falls back to a system face, producing a subtly wrong video
 * instead of an error. Vendored files make the render deterministic and let it
 * run with no outbound access at all.
 *
 * Re-vendor with: node scripts/fetch-fonts.mjs
 */

import { continueRender, delayRender, staticFile } from "remotion";

export const fonts = {
  /** Display / headlines */
  fraunces: "Fraunces",
  /** Body and UI */
  inter: "Inter",
  /** Timer digits and numerals */
  mono: "IBM Plex Mono",
};

/**
 * Injects the generated @font-face rules and holds the render until the faces
 * the video actually draws with are ready. Without the delayRender handle,
 * early frames can rasterise against a fallback face.
 */
let installed = false;

export const installFonts = () => {
  if (installed || typeof document === "undefined") return;
  installed = true;

  const handle = delayRender("Loading vendored brand fonts");

  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = staticFile("fonts/fonts.css");
  document.head.appendChild(link);

  link.onload = () => {
    // The stylesheet being parsed is not the same as the faces being usable;
    // load() forces the ones the scenes draw with.
    Promise.all([
      document.fonts.load('500 72px "Fraunces"'),
      document.fonts.load('600 72px "Fraunces"'),
      document.fonts.load('400 40px "Inter"'),
      document.fonts.load('500 40px "Inter"'),
      document.fonts.load('600 40px "Inter"'),
      document.fonts.load('500 92px "IBM Plex Mono"'),
    ])
      .then(() => document.fonts.ready)
      .then(() => continueRender(handle))
      .catch(() => continueRender(handle));
  };

  link.onerror = () => continueRender(handle);
};
