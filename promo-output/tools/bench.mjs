import { start } from './serve.mjs';
import { launch, openPromo } from './browser.mjs';
const { srv, url } = await start(); const b = await launch();
const { page, W, H } = await openPromo(b, url, process.argv[2] || 'vertical');
const cdp = await page.context().newCDPSession(page);
for (const mode of ['render-only', 'pw-png', 'cdp-png-fast', 'cdp-jpeg95']) {
  const t0 = Date.now();
  for (let f = 0; f < 20; f++) {
    await page.evaluate(t => window.renderAt(t), 26 + f / 60);
    if (mode === 'pw-png') await page.screenshot({ type: 'png' });
    if (mode === 'cdp-png-fast') await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true });
    if (mode === 'cdp-jpeg95') await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 95, optimizeForSpeed: true });
  }
  console.log(mode, ((Date.now() - t0) / 20).toFixed(0), 'ms/frame');
}
await b.close(); srv.close();
