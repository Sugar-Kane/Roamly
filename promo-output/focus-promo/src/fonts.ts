// The app's own typefaces (Fraunces, Inter, IBM Plex Mono), loaded from local files before the first frame.
import { continueRender, delayRender, staticFile } from "remotion";

const faces: [string, string, string][] = [
  ["Fraunces", "fonts/Fraunces-normal-latin.woff2", "300 900"],
  ["Fraunces", "fonts/Fraunces-normal-latin-ext.woff2", "300 900"],
  ["Inter", "fonts/Inter-normal-latin.woff2", "100 900"],
  ["IBM Plex Mono", "fonts/IBMPlexMono-400.woff2", "400"],
  ["IBM Plex Mono", "fonts/IBMPlexMono-500.woff2", "500"],
];
const handle = delayRender("fonts");
Promise.all(faces.map(([family, file, weight]) => new FontFace(family, `url(${staticFile(file)}) format("woff2")`, { weight }).load()
  .then((f) => { document.fonts.add(f); })))
  .then(() => continueRender(handle))
  .catch((e) => { console.error(e); continueRender(handle); });

export const DISPLAY = "Fraunces, serif";
export const UI = "Inter, system-ui, sans-serif";
export const MONO = "'IBM Plex Mono', monospace";
