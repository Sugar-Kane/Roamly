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

// Navigate via the bottom bar. Analytics and Premium live in the More sheet
// on phones (four primary tabs + More below the sm breakpoint) and in the bar
// itself from sm up.
async function goTab(page: Page, tab: string) {
  const direct = page.getByRole("button", { name: tab, exact: true });
  if (await direct.isVisible()) { await direct.click(); return; }
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByTestId("more-sheet").getByRole("button", { name: tab }).click();
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

test("tour never auto-opens; a fresh device sees the timer immediately", async ({ browser }) => {
  const ctx = await browser.newContext(); // no seen-flag
  const page = await ctx.newPage();
  await page.goto("/");
  // Fresh arrival: usable timer, no tour, no music dock, no streaming iframe,
  // Pomodoro explainer collapsed to its link, intro line present.
  await expect(page.getByRole("button", { name: "Select timer" })).toBeVisible();
  await expect(page.getByTestId("tutorial")).toHaveCount(0);
  await expect(page.getByTestId("music-dock")).toHaveCount(0);
  await expect(page.locator('iframe[title="Music player"]')).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "A focus timer built for PA school." })).toBeVisible();
  await expect(page.getByText("What's the Pomodoro method?")).toBeVisible();
  // The tour still opens on demand (header "?" → replay) and restores state.
  await page.getByRole("button", { name: "Replay the app tour" }).click();
  await expect(page.getByTestId("tutorial")).toBeVisible();
  await expect(page.getByText("Welcome to Roamly Flow")).toBeVisible();
  await page.getByText("Skip tour").click();
  await expect(page.getByTestId("tutorial")).toHaveCount(0);
  await ctx.close();
});

test("How Roamly Flow works opens from the intro and can start the tour", async ({ page }) => {
  await goHome(page);
  await page.getByRole("button", { name: "How Roamly Flow works" }).click();
  await expect(page.getByRole("dialog", { name: "How Roamly Flow works" })).toBeVisible();
  await page.getByRole("button", { name: "Take the quick tour" }).click();
  await expect(page.getByTestId("tutorial")).toBeVisible();
  await page.getByText("Skip tour").click();
});

