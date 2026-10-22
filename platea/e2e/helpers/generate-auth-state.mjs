// One-off script (NOT part of the Playwright test run) that logs in once as
// the sanctioned test tenant "empresaprueba" and dumps the resulting session
// cookie to e2e/.auth/empresaprueba.json, so the actual spec files can reuse
// it via `test.use({ storageState: AUTH_FILE })` instead of logging in on
// every test. This matters because login is rate-limited in-process (5
// attempts / 15 min, see auth.ts) — logging in once here avoids tripping it
// again across a whole suite run.
//
// Usage: node e2e/helpers/generate-auth-state.mjs [baseURL]
import { chromium } from "@playwright/test"
import { mkdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const AUTH_DIR = path.join(__dirname, "..", ".auth")
const AUTH_FILE = path.join(AUTH_DIR, "empresaprueba.json")
const BASE_URL = process.argv[2] || "http://localhost:3000"

const EMAIL = "empresaprueba@ticketera.test"
const PASSWORD = "Prueba1234"

async function main() {
  mkdirSync(AUTH_DIR, { recursive: true })
  const browser = await chromium.launch()
  const page = await browser.newPage()
  await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle" })
  await page.locator("#login-email").fill(EMAIL)
  await page.locator("#login-password").fill(PASSWORD)
  await page.getByRole("button", { name: "Iniciar sesión" }).click()
  await page.waitForURL(/\/dashboard/, { timeout: 15_000 })
  await page.context().storageState({ path: AUTH_FILE })
  await browser.close()
  console.log(`OK - storageState guardado en ${AUTH_FILE}`)
}

main().catch((err) => {
  console.error("FAILED:", err.message)
  process.exit(1)
})
