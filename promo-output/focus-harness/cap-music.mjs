import { open, shot } from "./lib.mjs";
const { b, p } = await open({ prefs: { "roamly-companions": "1", "roamly-dnd-nudge-seen": "1", "roamly-focus-sound": "lofi" } });
const hideDock = () => p.evaluate(() => {
  for (const el of document.querySelectorAll("body *")) {
    if (getComputedStyle(el).position === "fixed" && el.querySelector("iframe")) el.style.visibility = "hidden";
  }
});
const music = p.getByRole("heading", { name: "Music" }).first();
await music.evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + scrollY - 60));
await p.waitForTimeout(400);
await p.getByRole("button", { name: /Café music/ }).first().click(); await p.waitForTimeout(800);
await shot(p, "m1-focus-sounds");
await p.getByRole("button", { name: "Spotify", exact: true }).first().click(); await p.waitForTimeout(800); await hideDock();
await p.mouse.wheel(0, 350); await p.waitForTimeout(500); await hideDock();
await shot(p, "m2-spotify");
await p.getByRole("button", { name: "Apple Music", exact: true }).first().click(); await p.waitForTimeout(800); await hideDock();
await shot(p, "m3-apple");
await b.close();
