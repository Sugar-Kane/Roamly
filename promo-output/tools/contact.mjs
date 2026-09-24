// Contact sheet: one frame every STEP seconds, labelled, tiled. Usage: node tools/contact.mjs vertical [step] [from] [to]
import { start } from './serve.mjs';
import { launch, openPromo } from './browser.mjs';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const [format = 'vertical', step = '0.5', from = '0', to = '60', tag = ''] = process.argv.slice(2);
const { srv, url } = await start();
const b = await launch();
const { page } = await openPromo(b, url, format);
const dir = `review/frames-${format}${tag}`; fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
const times = []; for (let t = +from; t < +to - 1e-6; t += +step) times.push(+t.toFixed(3));
for (const t of times) { await page.evaluate(x => window.renderAt(x), t); await page.screenshot({ path: `${dir}/${t.toFixed(2).padStart(5, '0')}.png`, type: 'png' }); }
await b.close(); srv.close();
execFileSync('python3', ['tools/sheet.py', dir, `review/contact-${format}${tag}.jpg`, format], { stdio: 'inherit' });
