// Render specific timestamps at full size and tile them large. Usage: node tools/keyframes.mjs vertical out.jpg 3 8 12 ...
import { start } from './serve.mjs';
import { launch, openPromo } from './browser.mjs';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const [format, out, ...ts] = process.argv.slice(2);
const { srv, url } = await start(); const b = await launch();
const { page } = await openPromo(b, url, format);
const dir = `review/kf-${format}`; fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
for (const t of ts) { await page.evaluate(x => window.renderAt(x), +t); await page.screenshot({ path: `${dir}/${(+t).toFixed(2).padStart(5, '0')}.png` }); }
await b.close(); srv.close();
execFileSync('python3', ['-c', `
import glob,sys
from PIL import Image, ImageDraw
fs=sorted(glob.glob('${dir}/*.png')); v='${format}'=='vertical'
tw,th=(540,960) if v else (960,540); cols=4 if v else 3
rows=(len(fs)+cols-1)//cols; s=Image.new('RGB',(cols*tw,rows*(th+30)),(25,25,25)); d=ImageDraw.Draw(s)
for i,f in enumerate(fs):
  im=Image.open(f).convert('RGB').resize((tw,th)); x,y=(i%cols)*tw,(i//cols)*(th+30); s.paste(im,(x,y+30)); d.text((x+8,y+8),f.split('/')[-1],fill=(255,255,255))
s.save('${out}',quality=90)`]);
console.log('ok');
