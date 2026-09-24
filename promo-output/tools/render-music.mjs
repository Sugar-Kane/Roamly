// Renders tools/music.html (Tone.js, offline) to audio/music.wav — deterministic, no real-time playback.
import { start } from './serve.mjs';
import { launch } from './browser.mjs';
import fs from 'node:fs';
const { srv, url } = await start(); const b = await launch();
const page = await b.newPage();
page.on('console', m => console.log('page:', m.text()));
page.on('pageerror', e => console.error('PAGEERROR', e.message));
await page.goto(`${url}/tools/music.html`);
const b64 = await page.evaluate(() => window.renderMusic());
fs.mkdirSync('audio', { recursive: true });
fs.writeFileSync('audio/music.wav', Buffer.from(b64, 'base64'));
console.log('wrote audio/music.wav', fs.statSync('audio/music.wav').size);
await b.close(); srv.close();
