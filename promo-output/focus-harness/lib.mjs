import { chromium } from "playwright";
export const URL = "http://localhost:5191/promo-output/focus-harness/index.html";
export async function open({ theme = "coffee", width = 1440, height = 900, scale = 2, exams, prefs = {}, clock = false } = {}) {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--autoplay-policy=no-user-gesture-required", "--hide-scrollbars"] });
  const ctx = await b.newContext({ viewport: { width, height }, deviceScaleFactor: scale });
  await ctx.addInitScript(({ theme, exams, prefs }) => {
    window.__theme = theme; if (exams) window.__exams = exams;
    localStorage.setItem("roamly-theme", theme);
    for (const [k, v] of Object.entries(prefs)) localStorage.setItem(k, v);
    // Document PiP isn't available headless: stand in a sized popup so the app's pop-out renders as in Chrome.
    window.documentPictureInPicture = { window: null, requestWindow: async ({ width, height } = {}) => {
      const w = window.open("about:blank", "pip", `popup,width=${width},height=${height}`);
      const base = w.document.createElement("base"); base.href = location.origin + "/"; w.document.head.appendChild(base);
      window.documentPictureInPicture.window = w; return w; } };
  }, { theme, exams, prefs });
  const p = await ctx.newPage();
  if (clock) await p.clock.install();
  p.on("pageerror", (e) => console.log("pageerror:", e.message));
  await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
  await p.goto(URL);
  await p.waitForTimeout(2500);
  return { b, ctx, p };
}
export const shot = (p, name, opts = {}) => p.screenshot({ path: `shots/${name}.png`, ...opts }).then(() => console.log("shot", name));
