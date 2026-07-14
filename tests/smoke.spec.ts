import { test, expect, type Page } from "@playwright/test";

// Signed-out smoke suite. Every test suppresses the first-run tutorial except
// the one that asserts it. These run against a build with placeholder
// Supabase env vars, so the real UI renders but no network backend exists.

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => localStorage.setItem("roamly-tutorial-seen", "1"));
});

async function goHome(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Select timer" })).toBeVisible();
}

test("homepage loads with the timer", async ({ page }) => {
  await goHome(page);
  await expect(page).toHaveTitle(/Roamly/);
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();
});

test("expanded built-in music library is available", async ({ page }) => {
  await goHome(page);
  await expect(page.getByRole("button", { name: /Ambient drift/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Rainy piano/ })).toBeVisible();
});

test("first-run tutorial shows on a fresh device", async ({ browser }) => {
  const ctx = await browser.newContext(); // no seen-flag
  const page = await ctx.newPage();
  await page.goto("/");
  await expect(page.getByTestId("tutorial")).toBeVisible();
  await expect(page.getByText("Welcome to Roamly")).toBeVisible();
  await ctx.close();
});

test("navigation tabs switch views", async ({ page }) => {
  await goHome(page);
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Tasks", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Rooms" }).click();
  await expect(page.getByRole("heading", { name: "Study rooms" })).toBeVisible();
  await page.getByRole("button", { name: "Analytics" }).click();
  await expect(page.getByRole("heading", { name: "Analytics" })).toBeVisible();
});

test("auth modal opens from the header", async ({ page }) => {
  await goHome(page);
  await page.getByRole("button", { name: "Sign in" }).first().click();
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
});

test("sign-in form rejects empty fields", async ({ page }) => {
  await goHome(page);
  await page.getByRole("button", { name: "Sign in" }).first().click();
  await page.getByRole("button", { name: "Sign in", exact: true }).last().click();
  await expect(page.getByText(/enter your email and password/i)).toBeVisible();
});

test("sign-up form rejects empty fields", async ({ page }) => {
  await goHome(page);
  await page.getByRole("button", { name: "Sign in" }).first().click();
  await page.getByText("New here? Create an account").click();
  await page.getByRole("button", { name: "Sign up", exact: true }).click();
  await expect(page.getByText(/enter your email and password/i)).toBeVisible();
});

test("sign-up form rejects a weak password", async ({ page }) => {
  await goHome(page);
  await page.getByRole("button", { name: "Sign in" }).first().click();
  await page.getByText("New here? Create an account").click();
  await page.getByPlaceholder("Email").fill("newuser@example.com");
  await page.getByPlaceholder(/^Password/).fill("weak"); // too short, no digit
  await page.getByRole("button", { name: "Sign up", exact: true }).click();
  await expect(page.getByText(/at least 8 characters/i)).toBeVisible();
});

test("a task can be added locally", async ({ page }) => {
  await goHome(page);
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await expect(page.getByRole("switch", { name: "Complete tasks automatically" })).toHaveAttribute("aria-checked", "true");
  await page.getByPlaceholder(/Add a study task/).fill("Smoke test task");
  await page.getByLabel("New subject name").fill("Testing");
  await page.getByRole("button", { name: "Add task", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Smoke test task\b/ })).toBeVisible();
});

test("a task can be completed locally", async ({ page }) => {
  await goHome(page);
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await page.getByPlaceholder(/Add a study task/).fill("Complete me");
  await page.getByLabel("New subject name").fill("Testing");
  await page.getByRole("button", { name: "Add task", exact: true }).click();
  const before = await page.getByText(/of \d+ done/).textContent();
  await page.getByRole("button", { name: "Mark Complete me done" }).click();
  await expect(page.getByText(/of \d+ done/)).not.toHaveText(before ?? "");
  await expect(page.getByText(/Completed · \d+/)).toBeVisible();
});

test("guest tasks persist and stop at five", async ({ page }) => {
  await goHome(page);
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  for (let i = 1; i <= 5; i++) {
    await page.getByPlaceholder(/Add a study task/).fill(`Guest task ${i}`);
    if (i === 1) await page.getByLabel("New subject name").fill("Guest");
    await page.getByRole("button", { name: "Add task", exact: true }).click();
  }
  await expect(page.getByText(/reached the 5-task guest limit/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Add task", exact: true })).toBeDisabled();
  await page.reload();
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Guest task 1\b/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Guest task 5\b/ })).toBeVisible();
});

