/**
 * Builds .auth/roamly.json from a session exported out of your own browser.
 *
 * This exists because Cloudflare will not let a Playwright-driven browser near
 * the sign-in form, headed or not. Rather than fight that, sign in with your
 * normal browser — where you are already a trusted human — and hand the
 * resulting session over.
 *
 * The app keeps its Supabase session in localStorage, so that is all we need.
 *
 * 1. Sign in at https://www.roamlyflow.com in your ordinary browser.
 * 2. Open DevTools (Cmd+Option+I on macOS) → Console, and run:
 *
 *      copy(JSON.stringify({
 *        origin: location.origin,
 *        localStorage: Object.entries(localStorage).map(([name, value]) => ({ name, value })),
 *      }))
 *
 *    That copies the session to your clipboard. ("copy" is a DevTools helper —
 *    it prints undefined, which is expected.)
 * 3. Paste it into a file and import it:
 *
 *      pbpaste > /tmp/roamly-session.json      # macOS
 *      node scripts/import-session.mjs /tmp/roamly-session.json
 *
 * 4. Delete the temp file afterwards — it is a live session token.
 *
 * The captures themselves run fine under Playwright; it is only the sign-in
 * that is defended.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const AUTH_FILE = resolve(ROOT, ".auth/roamly.json");

const input = process.argv[2];
if (!input) {
  console.error(
    "Usage: node scripts/import-session.mjs <exported-session.json>\n\n" +
      "See the comment at the top of this file for how to produce that export.",
  );
  process.exit(1);
}

let parsed;
try {
  parsed = JSON.parse(await readFile(resolve(process.cwd(), input), "utf8"));
} catch (err) {
  console.error(
    `Could not read or parse ${input}: ${err.message}\n\n` +
      "It should be the JSON the DevTools snippet copied — starting with " +
      '{"origin": …}.',
  );
  process.exit(1);
}

const entries = parsed.localStorage ?? [];
const origin = parsed.origin ?? "https://www.roamlyflow.com";

// Supabase writes its session under sb-<project-ref>-auth-token. Without that
// key the export is of a signed-out page, and every capture would silently come
// out logged out — exactly what this pipeline exists to prevent.
const authKey = entries.find((e) => /^sb-.*-auth-token$/.test(e.name));
if (!authKey) {
  console.error(
    "No Supabase auth token (sb-…-auth-token) in that export.\n\n" +
      "The browser tab you exported from was not signed in, or you exported " +
      "from a different origin. Sign in, confirm you can see your tasks, then " +
      "re-run the snippet on that same tab.",
  );
  process.exit(1);
}

// Guard against exporting a session that is already dead — better to catch it
// here than three shots into a capture run.
try {
  const value = JSON.parse(authKey.value);
  if (value.expires_at && value.expires_at * 1000 < Date.now()) {
    console.error(
      "That session has already expired. Refresh the app in your browser and " +
        "export again.",
    );
    process.exit(1);
  }
} catch {
  // Shape may change between Supabase versions; the key existing is enough.
}

const storageState = {
  cookies: [],
  origins: [{ origin, localStorage: entries }],
};

await mkdir(dirname(AUTH_FILE), { recursive: true });
await writeFile(AUTH_FILE, JSON.stringify(storageState, null, 2));

console.log(`Session imported to ${AUTH_FILE.replace(ROOT, ".")} (origin ${origin}).`);
console.log("Next: node scripts/capture-shots.mjs");
console.log("\nDelete the export file now — it holds a live session token.");
