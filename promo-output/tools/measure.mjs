import { start } from './serve.mjs';
import { launch, openPromo } from './browser.mjs';
const { srv, url } = await start(); const b = await launch();
const { page } = await openPromo(b, url, process.argv[2] || 'vertical');
console.log(await page.evaluate(() => { const out = {}; for (const c of document.querySelectorAll('.appcard')) { out[c.className + '#' + Object.keys(out).length] = [c.offsetWidth, c.offsetHeight, [...c.children].map(k => (k.className || k.tagName) + ':' + k.offsetHeight).join(' | ')]; } return out; }));
await b.close(); srv.close();