test("count-up timer starts, pauses, and can be reset", async ({ page }) => {
  await goHome(page);
  // Count-up lives in the Select timer list now, below the pomodoro methods.
  await page.getByRole("button", { name: "Select timer" }).click();
  await page.getByRole("button", { name: /Count-up timer/ }).click();
  await page.getByRole("button", { name: "Start count-up timer" }).click();
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: "Pause count-up timer" }).click();
  await expect(page.getByRole("button", { name: "Resume count-up timer" })).toBeVisible();
  await page.getByRole("button", { name: "Reset count-up timer" }).click();
  await expect(page.getByRole("button", { name: "Start count-up timer" })).toBeVisible();
});

test("guest count-up completion is saved to analytics", async ({ page }) => {
  await goHome(page);
  await page.getByRole("button", { name: "Select timer" }).click();
  await page.getByRole("button", { name: /Count-up timer/ }).click();
  await page.getByRole("button", { name: "Start count-up timer" }).click();
  await page.waitForTimeout(1100);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Stop & save" }).click();
  await page.getByRole("button", { name: "Analytics" }).click();
  await expect(page.getByText("1 / 120 min")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Study time by category" })).toBeVisible();
  await expect(page.getByText("You studied 1 minute on Uncategorized.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Study post-mortem" })).toBeVisible();
  await expect(page.getByText(/Skipped sessions are feedback, not failure/)).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Analytics" }).click();
  await expect(page.getByText("1 / 120 min")).toBeVisible();
});

test("completion sound preference persists", async ({ page }) => {
  await goHome(page);
  const toggle = page.getByRole("switch", { name: /Completion sound on/ });
  await toggle.click();
  await expect(page.getByRole("switch", { name: /Completion sound off/ })).toHaveAttribute("aria-checked", "false");
  await page.reload();
  await expect(page.getByRole("switch", { name: /Completion sound off/ })).toHaveAttribute("aria-checked", "false");
});

test("premium feature prompts sign-in when logged out", async ({ page }) => {
  await goHome(page);
  await page.getByRole("button", { name: "Select timer" }).click();
  // Pick a premium method → upsell → Try Premium → auth modal (signed out).
  await page.getByRole("button", { name: /PANCE Drill/ }).click();
  await expect(page.getByText("This is a Premium feature")).toBeVisible();
  await page.getByRole("button", { name: "Try Premium free" }).click();
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
});

test("pop-out timer button shows when Document PiP is supported", async ({ page }) => {
  // localhost is a secure context, so Chromium exposes documentPictureInPicture
  // and the gated "Pop out timer" button renders on the Focus tab.
  await goHome(page);
  await expect(page.getByRole("button", { name: "Pop out timer" })).toBeVisible();
});

test("AI upload requires sign-in when logged out", async ({ page }) => {
  await goHome(page);
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await expect(page.getByText(/Guest tasks stay on this device/)).toBeVisible();
  // The upload panel (with its file-type allowlist) only renders for sessions.
  await expect(page.getByText(/Upload notes or slides/)).toHaveCount(0);
});

