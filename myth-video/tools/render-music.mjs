// Renders tools/music.html (Tone.js, offline) to audio/music.wav, scored to the film's own cue sheet.
import { start } from './serve.mjs';
import { launch, openFilm } from './browser.mjs';
import fs from 'node:fs';
const { srv, url } = await start(); const b = await launch();
const film = await openFilm(b, url);
const { cues, duration } = await film.evaluate(() => ({ cues: { ...window.FILM.cues, K: window.FILM.K }, duration: window.FILM.duration }));
fs.mkdirSync('audio', { recursive: true });
fs.writeFileSync('audio/cues.json', JSON.stringify({ duration, ...cues }, null, 1));
const page = await b.newPage();
page.on('pageerror', e => console.error('PAGEERROR', e.message));
await page.goto(`${url}/tools/music.html`);
const b64 = await page.evaluate(([c, d]) => window.renderMusic(c, d), [cues, duration]);
fs.writeFileSync('audio/music.wav', Buffer.from(b64, 'base64'));
console.log('wrote audio/music.wav', fs.statSync('audio/music.wav').size);
await b.close(); srv.close();
