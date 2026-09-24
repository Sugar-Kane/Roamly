// Screenshots the production AI-upload panel: idle, uploading, reading, done.
// /api/generate-tasks is answered locally with SAMPLE output (no Anthropic key here): see ../ref/product-notes.md.
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url)), REF = path.resolve(HERE, '../ref');
const SAMPLE = JSON.parse(fs.readFileSync(path.join(HERE, 'sample-ai-tasks.json'), 'utf8'));
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
for (const [w, h, tag] of [[390, 844, 'mobile'], [1100, 800, 'desktop']]) {
  const p = await (await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 })).newPage();
  let release; const gate = new Promise(r => (release = r));
  await p.route('**/api/generate-tasks', async route => { await gate; await route.fulfill({ json: { tasks: SAMPLE.tasks.map((t, i) => ({ id: `t${i}`, ...t })), processingMode: 'native_text' } }); });
  await p.goto('http://localhost:5190/promo-output/room-harness/upload.html', { waitUntil: 'networkidle' }); await p.waitForTimeout(800);
  await p.screenshot({ path: `${REF}/40-upload-idle-${tag}.png` });
  await p.locator('input[type=file]').first().setInputFiles({ name: 'Lecture-12-Heart-Failure.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 sample') });
  await p.waitForTimeout(250); await p.screenshot({ path: `${REF}/41-upload-reading-${tag}.png` });
  await p.waitForTimeout(2200); await p.screenshot({ path: `${REF}/41b-upload-reading-later-${tag}.png` });
  release(); await p.waitForTimeout(800);
  await p.screenshot({ path: `${REF}/42-upload-done-${tag}.png` });
  fs.writeFileSync(`${REF}/upload-dom-${tag}.txt`, await p.innerText('main'));
}
await b.close(); console.log('ok');
