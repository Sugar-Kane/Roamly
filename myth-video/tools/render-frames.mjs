// Deterministic render: step renderAt(t) in exact 1/FPS increments, capture every frame losslessly over CDP,
// pipe the PNGs into ffmpeg/libx264 (nothing is screen-recorded), then mux the mastered audio.
// Usage: node tools/render-frames.mjs [workers] [fromSec] [toSec]
import { start } from './serve.mjs';
import { launch, openFilm } from './browser.mjs';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
const FF = process.env.FFMPEG || execFileSync('python3', ['-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())']).toString().trim();
const FPS = 30, DUR = 106;
const [workersArg = '4', fromArg = '0', toArg = String(DUR)] = process.argv.slice(2);
const F0 = Math.round(+fromArg * FPS), F1 = Math.round(+toArg * FPS), workers = +workersArg;
const tmp = 'render'; fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp, { recursive: true });
const { srv, url } = await start();
const per = Math.ceil((F1 - F0) / workers);
const t0 = Date.now();
async function worker(w) {
  const a = F0 + w * per, b = Math.min(F1, a + per); if (a >= b) return null;
  const browser = await launch();
  const page = await openFilm(browser, url);
  const cdp = await page.context().newCDPSession(page);
  const out = `${tmp}/seg${w}.mp4`;
  const ff = spawn(FF, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-tune', 'grain', '-maxrate', '14M', '-bufsize', '28M', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-r', String(FPS), '-g', '60',
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', out], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((res, rej) => ff.on('close', c => (c === 0 ? res() : rej(new Error('ffmpeg ' + c)))));
  for (let f = a; f < b; f++) {
    await page.evaluate(t => window.renderAt(t), f / FPS);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true, clip: { x: 0, y: 0, width: 1920, height: 1080, scale: 1 } });
    const png = Buffer.from(data, 'base64');
    if (!ff.stdin.write(png)) await new Promise(r => ff.stdin.once('drain', r));
    if (w === 0 && (f - a) % 150 === 0) console.log(`w0 ${f - a}/${b - a} frames, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  ff.stdin.end(); await done; await browser.close();
  return out;
}
const segs = (await Promise.all(Array.from({ length: workers }, (_, w) => worker(w)))).filter(Boolean);
srv.close();
fs.writeFileSync(`${tmp}/list.txt`, segs.map(s => `file '${s.split('/').pop()}'`).join('\n'));
const video = `${tmp}/video.mp4`;
execFileSync(FF, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', `${tmp}/list.txt`, '-c', 'copy', video]);
if (F0 === 0 && F1 === DUR * FPS) {
  const name = 'before-olympus.mp4';
  execFileSync(FF, ['-hide_banner', '-loglevel', 'error', '-y', '-i', video, '-i', 'audio/mix.wav', '-map', '0:v', '-map', '1:a', '-c:v', 'copy',
    '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-ac', '2', '-t', String(DUR), '-movflags', '+faststart',
    '-metadata', 'title=Before Olympus', name]);
  console.log('wrote', name, `in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
} else console.log('partial render at', video);
