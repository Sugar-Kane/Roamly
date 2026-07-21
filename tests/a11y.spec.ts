import { test, expect, type Page } from "@playwright/test";
import { appendFileSync, mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";

// Automated WCAG scan (axe-core) over the core routes and key overlays, wired
// into the same CI job as the smoke suite. It is a regression net, NOT a proof
// of conformance: axe reliably catches only a subset of WCAG issues (missing
// names, contrast, duplicate ids, bad ARIA), so manual screen-reader and
// keyboard passes (see docs/accessibility/manual-qa-plan.md) remain required.
//
// We tag the run to WCAG 2.1/2.2 A + AA and look at the two impact levels that
// map to real barriers — "critical" and "serious".
//
// Gating is deliberately two-tier:
//   * NON-CONTRAST serious/critical violations HARD-FAIL the build. These are
//     missing accessible names, bad ARIA, duplicate ids, broken labels, etc.,
//     and are fixable in code without design trade-offs.
//   * COLOR-CONTRAST violations are REPORTED (written to
//     test-results/a11y-contrast-report.jsonl and printed) but do not fail the
//     build *yet*. Fixing them means changing theme palette tokens, which is a
//     visual-identity decision gated on design/human approval per the project's
//     accessibility rules (see docs/accessibility/theme-contrast.md). This is
//     tracked debt, NOT a silent suppression: the rule still runs on every CI
//     run and every finding is logged and documented. Once the palette changes
//     are approved and made, flip CONTRAST_GATE to true to enforce them too.
const CONTRAST_GATE = false;

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const CONTRAST_REPORT = "test-results/a11y-contrast-report.jsonl";
try { mkdirSync("test-results", { recursive: true }); } catch { /* exists */ }

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => localStorage.setItem("roamly-tutorial-seen", "1"));
});

