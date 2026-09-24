import { chromium } from 'playwright';
export async function launch() {
  return chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', args: ['--disable-gpu-vsync', '--force-color-profile=srgb', '--font-render-hinting=none', '--hide-scrollbars'] });
}
export async function openPromo(browser, base, format) {
  const W = format === 'wide' ? 1920 : 1080, H = format === 'wide' ? 1080 : 1920;
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  page.on('pageerror', e => console.error('PAGEERROR', e.message));
  page.on('console', m => { if (m.type() === 'error') console.error('CONSOLE', m.text()); });
  await page.goto(`${base}/src/index.html?format=${format}&render=1`);
  await page.evaluate(() => window.PROMO.ready);
  return { page, W, H };
}
