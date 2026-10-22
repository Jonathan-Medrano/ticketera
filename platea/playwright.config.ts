import { defineConfig, devices } from "@playwright/test"

/**
 * Playwright E2E config for TICKETERA frontend (platea/).
 *
 * The dev server is NOT started by Playwright on purpose: it is brought up
 * separately by the `dev-up` script (frontend on http://localhost:3000, plus
 * the backend it needs). Run `dev-up` FIRST, then `npm run test:e2e`.
 *
 * If you later want Playwright to manage the server itself, uncomment the
 * `webServer` block below.
 */

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000"

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  // Fail the build on CI if test.only is committed by mistake.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Keep it serial-friendly locally; bump workers on CI if desired.
  workers: process.env.CI ? 1 : undefined,
  reporter: [["list"], ["html", { open: "never" }]],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium-desktop",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chromium-mobile",
      use: { ...devices["Pixel 7"] },
    },
  ],

  // --- Optional: let Playwright start/stop the dev server itself ---
  // webServer: {
  //   command: "npm run dev",
  //   url: BASE_URL,
  //   timeout: 120_000,
  //   reuseExistingServer: !process.env.CI,
  // },
})
