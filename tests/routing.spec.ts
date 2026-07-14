import { test, expect, type Page } from "@playwright/test";

// Per-tab URLs, breadcrumbs, and the wordmark home button (signed-out mode).

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => localStorage.setItem("roamly-tutorial-seen", "1"));
});

async function goHome(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Select timer" })).toBeVisible();
}

test("deep-loading /tasks renders the Tasks tab", async ({ page }) => {
  await page.goto("/tasks");
  await expect(page.getByRole("heading", { name: "Tasks", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/tasks$/);
  await expect(page).toHaveTitle(/Tasks/);
});

test("switching tabs updates the URL and back returns", async ({ page }) => {
  await goHome(page);
  await expect(page).toHaveURL(/\/focus$/); // "/" normalizes in place
  await page.getByRole("button", { name: "Analytics", exact: true }).click();
  await expect(page).toHaveURL(/\/analytics$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/focus$/);
  await expect(page.getByRole("button", { name: "Select timer" })).toBeVisible();
});

test("breadcrumb shows off-focus and navigates home", async ({ page }) => {
  await page.goto("/garden");
  const crumbs = page.getByRole("navigation", { name: "Breadcrumb" });
  await expect(crumbs).toBeVisible();
  await expect(crumbs.getByText("Garden")).toBeVisible();
  await crumbs.getByRole("button", { name: "Roamly" }).click();
  await expect(page).toHaveURL(/\/focus$/);
  await expect(crumbs).toHaveCount(0); // no breadcrumb on the home tab
});

test("wordmark returns to the Focus home screen", async ({ page }) => {
  await page.goto("/premium");
  await expect(page.getByRole("heading", { name: "Go Premium" })).toBeVisible();
  await page.getByRole("button", { name: "Go to the Focus home screen" }).click();
  await expect(page).toHaveURL(/\/focus$/);
  await expect(page.getByRole("button", { name: "Select timer" })).toBeVisible();
});

test("unknown paths fall back to Focus", async ({ page }) => {
  await page.goto("/definitely-not-a-tab");
  await expect(page.getByRole("button", { name: "Select timer" })).toBeVisible();
  await expect(page).toHaveURL(/\/focus$/);
});
