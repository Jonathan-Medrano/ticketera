import { test, expect, type Page } from "@playwright/test"

/**
 * Página pública de detalle de evento (`/t/[tenant]/evento/[id]`) — lista de
 * categorías de entradas ahora colapsada por defecto
 * (components/tenant/evento-detalle-sections.tsx, EventoDetalleTicketsSection).
 *
 * Antes: cada categoría siempre se mostraba como card grande expandido.
 * Ahora: categorías CON stock arrancan como fila compacta (nombre + precio);
 * tocarla la expande al card completo (stepper + "Agregar"). Una categoría con
 * cantidad>0 queda expandida sola. Categorías AGOTADAS no cambian: siempre
 * card completo, tachado, botón de lista de espera — nunca colapsan.
 *
 * Fixture: tenant "empresaprueba" (es_prueba=true), evento "PRUEBA POS
 * Entradas" (id eac9827c-4518-4cee-9579-27efed89d9eb), 3 categorías:
 * Early Bird ($6.000, agotado), General ($8.000, con stock), VIP ($15.000, con
 * stock) — mismo fixture documentado en dashboard-evento-detalle.spec.ts.
 *
 * Página pública, sin auth — no requiere storageState.
 *
 * NOTA sobre "colapsar de vuelta": el componente no tiene una acción para
 * volver a colapsar una fila ya expandida (ni por accidente ni a propósito) —
 * `manuallyExpanded` es un Set que solo crece. El punto 4 del brief ("colapsá
 * cualquier otra categoría que hayas tocado por error") no es una acción
 * disponible en la UI actual; lo que SÍ se valida acá es la garantía real: una
 * categoría con cantidad>0 permanece expandida pase lo que pase en otras filas.
 */

const EVENTO_URL = "/t/empresaprueba/evento/eac9827c-4518-4cee-9579-27efed89d9eb"

function trackDiagnostics(page: Page) {
  const pageErrors: Error[] = []
  page.on("pageerror", (err) => pageErrors.push(err))
  return pageErrors
}

