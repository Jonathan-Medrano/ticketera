import path from "node:path"
import { test, expect, type ConsoleMessage, type Page } from "@playwright/test"

/**
 * Dashboard admin - vista "Ver evento" (evento-detalle-content.tsx).
 *
 * Fixture: empresa "empresaprueba" (es_prueba=true, sancionada para QA),
 * evento "PRUEBA POS Entradas" (eac9827c-4518-4cee-9579-27efed89d9eb), 3
 * categorias: General (stock_disponible=97), VIP (30), Early Bird (0).
 *
 * MUTA datos reales de ESTE tenant de prueba a proposito (agregar stock,
 * toggles). Nunca corrido contra un tenant real. Ver e2e/README.md.
 *
 * Auth: reutiliza la storageState generada por
 * e2e/helpers/generate-auth-state.mjs (login UNA sola vez) en vez de loguear
 * por test — el login tiene rate-limit in-process (5 intentos/15min, ver
 * auth.ts en la raíz de platea/), y esta suite por si sola ya tiene 5 tests.
 * Correr `node e2e/helpers/generate-auth-state.mjs` antes si el archivo no
 * existe o venció la sesión.
 */

const EVENTO_ID = "eac9827c-4518-4cee-9579-27efed89d9eb"
const EVENTO_URL = `/dashboard/eventos/${EVENTO_ID}`
const AUTH_FILE = path.join(__dirname, ".auth", "empresaprueba.json")

test.use({ storageState: AUTH_FILE })

function trackDiagnostics(page: Page) {
  const pageErrors: Error[] = []
  page.on("pageerror", (err) => pageErrors.push(err))
  return pageErrors
}

