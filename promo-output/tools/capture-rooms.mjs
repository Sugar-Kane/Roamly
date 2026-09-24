// Captures the real in-room (group session) screens for the Rooms beat.
// Needs a test account in the environment: ROAMLY_TEST_EMAIL, ROAMLY_TEST_PASSWORD (never printed or saved).
// Usage: node tools/capture-rooms.mjs   → ref/30-room-*.png + ref/rooms-dom.txt
import { chromium } from 'playwright';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
const email = process.env.ROAMLY_TEST_EMAIL, password = process.env.ROAMLY_TEST_PASSWORD;
if (!email || !password) { console.error('ROAMLY_TEST_EMAIL / ROAMLY_TEST_PASSWORD not set'); process.exit(1); }
// In the sandbox, HTTPS goes through a re-terminating proxy: trust exactly its CA key (by SPKI hash), nothing else.
const CA = '/root/.ccr/agent-proxy-ca.crt';
const args = process.env.HTTPS_PROXY && fs.existsSync(CA)
  ? ['--ignore-certificate-errors-spki-list=' + execSync(`openssl x509 -in ${CA} -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | base64`).toString().trim()]
  : [];
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', args, proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined });
const dom = [];
for (const [w, h, tag] of [[390, 844, 'mobile'], [1440, 900, 'desktop']]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  const p = await ctx.newPage(); await p.clock.install();
  await p.goto('https://www.roamlyflow.com/focus', { waitUntil: 'networkidle' }); await p.waitForTimeout(2000);
  await p.getByRole('button', { name: 'Sign in' }).first().click(); await p.waitForTimeout(1200);
  await p.locator('input[type=email]').first().fill(email);
  await p.locator('input[type=password]').first().fill(password);
  await p.locator('input[type=password]').first().press('Enter'); await p.waitForTimeout(4000);
  await p.getByRole('button', { name: 'Rooms', exact: true }).last().click(); await p.waitForTimeout(3000);
  await p.screenshot({ path: `ref/30-room-list-${tag}.png` });
  await p.getByText('PANCE Grind (Quiet)').click(); await p.waitForTimeout(1500);
  const join = p.getByRole('button', { name: /Join/ }).first(); if (await join.count()) { await join.click(); await p.waitForTimeout(4000); }
  await p.screenshot({ path: `ref/31-room-focus-${tag}.png` }); await p.screenshot({ path: `ref/31-room-focus-${tag}-full.png`, fullPage: true });
  dom.push(`--- ${tag} focus ---\n` + (await p.innerText('body')).slice(0, 4000));
  // advance the shared clock to the room's break (the room phase is wall-clock math)
  for (let i = 0; i < 8; i++) { await p.clock.fastForward('05:00'); await p.waitForTimeout(800); if (/break/i.test(await p.innerText('body'))) break; }
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `ref/32-room-break-${tag}.png` }); await p.screenshot({ path: `ref/32-room-break-${tag}-full.png`, fullPage: true });
  dom.push(`--- ${tag} break ---\n` + (await p.innerText('body')).slice(0, 4000));
  const leave = p.getByRole('button', { name: /Leave/ }).first(); if (await leave.count()) await leave.click();
  await ctx.close();
}
fs.writeFileSync('ref/rooms-dom.txt', dom.join('\n\n'));
await b.close(); console.log('captured room screens');
