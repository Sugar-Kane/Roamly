import { test, expect, type Page } from "@playwright/test";

// Garden / companions suite (signed-out guest mode). Gamification is computed
// locally from focus history, so everyone starts with a dog + cat and a sprout
// — no backend needed. Suppress the first-run tutorial like the smoke suite.

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => localStorage.setItem("roamly-tutorial-seen", "1"));
});

async function goHome(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Select timer" })).toBeVisible();
}

test("Garden tab shows level, companions and rewards", async ({ page }) => {
  await goHome(page);
  await page.getByRole("button", { name: "Garden", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Garden", exact: true })).toBeVisible();
  await expect(page.getByText(/^Level \d+/).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Achievements" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Companions" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Level rewards" })).toBeVisible();
  // Everyone starts with the dog and cat.
  await expect(page.getByText("Pip the Pup")).toBeVisible();
  await expect(page.getByText("Mochi the Cat")).toBeVisible();
  // A locked pet shows its session requirement.
  await expect(page.getByText(/more sessions?/).first()).toBeVisible();
});

test("companions are off by default", async ({ page }) => {
  await goHome(page);
  // Opt-in per device: nothing on the timer until the user enables it.
  await expect(page.getByRole("button", { name: "Too distracting" })).toHaveCount(0);
  await page.getByRole("button", { name: "Garden", exact: true }).click();
  await expect(page.getByText("Companions are hidden on your timer.")).toBeVisible();
});

test("enabling companions rides the solo timer and the sleep button toggles", async ({ page }) => {
  await goHome(page);
  await page.getByRole("button", { name: "Garden", exact: true }).click();
  await page.getByRole("switch", { name: "Show companions on the timer" }).click();
  await page.getByRole("button", { name: "Focus", exact: true }).click();
  // The pet stage is drawn on a canvas over the timer, and the "too distracting"
  // control appears alongside the focus controls.
  await expect(page.locator("canvas").first()).toBeVisible();
  const sleep = page.getByRole("button", { name: "Too distracting" });
  await expect(sleep).toBeVisible();
  await sleep.click();
  await expect(page.getByRole("button", { name: "Wake pets" })).toBeVisible();
});

test("no horizontal overflow on the Garden tab", async ({ page }) => {
  await goHome(page);
  await page.getByRole("button", { name: "Garden", exact: true }).click();
  await page.waitForTimeout(250);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "Garden tab overflows horizontally").toBeLessThanOrEqual(1);
});
