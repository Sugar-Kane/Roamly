import { defineConfig, devices } from "@playwright/test";

// Smoke tests run against the production build served by `vite preview`.
// Build first (CI does `npm run build` with placeholder VITE_SUPABASE_* vars
// so the real auth UI renders without touching a live backend).
// PLAYWRIGHT_EXECUTABLE_PATH lets environments with a pre-installed Chromium
// (e.g. the hosted dev sandbox) skip `playwright install`.
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;

export default defineConfig({
  testDir: "tests",
  timeout: 30_000,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:4173",
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  projects: [
    { name: "mobile", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium", viewport: { width: 390, height: 844 } } },
    { name: "desktop", use: { viewport: { width: 1280, height: 800 } } },
  ],
  webServer: {
    command: "npm run preview -- --port 4173 --strictPort",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
