/**
 * Step 1 of the capture pipeline: sign in once and persist the session.
 *
 * Writes .auth/roamly.json (Playwright storageState) so capture-shots.mjs can
 * reuse an authenticated context without ever handling the password again.
 *
 * Two modes:
 *
 *   MANUAL (default, and the one that works behind a bot-detection layer):
 *     node scripts/capture-auth.mjs
 *   Opens a real browser, you sign in by hand, press Enter, and the session is
 *   saved. No credentials touch this script at all. Cloudflare Turnstile and
 *   similar defences are designed to stop scripted form-fill, so automating
 *   the login is the thing that trips them — a human signing in does not.
 *
 *   AUTOMATED (only where no bot check sits on the form):
 *     ROAMLY_EMAIL=… ROAMLY_PASSWORD=… node scripts/capture-auth.mjs --auto
 *   Credentials come from the environment and are never written to disk,
 *   echoed, or included in an error message.
 *
 * Optional:
 *   ROAMLY_URL       target origin (default https://www.roamlyflow.com)
 *   ROAMLY_HEADED=1  show the browser in --auto mode (manual is always shown)
 *
 * .auth/ is gitignored in this project and at the repo root.
 */

import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const AUTH_FILE = resolve(ROOT, ".auth/roamly.json");

const BASE_URL = process.env.ROAMLY_URL ?? "https://www.roamlyflow.com";
const EMAIL = process.env.ROAMLY_EMAIL;
const PASSWORD = process.env.ROAMLY_PASSWORD;
const AUTO = process.argv.includes("--auto");

/**
 * Launches a browser that looks like a browser. Real Chrome is preferred over
 * bundled Chromium: bot-detection layers score the bundled build far more
 * harshly, and in manual mode there is a person driving it anyway.
 */
const launch = async (headless) => {
  for (const channel of ["chrome", "msedge"]) {
    try {
      return await chromium.launch({ headless, channel });
    } catch {
      // Channel not installed; fall through to the bundled build.
    }
  }
  return chromium.launch({ headless });
};

/** Confirms a Supabase session actually landed before writing anything. */
const saveState = async (context) => {
  const state = await context.storageState();
  if (!JSON.stringify(state).includes("auth-token")) {
    throw new Error(
      "No Supabase auth token in storage — the sign-in did not complete. " +
        "Refusing to write a session that would silently capture logged-out screens.",
    );
  }
  await mkdir(dirname(AUTH_FILE), { recursive: true });
  await writeFile(AUTH_FILE, JSON.stringify(state, null, 2));
  console.log(`\nSession saved to ${AUTH_FILE.replace(ROOT, ".")}`);
  console.log("Next: node scripts/capture-shots.mjs");
};

const runManual = async () => {
  const browser = await launch(false);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });

  console.log(`
A browser window is open at ${BASE_URL}.

  1. Sign in there by hand — including any CAPTCHA.
  2. Wait until you are back on the app and signed in.
  3. Come back here and press Enter.

Nothing is typed for you, so bot checks have no scripted input to catch.
`);

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  await rl.question("Press Enter once you are signed in… ");
  rl.close();

  await saveState(context);
  await browser.close();
};

const runAuto = async () => {
  if (!EMAIL || !PASSWORD) {
    throw new Error(
      "--auto needs ROAMLY_EMAIL and ROAMLY_PASSWORD in the environment. " +
        "Drop --auto to sign in by hand instead.",
    );
  }

  const browser = await launch(!process.env.ROAMLY_HEADED);
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();

  console.log(`Opening ${BASE_URL} …`);
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });

  // The auth modal is opened from the header. The button label differs between
  // the signed-out header and the profile menu, so try the obvious entry points
  // in order rather than guessing one selector.
  for (const entry of [
    page.getByRole("button", { name: /sign in/i }),
    page.getByRole("button", { name: /log ?in/i }),
    page.getByRole("button", { name: /account/i }),
  ]) {
    if ((await entry.count()) > 0) {
      await entry.first().click();
      break;
    }
  }

  // Everything is scoped to the auth dialog (src/Modal.tsx renders
  // role="dialog"). The header's "Sign in" button and the modal's submit button
  // share an accessible name, so an unscoped lookup would re-click the header.
  const dialog = page.getByRole("dialog");
  const email = dialog.getByPlaceholder("Email");
  await email.waitFor({ state: "visible", timeout: 15_000 });
  await email.fill(EMAIL);
  await dialog.getByPlaceholder(/^Password$/).fill(PASSWORD);

  const hasCaptcha = await dialog
    .locator('iframe[src*="challenges.cloudflare.com"]')
    .count()
    .catch(() => 0);
  if (hasCaptcha > 0) {
    throw new Error(
      "A CAPTCHA sits on the sign-in form, which scripted form-fill will not " +
        "get past. Re-run without --auto and sign in by hand.",
    );
  }

  await dialog.getByRole("button", { name: /^Sign in$/i }).click();

  await dialog
    .getByPlaceholder("Email")
    .waitFor({ state: "detached", timeout: 20_000 })
    .catch(() => {
      throw new Error(
        "The sign-in form did not close. The credentials were rejected, a bot " +
          "check blocked it, or the login flow changed. Re-run without --auto " +
          "to sign in by hand.",
      );
    });

  await page.waitForTimeout(2500); // let the session settle into storage
  await saveState(context);
  await browser.close();
};

(AUTO ? runAuto() : runManual()).catch((err) => {
  // Print the message only — never the stack, which on Playwright errors can
  // include the filled value of an input.
  console.error(`\nFailed: ${err.message}`);
  process.exit(1);
});
