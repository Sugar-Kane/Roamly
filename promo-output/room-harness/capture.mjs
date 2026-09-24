// Screenshots the production RoomsLive UI (served by the harness) in focus and break states.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const REF = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../ref');
const BASE = 'http://localhost:5190/promo-output/room-harness/index.html';
const started = Date.parse('2026-07-02T21:50:59.768Z'), cycle = 190 * 60e3; // Deep Work Hall: 3×50 + 2×10 + 20
const k = Math.ceil((Date.parse('2026-10-08T02:00:00Z') - started) / cycle);
const at = min => new Date(started + k * cycle + min * 60e3);
const FOCUS = at(110 - 31.2), BREAK = at(110 + 2.55);          // block 2: 31:12 left / short break 7:27 left
const members = ['alex', 'maya.r', 'devin', 'sofia_l', 'theo', 'priya', 'jordan.k', 'sam'];
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const dom = [];
for (const [w, h, tag] of [[390, 844, 'mobile'], [1100, 900, 'desktop']]) {
  for (const [when, name] of [[FOCUS, 'focus'], [BREAK, 'break']]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    p.on('pageerror', e => console.log('PAGEERROR', e.message.slice(0, 160)));
    await ctx.addInitScript(({ members, msgs }) => { window.__members = members; window.__messages = msgs; localStorage.setItem('roamly-rooms-howto-seen', '1'); },
      { members, msgs: name === 'break' ? [
        { user_id: 'u1', body: 'block 2 done. heart failure makes sense now lol', created_at: new Date(BREAK.getTime() - 120e3).toISOString() },
        { user_id: 'u3', body: 'same. stretching then pharm cards', created_at: new Date(BREAK.getTime() - 80e3).toISOString() },
        { user_id: 'u5', body: 'see you all next block', created_at: new Date(BREAK.getTime() - 30e3).toISOString() },
      ] : [] });
    await p.clock.install({ time: when });
    await p.goto(BASE, { waitUntil: 'networkidle' }); await p.waitForTimeout(1500);
    if (name === 'focus' && tag === 'mobile') await p.screenshot({ path: `${REF}/30-room-lobby-${tag}.png`, fullPage: true });
    const card = p.locator('div,article,li').filter({ hasText: 'Deep Work Hall' }).filter({ has: p.getByRole('button', { name: 'Join', exact: true }) }).last();
    await card.getByRole('button', { name: 'Join', exact: true }).click(); await p.waitForTimeout(300);

    await p.clock.runFor(2500); await p.waitForTimeout(800);
    await p.screenshot({ path: `${REF}/31-room-${name}-${tag}.png` });
    await p.screenshot({ path: `${REF}/31-room-${name}-${tag}-full.png`, fullPage: true });
    dom.push(`--- ${tag} ${name} ---\n` + (await p.innerText('main')).slice(0, 2500));
    await ctx.close();
  }
}
fs.writeFileSync(`${REF}/rooms-dom.txt`, dom.join('\n\n'));
await b.close(); console.log('ok');
