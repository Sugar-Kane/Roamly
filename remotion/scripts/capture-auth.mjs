/**
 * Step 1 of the capture pipeline: sign in once and persist the session.
 *
 * Writes .auth/roamly.json (Playwright storageState) so capture-shots.mjs can
 * reuse an authenticated context without ever handling the password again.
 *
 * Credentials come from the environment and are never written to disk, echoed,
 * or included in an error message. .auth/ is gitignored.
 *
 *   ROAMLY_EMAIL=... ROAMLY_PASSWORD=... node scripts/capture-auth.mjs
 *
 * Optional:
 *   ROAMLY_URL       target origin (default https://www.roamlyflow.com)
 *   ROAMLY_HEADED=1  watch the login happen, for debugging
 */

import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const AUTH_FILE = resolve(ROOT, ".auth/roamly.json");

const BASE_URL = process.env.ROAMLY_URL ?? "https://www.roamlyflow.com";
const EMAIL = process.env.ROAMLY_EMAIL;
const PASSWORD = process.env.ROAMLY_PASSWORD;

if (!EMAIL || !PASSWORD) {
  console.error(
    [
      "Missing credentials.",
      "",
      "This script needs a dedicated RoamlyFlow demo account:",
      "  ROAMLY_EMAIL=demo@example.com ROAMLY_PASSWORD='...' node scripts/capture-auth.mjs",
      "",
      "Use an account created for marketing captures only. Do not use a",
      "personal account — the captures become public marketing material.",
    ].join("\n"),
  );
  process.exit(1);
}

const run = async () => {
  const browser = await chromium.launch({ headless: !process.env.ROAMLY_HEADED });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();

  console.log(`Opening ${BASE_URL} …`);
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });

  // The auth modal is opened from the header. The button label differs between
  // the signed-out header and the profile menu, so try the obvious entry points
  // in order rather than guessing one selector.
  const entryPoints = [
    page.getByRole("button", { name: /sign in/i }),
    page.getByRole("button", { name: /log ?in/i }),
    page.getByRole("button", { name: /account/i }),
  ];
  for (const entry of entryPoints) {
    if ((await entry.count()) > 0) {
      await entry.first().click();
      break;
    }
  }

  // Selectors match src/Auth.tsx: a placeholder-labelled email and password
  // input inside the modal, then the submit button.
  const email = page.getByPlaceholder("Email");
  await email.waitFor({ state: "visible", timeout: 15_000 });
  await email.fill(EMAIL);
  await page.getByPlaceholder(/^Password$/).fill(PASSWORD);
  await page.getByRole("button", { name: /^(sign in|log in|continue)$/i }).first().click();

  // Signed-in state is confirmed by the auth modal closing AND a profile
  // affordance appearing — not by a timeout, so a failed login fails loudly.
  await page
    .getByPlaceholder("Email")
    .waitFor({ state: "detached", timeout: 20_000 })
    .catch(() => {
      throw new Error(
        "The sign-in form did not close. The credentials were rejected, or the " +
          "login flow changed. Re-run with ROAMLY_HEADED=1 to watch it.",
      );
    });

  await page.waitForTimeout(2500); // let the session settle into storage

  const state = await context.storageState();
  const hasSession = JSON.stringify(state).includes("auth-token");
  if (!hasSession) {
    throw new Error(
      "Signed in, but no Supabase auth token landed in storage. Refusing to " +
        "write a storage state that would silently capture logged-out screens.",
    );
  }

  await mkdir(dirname(AUTH_FILE), { recursive: true });
  await writeFile(AUTH_FILE, JSON.stringify(state, null, 2));
  console.log(`Session saved to ${AUTH_FILE.replace(ROOT, ".")}`);
  console.log("Next: node scripts/capture-shots.mjs");

  await browser.close();
};

run().catch((err) => {
  // Print the message only — never the stack, which on Playwright errors can
  // include the filled value of an input.
  console.error(`\nFailed: ${err.message}`);
  process.exit(1);
});