test("navigation tabs switch views", async ({ page }) => {
  await goHome(page);
  await goTab(page, "Tasks");
  await expect(page.getByRole("heading", { name: "Tasks", exact: true })).toBeVisible();
  await goTab(page, "Rooms");
  await expect(page.getByRole("heading", { name: "Rooms", exact: true })).toBeVisible();
  await goTab(page, "Analytics");
  await expect(page.getByRole("heading", { name: "Analytics" })).toBeVisible();
  await goTab(page, "Premium");
  await expect(page.getByRole("heading", { name: "Go Premium" })).toBeVisible();
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
  // The auto-complete preference moved into the collapsed Task preferences
  // disclosure; it stays on by default.
  await page.getByRole("button", { name: "Task preferences" }).click();
  await expect(page.getByRole("switch", { name: "Complete tasks automatically" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: "Task preferences" }).click();
  await page.getByPlaceholder(/Add a study task/).fill("Smoke test task");
  await page.getByLabel("New subject name").fill("Testing");
  await page.getByRole("button", { name: "Add task", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Smoke test task\b/ })).toBeVisible();
  await page.getByRole("button", { name: /focus sessions done for Smoke test task/ }).click();
  await expect(page.getByRole("heading", { name: "How many focus sessions to complete this task?" })).toBeVisible();
  await expect(page.getByText(/completes itself when it gets there/)).toHaveCount(0);
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
  // The clock lets us pass the 60s minimum-save threshold without a real wait,
  // and Stop & save now opens a themed confirm dialog (not a browser popup).
  await page.clock.install();
  await goHome(page);
  await page.getByRole("button", { name: "Select timer" }).click();
  await page.getByRole("button", { name: /Count-up timer/ }).click();
  await page.getByRole("button", { name: "Start count-up timer" }).click();
  await page.clock.fastForward("01:30"); // 90s -> ceil to 2 minutes, over the 60s floor
  await page.getByRole("button", { name: "Stop & save" }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await goTab(page, "Analytics");
  await expect(page.getByText("2 / 120 min")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Study time by category" })).toHaveCount(0);
  // Free accounts see one consolidated Premium pitch, not per-feature cards.
  await expect(page.getByRole("heading", { name: "Deeper insights" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Unlock with Premium: Deeper insights" })).toBeVisible();
  await page.reload();
  await goTab(page, "Analytics");
  await expect(page.getByText("2 / 120 min")).toBeVisible();
});

test("a trivially short count-up is not offered for saving", async ({ page }) => {
  await page.clock.install();
  await goHome(page);
  await page.getByRole("button", { name: "Select timer" }).click();
  await page.getByRole("button", { name: /Count-up timer/ }).click();
  await page.getByRole("button", { name: "Start count-up timer" }).click();
  await page.clock.fastForward("00:05"); // under the 60s floor
  await page.getByRole("button", { name: "Stop & save" }).click();
  // No save dialog appears and nothing is recorded.
  await expect(page.getByText("Save this session?")).toHaveCount(0);
  await goTab(page, "Analytics");
  await expect(page.getByText("0 / 120 min")).toBeVisible();
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
  // Pick a premium method → upsell → Premium CTA → auth modal (signed out).
  await page.getByRole("button", { name: /PANCE Drill/ }).click();
  await expect(page.getByText("This is a Premium feature")).toBeVisible();
  await page.getByRole("button", { name: "Unlock with Premium" }).click();
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
});

test("pop-out timer lives in Customize Session when Document PiP is supported", async ({ page }) => {
  // localhost is a secure context, so Chromium exposes documentPictureInPicture
  // and the gated pop-out row renders inside the Customize Session drawer.
  await goHome(page);
  await page.getByRole("button", { name: "Customize Session" }).click();
  const drawer = page.getByTestId("customize-session");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText("Pop-out timer")).toBeVisible();
  // The drawer also carries the relocated pets/confetti/auto-flow settings.
  await expect(drawer.getByRole("switch", { name: "Show pets during focus" })).toBeVisible();
  await expect(drawer.getByRole("switch", { name: "Completion confetti" })).toBeVisible();
  await expect(drawer.getByRole("switch", { name: "Auto-flow" })).toBeVisible();
  await drawer.getByRole("button", { name: /Done/ }).click();
  await expect(page.getByTestId("customize-session")).toHaveCount(0);
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
    await goTab(page, tab);
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
    const brandBox = await page.getByText("Roamly Flow", { exact: true }).first().boundingBox();
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
  await expect(page.getByText("$2", { exact: true })).toBeVisible(); // 5-credit upload pack
  await expect(page.getByRole("button", { name: "Choose monthly" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Choose annual" })).toBeVisible();
  await expect(page.getByText("2 uploads", { exact: true })).toBeVisible();
  await expect(page.getByText("5 uploads", { exact: true })).toBeVisible();
  await expect(page.getByText("Upload credits only. This does not unlock Premium.")).toHaveCount(2);
  await expect(page.getByText("Planned study scheduling", { exact: true })).toBeVisible();
  await expect(page.getByText("No account", { exact: true })).toBeVisible();
  await expect(page.getByText("Free account", { exact: true })).toBeVisible();
  await expect(page.getByText("Premium account", { exact: true })).toBeVisible();
  await expect(page.getByText("5 on this device", { exact: true })).toBeVisible();
  await expect(page.getByText("Themes", { exact: true })).toHaveCount(0);
  // Comparison table is grouped, annual card shows the monthly equivalence,
  // and the FAQ renders with expandable answers.
  await expect(page.getByRole("columnheader", { name: "Community" })).toBeVisible();
  await expect(page.getByText("$2.50 a month equivalent · save $6 a year")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Common questions" })).toBeVisible();
  const faq = page.getByText("Can I cancel anytime?");
  await expect(faq).toBeVisible();
  await faq.click();
  await expect(page.getByText(/no partial-month charges/)).toBeVisible();
});

test("planned study lives in Tasks and requires an account", async ({ page }) => {
  await goHome(page);
  await goTab(page, "Analytics");
  await expect(page.getByRole("heading", { name: "Deeper insights" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Unlock with Premium: Deeper insights" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Study breakdown" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "All time" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Planned study" })).toHaveCount(0);
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Planned study" })).toBeVisible();
  const taskCreationBox = await page.getByPlaceholder(/Add a study task/).boundingBox();
  const plannedStudyBox = await page.getByRole("heading", { name: "Planned study" }).boundingBox();
  expect(taskCreationBox).not.toBeNull();
  expect(plannedStudyBox).not.toBeNull();
  expect(taskCreationBox!.y).toBeLessThan(plannedStudyBox!.y);
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

test("optional break tasks join the focus-mode checklist on breaks", async ({ page }) => {
  await goHome(page);
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await page.getByPlaceholder(/Add a study task/).fill("Break test task");
  await page.getByLabel("New subject name").fill("Testing");
  await page.getByRole("button", { name: "Add task", exact: true }).click();
  await page.getByRole("button", { name: "Focus", exact: true }).click();
  // Start drops into focus mode; Skip inside the overlay reaches the break.
  await page.getByRole("button", { name: "Start", exact: true }).click();
  const overlay = page.getByTestId("focus-overlay");
  await expect(overlay).toBeVisible();
  await overlay.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(overlay.getByText("Optional", { exact: true })).toHaveCount(2);
  // Ticking one works but is never required.
  const tick = overlay.getByRole("button", { name: /Mark optional break task/ }).first();
  await tick.click();
  await expect(tick).toHaveAttribute("aria-pressed", "true");
  // Back in focus, the optional rows disappear.
  await overlay.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(overlay.getByText("Optional", { exact: true })).toHaveCount(0);
});

test("focus motivation shows per session, survives pause, and skip clears it without confetti", async ({ page }) => {
  await goHome(page);
  await page.getByRole("button", { name: "Start", exact: true }).click();
  const overlay = page.getByTestId("focus-overlay");
  await expect(overlay).toBeVisible();
  const line = overlay.getByTestId("focus-motivation");
  await expect(line).toBeVisible();
  const text = (await line.textContent())!;
  expect(text.length).toBeGreaterThan(10);
  // Pausing and resuming is the same session: the message must not change.
  await overlay.getByRole("button", { name: "Pause", exact: true }).click();
  await overlay.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(line).toHaveText(text);
  // Skipping is not a successful completion: no confetti, message gone.
  await overlay.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(page.getByTestId("confetti")).toHaveCount(0);
  await expect(overlay.getByTestId("focus-motivation")).toHaveCount(0);
});

test("confetti fires only when a focus block completes naturally", async ({ page }) => {
  await page.clock.install();
  await goHome(page);
  await page.getByRole("button", { name: "Start", exact: true }).click();
  const overlay = page.getByTestId("focus-overlay");
  await expect(overlay).toBeVisible();
  // A reset never celebrates.
  await overlay.getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByTestId("focus-overlay").getByRole("button", { name: "Exit focus mode" }).click();
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(page.getByTestId("confetti")).toHaveCount(0);
  // Run a full 25-minute block down to 00:00: the one true completion path.
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await page.clock.fastForward("25:05");
  await expect(page.getByTestId("confetti")).toBeVisible();
  // Completion behavior is untouched: the timer moved on to the break.
  await expect(page.getByTestId("focus-overlay").getByText("Short break")).toBeVisible();
});

test("the streaming Music panel collapses and the choice persists", async ({ page }) => {
  await goHome(page);
  await page.getByRole("button", { name: "Start", exact: true }).click();
  const overlay = page.getByTestId("focus-overlay");
  await expect(overlay).toBeVisible();
  const collapse = overlay.getByRole("button", { name: "Collapse Music" });
  await expect(collapse).toBeVisible();
  await expect(collapse).toHaveAttribute("aria-expanded", "true");
  // The Spotify/Apple tabs live in the panel body; collapsing hides them.
  await expect(overlay.getByRole("button", { name: "Apple Music" })).toBeVisible();
  await collapse.click();
  await expect(overlay.getByRole("button", { name: "Expand Music" })).toHaveAttribute("aria-expanded", "false");
  // Reloading keeps the collapsed choice (localStorage). The Focus tab's own
  // Music panel comes back already collapsed.
  await page.reload();
  await expect(page.getByRole("button", { name: "Select timer" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Expand Music" }).first()).toBeVisible();
});

test("pets can be toggled from focus mode and the choice persists", async ({ page }) => {
  await goHome(page);
  await page.getByRole("button", { name: "Start", exact: true }).click();
  const overlay = page.getByTestId("focus-overlay");
  await expect(overlay).toBeVisible();
  // The control is always present (even with pets off) so they can be restored.
  const petToggle = overlay.getByRole("button", { name: /pets during focus/i });
  await expect(petToggle).toBeVisible();
  const before = await petToggle.getAttribute("aria-pressed");
  await petToggle.click();
  await expect(overlay.getByRole("button", { name: /pets during focus/i }))
    .toHaveAttribute("aria-pressed", before === "true" ? "false" : "true");
  // The preference persists across a reload.
  await page.reload();
  await expect(page.getByRole("button", { name: "Select timer" })).toBeVisible();
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.getByTestId("focus-overlay").getByRole("button", { name: /pets during focus/i }))
    .toHaveAttribute("aria-pressed", before === "true" ? "false" : "true");
});

test("app preferences live in the Settings modal opened from the profile menu", async ({ page }) => {
  await goHome(page);
  await page.getByRole("button", { name: "Open profile menu" }).click();
  await page.getByRole("button", { name: /^Settings/ }).click();
  const modal = page.getByTestId("settings-modal");
  await expect(modal).toBeVisible();
  // The relocated groups: timer confetti, accessibility toggles, and the tour.
  await expect(modal.getByRole("switch", { name: "Completion confetti" })).toBeVisible();
  await expect(modal.getByRole("switch", { name: "Reduce motion" })).toBeVisible();
  await expect(modal.getByRole("switch", { name: "Color-blind friendly" })).toBeVisible();
  await expect(modal.getByRole("button", { name: /App tour/ })).toBeVisible();
  // Toggling a switch sticks (persisted to localStorage).
  const reduce = modal.getByRole("switch", { name: "Reduce motion" });
  await reduce.click();
  await expect(reduce).toHaveAttribute("aria-checked", "true");
});

test("release mobile breakpoints remain usable", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "single cross-breakpoint audit");
  // 6 widths × 5 tabs, with More-sheet hops at phone widths — give the sweep
  // double the default budget.
  test.setTimeout(60_000);
  for (const width of [320, 375, 390, 430, 768, 1280]) {
    await page.setViewportSize({ width, height: width >= 768 ? 800 : 844 });
    await goHome(page);
    for (const tab of ["Focus", "Tasks", "Rooms", "Analytics", "Premium"]) {
      await goTab(page, tab);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${tab} overflows at ${width}px`).toBeLessThanOrEqual(1);
    }
  }
});

test("Spotify and Apple Music stay fully closed until intentionally opened", async ({ page }) => {
  await goHome(page);
  // Fresh load: the Music panel offers both services, but NO streaming iframe
  // exists anywhere and the floating dock isn't mounted — music is closed
  // until the user asks for it.
  const panel = page.getByRole("main");
  await expect(panel.getByRole("button", { name: "Spotify", exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Apple Music", exact: true })).toBeVisible();
  await expect(page.getByTestId("music-dock")).toHaveCount(0);
  await expect(page.locator('iframe[title="Music player"]')).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // Intentionally picking a service starts music: the dock mounts with that
  // service's player and the choice persists.
  await panel.getByRole("button", { name: "Apple Music", exact: true }).click();
  const dock = page.getByTestId("music-dock");
  await expect(dock).toBeVisible();
  const expand = dock.getByRole("button", { name: "Expand music player" });
  if (await expand.isVisible()) await expand.click(); // phones start minimized
  await expect(dock.getByRole("button", { name: "Apple Music", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('iframe[title="Music player"]').first()).toHaveAttribute("src", /embed\.music\.apple\.com/);
  expect(await page.evaluate(() => localStorage.getItem("roamly-music-service"))).toBe("apple");
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
