// Exports the SFX cue sheet from the animation timeline (single source of truth for sync).
import { start } from './serve.mjs';
import { launch, openPromo } from './browser.mjs';
import fs from 'node:fs';
const { srv, url } = await start(); const b = await launch();
const { page } = await openPromo(b, url, 'vertical');
const cues = await page.evaluate(() => window.PROMO.cues());
fs.writeFileSync('audio/cues.json', JSON.stringify(cues, null, 1));
console.log('cues', cues.length);
await b.close(); srv.close();
