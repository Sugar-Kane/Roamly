import { chromium } from 'playwright';
export async function launch() {
  return chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', args: ['--disable-gpu-vsync', '--force-color-profile=srgb', '--font-render-hinting=none', '--hide-scrollbars'] });
}
export async function openFilm(browser, base) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on('pageerror', e => console.error('PAGEERROR', e.message));
  page.on('console', m => { if (m.type() === 'error') console.error('CONSOLE', m.text()); });
  await page.goto(`${base}/src/index.html?render=1`);
  await page.evaluate(() => window.FILM.ready);
  return page;
}
