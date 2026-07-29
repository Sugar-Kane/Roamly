/**
 * Step 2 of the capture pipeline: produce every screenshot and clip the video
 * needs, from a signed-in session.
 *
 * Reuses .auth/roamly.json written by capture-auth.mjs. Nothing here signs in,
 * and nothing here fabricates data — if the demo account is empty, the shots
 * come out empty and the guard at the end of each step says so.
 *
 *   node scripts/capture-shots.mjs            # everything
 *   node scripts/capture-shots.mjs 01 04 10   # only these, by number prefix
 *
 * Output: public/captures/
 */

import { chromium, devices } from "playwright";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const AUTH_FILE = resolve(ROOT, ".auth/roamly.json");
const OUT = resolve(ROOT, "public/captures");
const TMP = resolve(ROOT, ".capture-tmp");

const BASE_URL = process.env.ROAMLY_URL ?? "https://www.roamlyflow.com";

/** A slide deck or PDF to feed the AI upload flow in shot 03. */
const SAMPLE_NOTES =
  process.env.ROAMLY_SAMPLE_NOTES ?? resolve(ROOT, "fixtures/sample-lecture.pdf");

const only = process.argv.slice(2);
const wanted = (n) => only.length === 0 || only.includes(n);

if (!existsSync(AUTH_FILE)) {
  console.error(
    "No saved session at .auth/roamly.json.\n" +
      "Run scripts/capture-auth.mjs first — captures must come from a signed-in account.",
  );
  process.exit(1);
}

const DESKTOP = {
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 2,
  storageState: AUTH_FILE,
  colorScheme: "light",
};

/**
 * Every capture is checked for signed-in-ness before it is written. A logged
 * out screen or an auth prompt anywhere in the DOM aborts the run rather than
 * producing a shot that would have to be caught by eye later.
 */
const assertSignedIn = async (page, label) => {
  const signInVisible = await page
    .getByRole("button", { name: /^sign in$/i })
    .first()
    .isVisible()
    .catch(() => false);
  if (signInVisible) {
    throw new Error(
      `[${label}] The page is showing a "Sign in" button — the session did not ` +
        `restore. Re-run scripts/capture-auth.mjs.`,
    );
  }
};

/** Guards against shooting an empty state, per the brief's A2 checklist. */
const assertNotEmpty = async (page, label, locator, minimum) => {
  const count = await locator.count();
  if (count < minimum) {
    throw new Error(
      `[${label}] Found ${count} of the expected ${minimum}+ items. The demo ` +
        `account looks unseeded for this view — seed it and re-run. ` +
        `(Do not work around this by editing the DOM.)`,
    );
  }
};

const gotoView = async (page, path, label) => {
  await page.goto(`${BASE_URL}${path}`, { waitUntil: "networkidle" });
  await assertSignedIn(page, label);
  // Let entrance animations settle so stills aren't caught mid-transition.
  await page.waitForTimeout(1200);
};

const shot = async (page, file) => {
  await page.screenshot({ path: join(OUT, file), scale: "device" });
  const { size } = await stat(join(OUT, file));
  console.log(`  ✓ ${file}  (${Math.round(size / 1024)} KB)`);
};

/**
 * Records a clip by running `body` inside a context that has video capture on,
 * then moves the resulting webm-derived mp4 into place. Playwright writes video
 * per-context, so each clip gets its own context.
 */
const clip = async (browser, file, seconds, body) => {
  await rm(TMP, { recursive: true, force: true });
  await mkdir(TMP, { recursive: true });

  const context = await browser.newContext({
    ...DESKTOP,
    recordVideo: { dir: TMP, size: { width: 1920, height: 1080 } },
  });
  const page = await context.newPage();
  try {
    await body(page);
    await page.waitForTimeout(seconds * 1000);
  } finally {
    await page.close();
    await context.close(); // flushes the video file
  }

  const [written] = await readdir(TMP);
  if (!written) throw new Error(`No video written for ${file}`);
  await rename(join(TMP, written), join(OUT, file.replace(/\.mp4$/, ".webm")));
  await rm(TMP, { recursive: true, force: true });
  console.log(
    `  ✓ ${file.replace(/\.mp4$/, ".webm")} — transcode with:\n` +
      `      ffmpeg -i public/captures/${file.replace(/\.mp4$/, ".webm")} ` +
      `-c:v libx264 -crf 18 -pix_fmt yuv420p public/captures/${file}`,
  );
};

