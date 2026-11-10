import { open, shot } from "./lib.mjs";
const { b, p } = await open({ prefs: { "roamly-companions": "1", "roamly-dnd-nudge-seen": "1", "roamly-focus-sound": "lofi" } });
await p.getByRole("button", { name: /Select timer/ }).click(); await p.waitForTimeout(400);
await p.getByRole("button", { name: /Count-up timer/ }).click(); await p.waitForTimeout(500);
await p.getByRole("button", { name: /Select timer/ }).evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + scrollY - 40));
await p.waitForTimeout(300);
await p.evaluate(() => { const real = Date.now.bind(Date); window.__off = 0; Date.now = () => real() + window.__off; });
await p.getByRole("button", { name: "Start count-up timer" }).click();
await p.evaluate(() => { window.__off = 47 * 60 * 1000 + 11500; });
await p.waitForTimeout(1100);
for (let i = 0; i < 3; i++) { await shot(p, `d5-countup-${i}`); await p.evaluate(() => { window.__off += 1000; }); await p.waitForTimeout(1000 - 0); }
await b.close();
