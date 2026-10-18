import { open, shot } from "./lib.mjs";
import fs from "node:fs";
const PREFS = { "roamly-companions": "1", "roamly-dnd-nudge-seen": "1", "roamly-focus-sound": "lofi" };
async function enterFocus(opts = {}) {
  const s = await open({ clock: true, prefs: PREFS, ...opts });
  await s.p.getByRole("button", { name: /^Start/ }).first().click();
  await s.p.clock.runFor(1500);
  return s;
}
async function frames(p, dir, n, fps = 30) {
  fs.mkdirSync(`frames/${dir}`, { recursive: true });
  for (let i = 0; i < n; i++) {
    await p.clock.runFor(1000 / fps);
    await p.screenshot({ path: `frames/${dir}/${String(i).padStart(4, "0")}.jpg`, type: "jpeg", quality: 92 });
  }
  console.log("frames", dir, n);
}
const only = process.argv[2];
if (!only || only === "focus") {
  const { b, p } = await enterFocus();
  await p.clock.runFor(16000);
  await frames(p, "focus", 300);
  // Customize Session drawer: pets on → off
  await p.getByTestId("focus-overlay").getByRole("button", { name: "Customize Session" }).first().click(); await p.clock.runFor(600);
  await shot(p, "f1-customize-on");
  await p.getByLabel("Show pets during focus", { exact: true }).click(); await p.clock.runFor(400);
  await shot(p, "f2-customize-pets-off");
  await p.getByLabel("Show garden during focus", { exact: true }).click(); await p.clock.runFor(400);
  await shot(p, "f3-customize-both-off");
  await p.keyboard.press("Escape"); await p.clock.runFor(600);
  await shot(p, "f4-focus-clean");
  // Music: Apple Music tab
  await p.getByTestId("focus-overlay").getByRole("button", { name: "Customize Session" }).first().click(); await p.clock.runFor(400);
  await p.getByLabel("Show pets during focus", { exact: true }).click(); await p.getByLabel("Show garden during focus", { exact: true }).click();
  await p.keyboard.press("Escape"); await p.clock.runFor(600);
  await p.getByTestId("focus-overlay").getByRole("button", { name: "Apple Music" }).first().click(); await p.clock.runFor(500);
  await shot(p, "g1-apple-music");
  await p.getByTestId("focus-overlay").getByRole("button", { name: "Spotify" }).first().click(); await p.clock.runFor(500);
  await shot(p, "g2-spotify");
  await b.close();
}
if (!only || only === "pip") {
  const { b, ctx, p } = await open({ prefs: PREFS });
  await p.getByRole("button", { name: /^Start/ }).first().click(); await p.waitForTimeout(1500);
  const popup = ctx.waitForEvent("page");
  await p.getByTestId("focus-overlay").getByRole("button", { name: /Pop out timer/ }).first().click();
  const w = await popup;
  await w.setViewportSize({ width: 180, height: 203 }); await w.waitForTimeout(2500);
  const q = await (await b.newContext({ viewport: { width: 180, height: 203 }, deviceScaleFactor: 3 })).newPage();
  await q.goto("http://localhost:5191/promo-output/focus-harness/blank.html");
  for (let i = 0; i < 4; i++) {
    const t0 = Date.now();
    const html = await w.evaluate(() => [document.documentElement.getAttribute("style"), document.documentElement.className, document.head.innerHTML, document.body.innerHTML]);
    await q.evaluate(([st, cls, head, body]) => { document.documentElement.setAttribute("style", st || ""); document.documentElement.className = cls; document.head.innerHTML = head; document.body.innerHTML = body; }, html);
    await q.evaluate(() => document.fonts.ready); await q.waitForTimeout(300);
    await q.screenshot({ path: `shots/h1-pip-${i}.png` }); console.log("shot h1-pip-" + i);
    await p.waitForTimeout(Math.max(0, 1000 - (Date.now() - t0)));
  }
  await shot(p, "h0-main-with-pip");
  await b.close();
}
if (!only || only === "themes") {
  for (const t of ["coffee", "whitecoat", "library", "nightshift", "deepsea", "sage", "sunset", "ocean"]) {
    const { b, p } = await enterFocus({ theme: t });
    await p.clock.runFor(20000);
    await shot(p, `t-${t}`);
    await b.close();
  }
  const { b, p } = await open({ prefs: PREFS });
  await p.getByRole("button", { name: "Change theme" }).click(); await p.waitForTimeout(400);
  await shot(p, "t0-theme-menu");
  await b.close();
}
