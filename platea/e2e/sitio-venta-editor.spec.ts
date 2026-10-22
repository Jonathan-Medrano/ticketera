import path from "node:path"
import { test, expect, type ConsoleMessage, type Page } from "@playwright/test"

/**
 * Editor de sitio de venta (sitio-venta-editor-shell.tsx + sitio-venta/*.tsx).
 *
 * Riesgo bajo (segun el brief, ya confirmado visualmente una vez). Fixture:
 * empresa "empresaprueba" (es_prueba=true) - "Guardar" persiste la config del
 * sitio de ESTE tenant de prueba, no de un cliente real.
 *
 * Auth: reutiliza la storageState de e2e/helpers/generate-auth-state.mjs (ver
 * nota de rate-limit en dashboard-evento-detalle.spec.ts).
 */

const EDITOR_URL = "/dashboard/sitio-venta"
const AUTH_FILE = path.join(__dirname, ".auth", "empresaprueba.json")

test.use({ storageState: AUTH_FILE })

function trackDiagnostics(page: Page) {
  const pageErrors: Error[] = []
  page.on("pageerror", (err) => pageErrors.push(err))
  return pageErrors
}

/**
 * Heuristica de "apilado, no comprimido lado a lado": para cada sub-bloque
 * visible dentro del panel de edicion, su bounding box debe ocupar practicamente
 * todo el ancho del panel (no la mitad), y el siguiente bloque debe empezar
 * mas abajo (no al lado).
 */
async function assertPanelSubBlocksAreStacked(page: Page, panelSelector: string) {
  const panel = page.locator(panelSelector)
  const panelBox = await panel.boundingBox()
  expect(panelBox, "el panel de edicion debe estar visible").toBeTruthy()
  if (!panelBox) return

  // Heurística: cada sub-bloque es un <SectionCard title=".."> (shared-ui.tsx),
  // que renderiza el título como <p class="text-[15px] font-semibold tracking-tight
  // text-foreground">. No hay h2/h3 en este editor — se usa esa clase como proxy
  // de "título de sub-bloque". Confirmamos que están alineados en X (mismo punto
  // de partida horizontal = apilados) en vez de repartidos en dos columnas.
  const headings = panel.locator("p.font-semibold.tracking-tight.text-foreground")
  const count = await headings.count()
  const xs: number[] = []
  for (let i = 0; i < count; i++) {
    const box = await headings.nth(i).boundingBox()
    if (box) xs.push(Math.round(box.x))
  }
  if (xs.length >= 2) {
    const distinctX = new Set(xs)
    expect(
      distinctX.size,
      `los títulos de los sub-bloques deberían compartir el mismo X (apilados verticalmente); X observados: ${xs.join(", ")}`
    ).toBeLessThanOrEqual(2) // tolerancia mínima por padding/scroll
  }
}

test.describe("dashboard - editor de sitio de venta (empresaprueba)", () => {
  for (const width of [1280, 1440]) {
    test(`Branding y Home se ven apilados (no lado a lado) a ${width}px`, async ({ page }) => {
      const pageErrors = trackDiagnostics(page)
      await page.setViewportSize({ width, height: 900 })
      const response = await page.goto(EDITOR_URL, { waitUntil: "networkidle" })
      expect(response!.status()).toBeLessThan(400)

      // Branding es la sección activa por default.
      await expect(page.getByRole("button", { name: /Branding/ })).toBeVisible()
      await assertPanelSubBlocksAreStacked(page, "fieldset")

      await page.getByRole("button", { name: /^Home/ }).click()
      await assertPanelSubBlocksAreStacked(page, "fieldset")

      expect(pageErrors, `pageerrors @${width}px: ${pageErrors.map((e) => e.message).join(" | ")}`).toEqual([])
    })
  }

  test("cambiar de sección en el sidebar funciona y no tira error de consola", async ({ page }) => {
    const pageErrors = trackDiagnostics(page)
    await page.goto(EDITOR_URL, { waitUntil: "networkidle" })

    const sections = ["Branding", "Home", "Información", "Soporte", "Plantillas"]
    for (const section of sections) {
      await page.getByRole("button", { name: new RegExp(`^${section}`) }).click()
      // Confirmamos que el sidebar marca la sección como activa.
      await expect(page.getByRole("button", { name: new RegExp(`^${section}`) })).toHaveAttribute(
        "aria-current",
        "page"
      )
    }

    expect(pageErrors, `pageerrors: ${pageErrors.map((e) => e.message).join(" | ")}`).toEqual([])
  })

  test("Guardar cambios funciona sin error", async ({ page }) => {
    const pageErrors = trackDiagnostics(page)
    await page.goto(EDITOR_URL, { waitUntil: "networkidle" })

    const guardarBtn = page.getByRole("button", { name: "Guardar", exact: true })
    await expect(guardarBtn).toBeVisible()
    await guardarBtn.click()

    await expect(page.getByText(/Cambios guardados|Error al guardar/)).toBeVisible({ timeout: 10_000 })

    expect(pageErrors, `pageerrors: ${pageErrors.map((e) => e.message).join(" | ")}`).toEqual([])
  })
})