test("no horizontal overflow on any tab", async ({ page }) => {
  await goHome(page);
  for (const tab of ["Focus", "Tasks", "Rooms", "Analytics"]) {
    await page.getByRole("button", { name: tab, exact: true }).click();
    await page.waitForTimeout(250);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${tab} tab overflows horizontally`).toBeLessThanOrEqual(1);
  }
});

test("mobile header controls do not overlap the Roamly wordmark", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "single cross-breakpoint audit");
  for (const width of [320, 375, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await goHome(page);
    const brandBox = await page.getByText("Roamly", { exact: true }).boundingBox();
    const controlBox = await page.getByRole("button", { name: "Replay the app tour" }).boundingBox();
    expect(brandBox, `wordmark missing at ${width}px`).not.toBeNull();
    expect(controlBox, `header controls missing at ${width}px`).not.toBeNull();
    expect(brandBox!.x + brandBox!.width, `header overlaps wordmark at ${width}px`).toBeLessThanOrEqual(controlBox!.x - 4);
  }
});

test("Release 2 pricing and credit packages render", async ({ page }) => {
  await goHome(page);
  await page.getByRole("button", { name: "Select timer" }).click();
  await page.getByRole("button", { name: /PANCE Drill/ }).click();
  await page.getByRole("button", { name: /buy AI upload credits/i }).click();
  await expect(page.getByText("$3", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("$30", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Choose monthly" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Choose annual" })).toBeVisible();
  await expect(page.getByText("2 uploads", { exact: true })).toBeVisible();
  await expect(page.getByText("5 uploads", { exact: true })).toBeVisible();
  await expect(page.getByText(/Includes 3 days Premium/)).toBeVisible();
  await expect(page.getByText(/Includes 7 days Premium/)).toBeVisible();
  await expect(page.getByText("Planned study scheduling", { exact: true })).toBeVisible();
});

test("planned study lives in Tasks and requires an account", async ({ page }) => {
  await goHome(page);
  await page.getByRole("button", { name: "Analytics", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Study breakdown" })).toBeVisible();
  await expect(page.getByRole("button", { name: "All time" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Planned study" })).toHaveCount(0);
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Planned study" })).toBeVisible();
  await expect(page.getByText("Account required", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in to plan" })).toBeVisible();
  await expect(page.getByLabel("Planned study time")).toHaveCount(0);
  await expect(page.getByLabel("Duration in minutes")).toHaveCount(0);
});

test("Release 3 break activities are optional and interactive", async ({ page }) => {
  await goHome(page);
  await page.getByRole("button", { name: "Skip", exact: true }).first().click();
  const activities = page.getByRole("region", { name: "Healthy break activities" });
  await expect(activities).toBeVisible();
  const options = activities.getByRole("button");
  await expect(options).toHaveCount(2);
  await options.first().click();
  await expect(options.first()).toHaveAttribute("aria-pressed", "true");
});

test("release mobile breakpoints remain usable", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "single cross-breakpoint audit");
  for (const width of [320, 375, 390, 430, 768, 1280]) {
    await page.setViewportSize({ width, height: width >= 768 ? 800 : 844 });
    await goHome(page);
    for (const tab of ["Focus", "Tasks", "Rooms", "Analytics"]) {
      await page.getByRole("button", { name: tab, exact: true }).click();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${tab} overflows at ${width}px`).toBeLessThanOrEqual(1);
    }
  }
});

test("Spotify and Apple Music choices are visible without opening a popup", async ({ page }) => {
  await goHome(page);
  await expect(page.getByRole("button", { name: "Spotify", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Apple Music", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("starting the timer counts down", async ({ page }) => {
  await goHome(page);
  await page.getByRole("button", { name: "Start", exact: true }).click();
  const overlay = page.getByTestId("focus-overlay");
  await expect(overlay).toBeVisible();
  const clock = overlay.locator('span[aria-label*=":"]').first();
  await expect(clock).toHaveAttribute("aria-label", "25:00");
  await page.waitForTimeout(2200);
  await expect(clock).not.toHaveAttribute("aria-label", "25:00"); // wall-clock ticked
});

test("auth modal is a labelled dialog and closes on Escape", async ({ page }) => {
  await goHome(page);
  await page.getByRole("button", { name: "Sign in" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("focus mode fits one screen on desktop (no scroll)", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop-only two-column layout");
  await goHome(page);
  await page.getByRole("button", { name: "Start", exact: true }).click();
  const overlay = page.getByTestId("focus-overlay");
  await expect(overlay).toBeVisible();
  await page.waitForTimeout(300);
  await expect(overlay.locator('span[aria-label*=":"]').first()).toBeVisible(); // timer
  // The overlay's own content region must not overflow — with the old single
  // column it scrolled; the two-column desktop layout fits it on one screen.
  // (The page behind is scroll-locked, so measure the overlay, not the doc.)
  const overflow = await overlay.locator("> div.overflow-y-auto").evaluate(
    (el) => el.scrollHeight - el.clientHeight
  );
  expect(overflow, "focus overlay content should fit without scrolling on desktop").toBeLessThanOrEqual(1);
});

test("visible buttons have accessible names", async ({ page }) => {
  await goHome(page);
  const buttons = page.locator("button:visible");
  const count = await buttons.count();
  expect(count).toBeGreaterThan(5);
  for (let i = 0; i < count; i++) {
    const b = buttons.nth(i);
    if ((await b.getAttribute("aria-hidden")) === "true") continue;
    const name = ((await b.getAttribute("aria-label")) ?? (await b.innerText())).trim();
    expect(name, `button #${i} lacks an accessible name`).not.toBe("");
  }
});
