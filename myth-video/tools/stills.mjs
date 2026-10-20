// Renders single frames for review: node tools/stills.mjs outDir t1 t2 ...
import { start } from './serve.mjs';
import { launch, openFilm } from './browser.mjs';
import fs from 'node:fs';
const [out, ...times] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const { srv, url } = await start(); const b = await launch(); const page = await openFilm(b, url);
console.log(JSON.stringify(await page.evaluate(() => window.FILM.K)));
for (const t of times) {
  await page.evaluate(t => window.renderAt(t), +t);
  await page.screenshot({ path: `${out}/t${String(t).padStart(6, '0')}.jpg`, type: 'jpeg', quality: 80 });
}
await b.close(); srv.close();
