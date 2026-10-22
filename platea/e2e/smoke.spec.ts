import { test, expect, type ConsoleMessage } from "@playwright/test"

/**
 * Smoke tests — NO login required.
 *
 * Goal: confirm the two public, unauthenticated entry surfaces actually render
 * their key elements and do not blow up with a fatal runtime error. These are
 * the safest things to test before a test user / auth setup exists (see
 * e2e/README.md for what authenticated flows like the POS need).
 *
 * "Fatal" here = an uncaught exception in the page (pageerror). Plain
 * console.error lines are collected and surfaced in the test output for triage
 * but do not fail the run on their own (Next dev + 3rd-party libs are noisy).
 */

type PageDiagnostics = {
  pageErrors: Error[]
  consoleErrors: string[]
}

function trackDiagnostics(page: import("@playwright/test").Page): PageDiagnostics {
  const diagnostics: PageDiagnostics = { pageErrors: [], consoleErrors: [] }

  page.on("pageerror", (err) => {
    diagnostics.pageErrors.push(err)
  })

  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() === "error") {
      diagnostics.consoleErrors.push(msg.text())
    }
  })

  return diagnostics
}

test.describe("public surfaces smoke", () => {
  test("empresa login (/login) renders key elements and has no fatal errors", async ({ page }) => {
    const diagnostics = trackDiagnostics(page)

    const response = await page.goto("/login", { waitUntil: "networkidle" })

    // 1. The route responded (not a 5xx).
    expect(response, "navigation should return a response").not.toBeNull()
    expect(response!.status(), "login route should not be a server error").toBeLessThan(400)

    // 2. Key elements of the login form are actually present (behavior, not just "it rendered").
    await expect(
      page.getByRole("heading", { name: "Bienvenido de vuelta" }),
      "login card heading should be visible"
    ).toBeVisible()
    await expect(page.locator("#login-email"), "email field should be visible").toBeVisible()
    await expect(page.locator("#login-password"), "password field should be visible").toBeVisible()
    await expect(
      page.getByRole("button", { name: "Iniciar sesión" }),
      "submit button should be visible"
    ).toBeVisible()

    // 3. The login/registro tabs exist (the surface mounted, not a fallback error page).
    await expect(page.getByRole("tab", { name: "Crear cuenta" })).toBeVisible()

    // 4. No uncaught runtime exception fried the page.
    expect(
      diagnostics.pageErrors,
      `uncaught page errors: ${diagnostics.pageErrors.map((e) => e.message).join(" | ")}`
    ).toEqual([])

    // Surface console errors for triage without failing the smoke run.
    if (diagnostics.consoleErrors.length > 0) {
      console.warn(
        `[/login] console.error lines (non-fatal):\n - ${diagnostics.consoleErrors.join("\n - ")}`
      )
    }
  })

  test("public landing (/) renders the navbar brand and has no fatal errors", async ({ page }) => {
    const diagnostics = trackDiagnostics(page)

    const response = await page.goto("/", { waitUntil: "networkidle" })

    expect(response, "navigation should return a response").not.toBeNull()
    expect(response!.status(), "landing route should not be a server error").toBeLessThan(400)

    // Brand wordmark / logo link is in the navbar on the public landing.
    await expect(
      page.getByRole("link", { name: "Ticketera" }).first(),
      "navbar brand link should be visible"
    ).toBeVisible()

    // The main content landmark must exist (landing actually mounted).
    await expect(page.locator("#main-content")).toBeAttached()

    expect(
      diagnostics.pageErrors,
      `uncaught page errors: ${diagnostics.pageErrors.map((e) => e.message).join(" | ")}`
    ).toEqual([])

    if (diagnostics.consoleErrors.length > 0) {
      console.warn(
        `[/] console.error lines (non-fatal):\n - ${diagnostics.consoleErrors.join("\n - ")}`
      )
    }
  })
})