test.describe("storefront - detalle de evento - categorias de entradas colapsadas (empresaprueba)", () => {
  test("categorias con stock arrancan colapsadas; agotada sigue igual que antes", async ({ page }) => {
    const pageErrors = trackDiagnostics(page)
    const response = await page.goto(EVENTO_URL, { waitUntil: "networkidle" })
    expect(response!.status()).toBeLessThan(400)

    await expect(page.getByText("Entradas disponibles", { exact: true })).toBeVisible()

    // --- General y VIP (con stock) arrancan como fila compacta, SIN stepper visible ---
    const generalRow = page.getByRole("button", { name: /General/ })
    const vipRow = page.getByRole("button", { name: /VIP/ })
    await expect(generalRow, "General debe arrancar como fila colapsada (clickeable)").toBeVisible()
    await expect(vipRow, "VIP debe arrancar como fila colapsada (clickeable)").toBeVisible()

    // Ninguna de las dos debe mostrar stepper -/+ ni boton "Agregar" todavia.
    await expect(page.getByLabel("Agregar unidad")).toHaveCount(0)
    await expect(page.getByRole("button", { name: /^Agregar$/ })).toHaveCount(0)

    // --- Early Bird (agotada) sigue como card completo, tachada, con lista de espera ---
    const agotadaText = page.getByText("Early Bird", { exact: false }).first()
    await expect(agotadaText).toBeVisible()
    await expect(page.getByText("Agotado", { exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: /lista de espera/i })).toBeVisible()
    // La agotada NO debe ser un <button> colapsable como General/VIP (ya viene expandida).
    await expect(page.getByRole("button", { name: /^Early Bird/ })).toHaveCount(0)

    expect(pageErrors, `pageerrors: ${pageErrors.map((e) => e.message).join(" | ")}`).toEqual([])
  })

  test("tocar una fila colapsada la expande (stepper + Agregar)", async ({ page }) => {
    const pageErrors = trackDiagnostics(page)
    await page.goto(EVENTO_URL, { waitUntil: "networkidle" })

    const generalRow = page.getByRole("button", { name: /General/ })
    await generalRow.click()

    // Ahora debe mostrar el card completo: stepper -/+ y boton Agregar.
    await expect(page.getByLabel("Quitar unidad").first()).toBeVisible()
    await expect(page.getByLabel("Agregar unidad").first()).toBeVisible()
    const agregarBtn = page.getByRole("button", { name: /^Agregar$|Ventas pausadas/ }).first()
    await expect(agregarBtn).toBeVisible()

    // VIP sigue colapsada (no se expandio por tocar General).
    await expect(page.getByRole("button", { name: /^VIP/ })).toBeVisible()
    await expect(page.getByLabel("Agregar unidad")).toHaveCount(1)

    expect(pageErrors, `pageerrors: ${pageErrors.map((e) => e.message).join(" | ")}`).toEqual([])
  })

  test("cantidad>0 mantiene la categoria expandida; dos categorias expandidas son independientes (no accordion)", async ({
    page,
  }) => {
    const pageErrors = trackDiagnostics(page)
    await page.goto(EVENTO_URL, { waitUntil: "networkidle" })

    // Expandir General y sumar 1 unidad.
    await page.getByRole("button", { name: /General/ }).click()
    const generalPlus = page.getByLabel("Agregar unidad").first()
    await generalPlus.click()
    await expect(page.getByText("1", { exact: true }).first()).toBeVisible()

    // Expandir VIP tambien (sigue siendo un boton colapsado hasta ahora).
    const vipRowBtn = page.getByRole("button", { name: /^VIP/ })
    await expect(vipRowBtn).toBeVisible()
    await vipRowBtn.click()

    // Con ambas expandidas debe haber 2 pares de stepper +/-.
    await expect(page.getByLabel("Agregar unidad")).toHaveCount(2)
    await expect(page.getByLabel("Quitar unidad")).toHaveCount(2)

    // Sumar 2 unidades a VIP sin que General se resetee o se colapse.
    const vipPlus = page.getByLabel("Agregar unidad").nth(1)
    await vipPlus.click()
    await vipPlus.click()

    // Confirmamos cantidades independientes: General=1, VIP=2 -- ninguna se piso.
    const quantitySpans = page.locator("span.w-6.text-center.font-bold")
    await expect(quantitySpans).toHaveCount(2)
    await expect(quantitySpans.nth(0)).toHaveText("1")
    await expect(quantitySpans.nth(1)).toHaveText("2")

    // General sigue expandida (cantidad>0) -- su boton +/- y "Agregar" siguen visibles.
    await expect(page.getByLabel("Quitar unidad").first()).toBeVisible()

    expect(pageErrors, `pageerrors: ${pageErrors.map((e) => e.message).join(" | ")}`).toEqual([])
  })

  test("agregar al carrito funciona y la confirmacion 'Agregado' se ve sin romperse", async ({ page }) => {
    const pageErrors = trackDiagnostics(page)
    await page.goto(EVENTO_URL, { waitUntil: "networkidle" })

    await page.getByRole("button", { name: /General/ }).click()
    await page.getByLabel("Agregar unidad").first().click()

    const agregarBtn = page.getByRole("button", { name: /^Agregar$/ }).first()
    const ventasPausadas = page.getByRole("button", { name: /Ventas pausadas/ }).first()

    if (await ventasPausadas.isVisible().catch(() => false)) {
      // Fixture sin proveedor de pagos configurado -- estado esperado distinto,
      // no un bug de ESTE cambio (colapsado). Lo dejamos anotado en el reporte.
      test.info().annotations.push({
        type: "info",
        description: "canSell=false en este fixture (botón deshabilitado 'Ventas pausadas') — no se pudo probar el flujo de agregar al carrito end-to-end.",
      })
    } else {
      await expect(agregarBtn).toBeEnabled()
      await agregarBtn.click()
      await expect(page.getByRole("button", { name: /Agregado/ }).first()).toBeVisible()
    }

    expect(pageErrors, `pageerrors: ${pageErrors.map((e) => e.message).join(" | ")}`).toEqual([])
  })

  // El CTA sticky real de esta pagina es "Agregar al carrito" (evento-detalle.tsx:308-325,
  // dispara handleAgregarTodo) -- SOLO visible en mobile (`md:hidden`). El componente
  // EventoDetalleStickyCheckout (con texto "Ir al checkout") que se ve en
  // evento-detalle-sections.tsx esta exportado pero NO se usa en ningun lado del
  // proyecto (confirmado via grep) -- no es parte del flujo real, no lo probamos.
  test("CTA sticky mobile ('Agregar al carrito') sigue funcionando sin romperse", async ({ page }) => {
    test.skip(test.info().project.name !== "chromium-mobile", "el CTA sticky solo se renderiza en mobile (md:hidden)")
    const pageErrors = trackDiagnostics(page)
    await page.goto(EVENTO_URL, { waitUntil: "networkidle" })

    await page.getByRole("button", { name: /General/ }).click()
    await page.getByLabel("Agregar unidad").first().click()

    const stickyBtn = page.getByRole("button", { name: /Agregar al carrito/ })
    const ventasPausadas = page.getByRole("button", { name: /Ventas pausadas/ }).first()

    if (await ventasPausadas.isVisible().catch(() => false)) {
      test.info().annotations.push({
        type: "info",
        description: "canSell=false en este fixture — no se pudo probar el CTA sticky end-to-end.",
      })
    } else {
      await expect(stickyBtn, "el CTA sticky mobile debe aparecer al tener >0 unidades seleccionadas").toBeVisible()
      await expect(page.getByText("1 entrada", { exact: false })).toBeVisible()
      await stickyBtn.click()
      // handleAgregarTodo limpia `seleccion` -> el CTA sticky debe desaparecer despues.
      await expect(stickyBtn).toBeHidden()
    }

    expect(pageErrors, `pageerrors: ${pageErrors.map((e) => e.message).join(" | ")}`).toEqual([])
  })
})