test.describe("dashboard - detalle de evento (empresaprueba)", () => {
  test("hero + tabs cargan sin error y cambian de contenido", async ({ page }) => {
    const pageErrors = trackDiagnostics(page)
    const response = await page.goto(EVENTO_URL, { waitUntil: "networkidle" })
    expect(response!.status()).toBeLessThan(400)

    await expect(page.getByRole("heading", { name: "PRUEBA POS Entradas" })).toBeVisible()

    // Tab Resumen es default.
    await expect(page.getByText("Capacidad total")).toBeVisible()

    // Tab Categorias y productos
    await page.getByRole("tab", { name: "Categorías y productos" }).click()
    await expect(page.getByText("Tandas y categorías")).toBeVisible()
    await expect(page.getByText("General").first()).toBeVisible()
    await expect(page.getByText("VIP").first()).toBeVisible()
    await expect(page.getByText("Early Bird").first()).toBeVisible()

    // Tab Ventas
    await page.getByRole("tab", { name: /^Ventas/ }).click()
    // Con ventas o el empty-state; cualquiera de los dos confirma que la tab montó.
    const ventasEmptyState = page.getByText("Todavía no hay ventas para este evento")
    const ventasTable = page.locator("table")
    await expect(ventasEmptyState.or(ventasTable).first()).toBeVisible()

    expect(pageErrors, `pageerrors: ${pageErrors.map((e) => e.message).join(" | ")}`).toEqual([])
  })

  test("botones de icono por fila de categoria no mezclan ids entre filas", async ({ page }) => {
    const pageErrors = trackDiagnostics(page)
    await page.goto(EVENTO_URL, { waitUntil: "networkidle" })
    await page.getByRole("tab", { name: "Categorías y productos" }).click()

    // Fila de "General": abrir modal de stock y confirmar que el titulo dice "General", no VIP/Early Bird.
    await page.getByLabel("Agregar stock a General").click()
    await expect(page.getByRole("heading", { name: "Agregar stock — General" })).toBeVisible()
    await page.getByRole("button", { name: "Cancelar" }).click()

    // Fila de "VIP": mismo modal, distinto id -> debe decir VIP.
    await page.getByLabel("Agregar stock a VIP").click()
    await expect(page.getByRole("heading", { name: "Agregar stock — VIP" })).toBeVisible()
    await page.getByRole("button", { name: "Cancelar" }).click()

    // Cambiar precio: mismo chequeo cruzado.
    await page.getByLabel("Cambiar precio de General").click()
    await expect(page.getByRole("heading", { name: "Cambiar precio — General" })).toBeVisible()
    await page.getByRole("button", { name: "Cancelar" }).click()

    await page.getByLabel("Cambiar precio de VIP").click()
    await expect(page.getByRole("heading", { name: "Cambiar precio — VIP" })).toBeVisible()
    await page.getByRole("button", { name: "Cancelar" }).click()

    expect(pageErrors, `pageerrors: ${pageErrors.map((e) => e.message).join(" | ")}`).toEqual([])
  })

  test("agregar stock a una categoria sube el numero correctamente", async ({ page }) => {
    await page.goto(EVENTO_URL, { waitUntil: "networkidle" })
    await page.getByRole("tab", { name: "Categorías y productos" }).click()

    // Leemos el stock actual de VIP desde la fila (texto "X / Y stock").
    const vipRow = page.locator("div.flex.flex-wrap.items-center.justify-between", { hasText: "VIP" }).first()
    const stockTextBefore = await vipRow.locator("span.font-mono.tabular-nums.text-muted-foreground").innerText()
    const beforeDisponible = parseInt(stockTextBefore.split("/")[0].trim().replace(/\./g, ""), 10)

    await page.getByLabel("Agregar stock a VIP").click()
    await page.getByPlaceholder("Cantidad a agregar").fill("1")
    await page.getByRole("button", { name: "Agregar", exact: true }).click()

    await expect(page.getByText("Stock agregado correctamente")).toBeVisible()

    const stockTextAfter = await vipRow.locator("span.font-mono.tabular-nums.text-muted-foreground").innerText()
    const afterDisponible = parseInt(stockTextAfter.split("/")[0].trim().replace(/\./g, ""), 10)

    expect(afterDisponible, "el stock disponible debe subir en exactamente 1").toBe(beforeDisponible + 1)
  })

  test("toggle Activar/Desactivar evento cambia el estado visual sin error (y se revierte)", async ({ page }) => {
    const pageErrors = trackDiagnostics(page)
    await page.goto(EVENTO_URL, { waitUntil: "networkidle" })

    async function clickToggleAndConfirm() {
      const toggleBtn = page.getByRole("button", { name: /^(Activar|Desactivar)$/ }).first()
      const label = (await toggleBtn.innerText()).trim()
      const nextLabel = label === "Activar" ? "Desactivar" : "Activar"
      await toggleBtn.click()
      if (label === "Desactivar") {
        // Pausar es destructivo -> pide confirmación (Dialog, nunca window.confirm).
        await expect(page.getByRole("heading", { name: "Desactivar evento" })).toBeVisible()
        await page.getByRole("button", { name: "Desactivar", exact: true }).last().click()
      }
      // Espera con auto-retry a que el MISMO botón (por rol+nombre) muestre el label
      // invertido antes de devolver el control — evita releer un DOM stale si
      // router.refresh() todavía está remontando el árbol.
      await expect(page.getByRole("button", { name: nextLabel, exact: true }).first()).toBeVisible({ timeout: 10_000 })
      return label
    }

    const initialLabel = await clickToggleAndConfirm()
    await expect(
      page.getByText(initialLabel === "Desactivar" ? "Inactivo manual" : "Activo").first()
    ).toBeVisible()

    // Revertimos para dejar el fixture (empresaprueba) como estaba antes del test.
    const revertedLabel = await clickToggleAndConfirm()
    expect(revertedLabel, "el label del botón debe haberse invertido tras el primer toggle").not.toBe(initialLabel)
    await expect(page.getByText(initialLabel === "Desactivar" ? "Activo" : "Inactivo manual").first()).toBeVisible()

    expect(pageErrors, `pageerrors: ${pageErrors.map((e) => e.message).join(" | ")}`).toEqual([])
  })

  test("toggle 'Venta pública de consumibles' en tab Resumen funciona sin error (y se revierte)", async ({ page }) => {
    const pageErrors = trackDiagnostics(page)
    await page.goto(EVENTO_URL, { waitUntil: "networkidle" })

    await expect(page.getByText("Venta pública de consumibles", { exact: true })).toBeVisible()

    const checkbox = page.locator('label:has-text("Venta pública de consumibles"), label:has-text("Venta habilitada"), label:has-text("Venta deshabilitada")').locator('button[role="checkbox"]').first()

    async function toggleAndConfirm() {
      const before = await checkbox.getAttribute("data-state")
      await checkbox.click()
      const confirmHeading = page.getByRole("heading", { name: "Desactivar venta de consumibles" })
      if (await confirmHeading.isVisible({ timeout: 1500 }).catch(() => false)) {
        await page.getByRole("button", { name: "Desactivar", exact: true }).last().click()
      }
      // Espera con auto-retry a que el atributo realmente cambie (evita falsos
      // positivos por toasts de sonner que quedan visibles de la acción anterior).
      await expect(checkbox, "el estado visual del checkbox debe cambiar").not.toHaveAttribute("data-state", before ?? "")
      await expect(page.getByText(/Venta pública de consumibles (activada|desactivada)/).last()).toBeVisible()
      // Espera a que el overlay "Procesando..." (loading-provider.tsx) desaparezca
      // antes de que el próximo toggle actúe, para no clickear en medio de un refresh.
      await expect(page.getByText("Procesando...")).toBeHidden({ timeout: 10_000 }).catch(() => {})
      return checkbox.getAttribute("data-state")
    }

    const afterFirstToggle = await toggleAndConfirm()
    // Revertimos para dejar el fixture como estaba.
    const afterSecondToggle = await toggleAndConfirm()
    expect(afterSecondToggle).not.toBe(afterFirstToggle)

    expect(pageErrors, `pageerrors: ${pageErrors.map((e) => e.message).join(" | ")}`).toEqual([])
  })
})
