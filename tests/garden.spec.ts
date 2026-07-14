import { test, expect, type Page } from "@playwright/test";

// Garden / companions suite (signed-out guest mode, no auth backend). The Garden
// is an account-only feature, so guests see a locked sign-in gate; the signed-in
// experience needs a backend and isn't exercised here. Suppress the first-run
// tutorial like the smoke suite.

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => localStorage.setItem("roamly-tutorial-seen", "1"));
});

async function goHome(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Select timer" })).toBeVisible();
}

test("Garden tab is locked for guests and routes to sign-in", async ({ page }) => {
  await goHome(page);
  await page.getByRole("button", { name: "Garden", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sign in to unlock your Garden" })).toBeVisible();
  // Neither the collection nor companion controls are exposed to guests.
  await expect(page.getByRole("heading", { name: "Companions" })).toHaveCount(0);
  await expect(page.getByRole("switch", { name: "Show companions on the timer" })).toHaveCount(0);
  // The lock screen's sign-in button opens the auth modal.
  await page.getByRole("button", { name: "Sign in" }).last().click();
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
});

test("companions are off the timer by default", async ({ page }) => {
  await goHome(page);
  // Companions default off (and the toggle lives behind the account-only
  // Garden), so a guest never gets pets on the timer.
  await expect(page.getByRole("button", { name: "Too distracting" })).toHaveCount(0);
});

test("no horizontal overflow on the Garden tab", async ({ page }) => {
  await goHome(page);
  await page.getByRole("button", { name: "Garden", exact: true }).click();
  await page.waitForTimeout(250);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "Garden tab overflows horizontally").toBeLessThanOrEqual(1);
});