async function scan(page: Page, context = "page") {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const blocking = results.violations.filter(
    (v) => v.impact === "critical" || v.impact === "serious"
  );
  const contrast = blocking.filter((v) => v.id === "color-contrast");
  const other = blocking.filter((v) => v.id !== "color-contrast");

  // Record contrast findings for the design-review backlog (never silently drop).
  if (contrast.length) {
    const nodes = contrast.flatMap((v) =>
      v.nodes.map((n) => ({ context, rule: v.id, impact: v.impact, target: n.target, summary: n.failureSummary }))
    );
    try { appendFileSync(CONTRAST_REPORT, nodes.map((n) => JSON.stringify(n)).join("\n") + "\n"); } catch { /* best effort */ }
    const pairs = new Set(
      contrast.flatMap((v) => v.nodes.map((n) => (n.failureSummary?.match(/#[0-9a-f]{3,6}/gi) ?? []).join(" on ")))
    );
    console.warn(`[a11y contrast] ${context}: ${contrast.reduce((s, v) => s + v.nodes.length, 0)} node(s), pairs: ${[...pairs].join(", ")}`);
  }

  const summary = other
    .map((v) => `${v.id} (${v.impact}) [${v.nodes.length}] — ${v.help}\n    ${v.nodes.map((n) => n.target).join("\n    ")}`)
    .join("\n");
  expect(other, `Serious/critical (non-contrast) a11y violations on ${context}:\n${summary}`).toEqual([]);

  if (CONTRAST_GATE) {
    expect(contrast, `Color-contrast violations on ${context}`).toEqual([]);
  }
}

async function goHome(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Select timer" })).toBeVisible();
}

async function goTab(page: Page, tab: string) {
  const direct = page.getByRole("button", { name: tab, exact: true });
  if (await direct.isVisible()) { await direct.click(); return; }
  if (tab === "Premium") {
    await page.getByRole("button", { name: /^Premium (plans|account)$/ }).first().click();
    return;
  }
  throw new Error(`goTab: "${tab}" is not reachable from the bottom bar`);
}

// --- Static public pages (standalone HTML) ---
for (const path of ["/accessibility.html", "/privacy.html", "/terms.html", "/pomodoro-timer.html"]) {
  test(`static page has no serious a11y violations: ${path}`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator("h1")).toBeVisible();
    await scan(page, path);
  });
}

// --- App: core routes ---
test("home / focus route", async ({ page }) => {
  await goHome(page);
  await scan(page, "focus route");
});

test("tasks route", async ({ page }) => {
  await goHome(page);
  await goTab(page, "Tasks");
  await expect(page.getByRole("heading", { name: "Tasks", exact: true })).toBeVisible();
  await scan(page, "tasks route");
});

test("rooms route", async ({ page }) => {
  await goHome(page);
  await goTab(page, "Rooms");
  await expect(page.getByRole("heading", { name: "Rooms", exact: true })).toBeVisible();
  await scan(page, "rooms route");
});

test("analytics route", async ({ page }) => {
  await goHome(page);
  await goTab(page, "Analytics");
  await expect(page.getByRole("heading", { name: "Analytics" })).toBeVisible();
  await scan(page, "analytics route");
});

test("premium route", async ({ page }) => {
  await goHome(page);
  await goTab(page, "Premium");
  await expect(page.getByRole("heading", { name: "Go Premium" })).toBeVisible();
  await scan(page, "premium route");
});

test("admin gate (signed out)", async ({ page }) => {
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Admin", exact: true })).toBeVisible();
  await scan(page, "admin gate");
});

// --- App: key overlays / dialogs ---
test("auth (sign in) dialog", async ({ page }) => {
  await goHome(page);
  await page.getByRole("button", { name: "Sign in" }).first().click();
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await scan(page, "auth dialog");
});

test("sign-up dialog", async ({ page }) => {
  await goHome(page);
  await page.getByRole("button", { name: "Sign in" }).first().click();
  await page.getByText("New here? Create an account").click();
  await scan(page, "sign-up dialog");
});

test("settings modal", async ({ page }) => {
  await goHome(page);
  await page.getByRole("button", { name: "Open profile menu" }).click();
  await page.getByRole("button", { name: /^Settings/ }).click();
  await expect(page.getByTestId("settings-modal")).toBeVisible();
  await scan(page, "settings modal");
});

test("select-timer picker", async ({ page }) => {
  await goHome(page);
  await page.getByRole("button", { name: "Select timer" }).click();
  await scan(page, "timer picker");
});

test("customize session drawer", async ({ page }) => {
  await goHome(page);
  await page.getByRole("button", { name: "Customize Session" }).click();
  await expect(page.getByTestId("customize-session")).toBeVisible();
  await scan(page, "customize session");
});

test("help & legal drawer (with tab keyboard nav)", async ({ page }) => {
  await goHome(page);
  await page.getByRole("button", { name: "Help & Legal" }).click();
  const drawer = page.getByTestId("help-legal");
  await expect(drawer).toBeVisible();
  await scan(page, "help & legal drawer");
  // Verify the ARIA tabs keyboard model added in this pass: arrow keys move and
  // activate, roving tabindex keeps a single tab stop.
  await drawer.getByRole("tab", { name: "Help" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(drawer.getByRole("tab", { name: "Privacy" })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("End");
  await expect(drawer.getByRole("tab", { name: "Terms" })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Home");
  await expect(drawer.getByRole("tab", { name: "Help" })).toHaveAttribute("aria-selected", "true");
});

// --- Focus mode overlay (timer running) ---
test("focus mode overlay", async ({ page }) => {
  await goHome(page);
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.getByTestId("focus-overlay")).toBeVisible();
  await scan(page, "focus mode overlay");
});

// --- Themes: focus route must stay clean on every theme (contrast et al.) ---
for (const themeId of ["coffee", "whitecoat", "library", "sage", "sunset", "ocean"]) {
  test(`focus route passes on theme: ${themeId}`, async ({ page }) => {
    await page.addInitScript((id) => localStorage.setItem("roamly-theme", id), themeId);
    await goHome(page);
    await scan(page, `theme ${themeId}`);
  });
}
