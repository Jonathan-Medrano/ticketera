import type { Page } from "@playwright/test"

/**
 * Login as the sanctioned test/demo empresa "empresaprueba" (es_prueba=true,
 * dominio @ticketera.test). NEVER use real client credentials here.
 * Credentials documented in backend/scripts/seed-empresaprueba.mjs.
 */
export const EMPRESA_PRUEBA_EMAIL = "empresaprueba@ticketera.test"
export const EMPRESA_PRUEBA_PASSWORD = "Prueba1234"
export const EMPRESA_PRUEBA_SLUG = "empresaprueba"

export async function loginAsEmpresaPrueba(page: Page) {
  await page.goto("/login", { waitUntil: "networkidle" })
  await page.locator("#login-email").fill(EMPRESA_PRUEBA_EMAIL)
  await page.locator("#login-password").fill(EMPRESA_PRUEBA_PASSWORD)
  await page.getByRole("button", { name: "Iniciar sesión" }).click()
  await page.waitForURL(/\/dashboard/, { timeout: 15_000 })
}