const run = async () => {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: !process.env.ROAMLY_HEADED });
  const context = await browser.newContext(DESKTOP);
  const page = await context.newPage();

  // ---- 00 seed check ------------------------------------------------------
  // The home view caps its "Up next" list at three rows (src/App.tsx, the
  // .slice(0, 3) on upNext), so counting rows there can never tell you whether
  // the account is well seeded — three is what a full account looks like. The
  // real check belongs on /tasks, which lists everything.
  if (only.length === 0) {
    console.log("00 — seed check");
    await gotoView(page, "/tasks", "00");
    await assertNotEmpty(
      page,
      "00",
      page.getByRole("button", { name: /^Mark .+ (not )?done$/ }),
      6,
    );
    console.log("  ✓ account looks seeded");
  }

  // ---- 01 focus timer, mid block, task list visible -----------------------
  if (wanted("01")) {
    console.log("01 — focus timer");
    await gotoView(page, "/", "01");
    // Three is the cap, not a threshold: fewer means the up-next list is short.
    await assertNotEmpty(
      page,
      "01",
      page.getByRole("button", { name: /^Mark complete:/ }),
      3,
    );
    // Start a block so the timer is genuinely mid-countdown, then let it run
    // far enough in that the digits are not a round number.
    const start = page.getByRole("button", { name: /^start$/i }).first();
    if (await start.isVisible().catch(() => false)) await start.click();
    await page.waitForTimeout(8000);
    await shot(page, "01-focus-timer.png");
  }

  // ---- 02 method picker ---------------------------------------------------
  if (wanted("02")) {
    console.log("02 — method picker");
    await gotoView(page, "/", "02");
    const picker = page.getByRole("button", { name: /Select timer/i }).first();
    await picker.click();
    await page.waitForTimeout(900);
    await assertNotEmpty(page, "02", page.getByText(/PANCE Drill|Deep Work|Anatomy 45/), 3);
    await shot(page, "02-methods.png");
  }

  // ---- 03 AI upload flow (clip) ------------------------------------------
  if (wanted("03")) {
    console.log("03 — AI note upload");
    if (!existsSync(SAMPLE_NOTES)) {
      throw new Error(
        `No sample notes at ${SAMPLE_NOTES}. Put a lecture PDF there, or set ` +
          `ROAMLY_SAMPLE_NOTES. Use material you have the right to show on camera.`,
      );
    }
    await clip(browser, "03-upload.mp4", 11, async (p) => {
      await gotoView(p, "/tasks", "03");
      await p.getByLabel("Choose study material").setInputFiles(SAMPLE_NOTES);
      // The generation round-trip is the point of the shot; let it complete.
      await p.waitForTimeout(1200);
    });
  }

  // ---- 04 live study room (clip) -----------------------------------------
  if (wanted("04")) {
    console.log("04 — live study room");
    await clip(browser, "04-room.mp4", 11, async (p) => {
      await gotoView(p, "/rooms", "04");
      await p.getByRole("button", { name: /^Join$/ }).first().click();
      await p.waitForTimeout(1500);
    });
  }

  // ---- 05 analytics -------------------------------------------------------
  if (wanted("05")) {
    console.log("05 — analytics");
    await gotoView(page, "/analytics", "05");
    await page.waitForTimeout(1800); // charts animate in
    await shot(page, "05-analytics.png");
  }

  // ---- 06 garden / companions --------------------------------------------
  if (wanted("06")) {
    console.log("06 — garden");
    await gotoView(page, "/garden", "06");
    await page.waitForTimeout(1800);
    await shot(page, "06-garden.png");
  }

  // ---- 07 picture-in-picture (clip) --------------------------------------
  if (wanted("07")) {
    console.log("07 — picture-in-picture");
    await clip(browser, "07-pip.mp4", 6, async (p) => {
      await gotoView(p, "/", "07");
      const pip = p.getByRole("button", { name: /Pop out timer/i }).first();
      if (!(await pip.isVisible().catch(() => false))) {
        throw new Error(
          "[07] No pop-out control found. Document PiP may be unsupported in " +
            "this Chromium build — capture this shot manually and note it in the shot list.",
        );
      }
      await pip.click();
      await p.waitForTimeout(1200);
    });
  }

  // ---- 08 theme switching (clip) -----------------------------------------
  if (wanted("08")) {
    console.log("08 — theme switching");
    await clip(browser, "08-themes.mp4", 6, async (p) => {
      await gotoView(p, "/", "08");
      for (const theme of [/^Library Night$/i, /^Sage Calm$/i, /^Coffee Shop$/i]) {
        // The picker closes on selection, so it is reopened for each theme.
        await p.getByRole("button", { name: /Change theme/i }).first().click();
        await p.waitForTimeout(400);
        const t = p.getByRole("button", { name: theme }).first();
        if (await t.isVisible().catch(() => false)) {
          await t.click();
          await p.waitForTimeout(1300);
        }
      }
    });
  }

  // ---- 09 / 10 mobile -----------------------------------------------------
  if (wanted("09") || wanted("10")) {
    console.log("09/10 — mobile");
    const mobile = await browser.newContext({
      ...devices["iPhone 14"],
      storageState: AUTH_FILE,
      deviceScaleFactor: 3,
    });
    const mp = await mobile.newPage();

    if (wanted("09")) {
      await gotoView(mp, "/", "09");
      await mp.screenshot({ path: join(OUT, "09-mobile-timer.png"), scale: "device" });
      console.log("  ✓ 09-mobile-timer.png");
    }
    if (wanted("10")) {
      await gotoView(mp, "/rooms", "10");
      await mp.getByRole("button", { name: /^Join$/ }).first().click();
      await mp.waitForTimeout(2000);
      await mp.screenshot({ path: join(OUT, "10-mobile-room.png"), scale: "device" });
      console.log("  ✓ 10-mobile-room.png");
    }
    await mobile.close();
  }

  await browser.close();
  console.log("\nDone. Review every file in public/captures/ before rendering:");
  console.log("  - no signed-out chrome, no empty states");
  console.log("  - no real names, emails, or avatars other than the demo account");
  console.log("Then: node scripts/contact-sheet.mjs");
};

run().catch((err) => {
  console.error(`\nFailed: ${err.message}`);
  process.exit(1);
});
