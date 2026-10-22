import { test, expect, type ConsoleMessage, type Page } from "@playwright/test"

/**
 * Storefront publico - flujo de compra (evento-detalle-sections.tsx).
 *
 * Fixture: tenant "empresaprueba" (es_prueba=true, sancionado para QA - ver
 * backend/scripts/seed-empresaprueba.mjs), evento "PRUEBA POS Entradas"
 * (lugar="Club de Prueba", 3 categorias: General c/stock, VIP c/stock,
 * Early Bird AGOTADA). Confirmado por lectura directa (read-only) de la DB
 * antes de escribir estos tests - no se asume la data, se verifico.
 *
 * Alto riesgo: este es el checkout real. NO se completa un pago real (no se
 * navega a Mercado Pago) - se valida hasta el CTA "Ir al checkout".
 */

const TENANT_SLUG = "empresaprueba"
const EVENTO_ID = "eac9827c-4518-4cee-9579-27efed89d9eb"
const EVENTO_URL = `/t/${TENANT_SLUG}/evento/${EVENTO_ID}`
const LUGAR = "Club de Prueba"

function trackDiagnostics(page: Page) {
  const pageErrors: Error[] = []
  const consoleErrors: string[] = []
  page.on("pageerror", (err) => pageErrors.push(err))
  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() === "error") consoleErrors.push(msg.text())
  })
  return { pageErrors, consoleErrors }
}

test.describe("storefront - detalle de evento y checkout", () => {
  test("carga sin error y muestra el hero + stats", async ({ page }) => {
    const diag = trackDiagnostics(page)
    const response = await page.goto(EVENTO_URL, { waitUntil: "networkidle" })

    expect(response, "debe responder").not.toBeNull()
    expect(response!.status(), "no debe ser error de servidor").toBeLessThan(400)
    await expect(page.getByRole("heading", { name: "PRUEBA POS Entradas" })).toBeVisible()

    expect(diag.pageErrors, `pageerrors: ${diag.pageErrors.map((e) => e.message).join(" | ")}`).toEqual([])
  })

  test("link Como llegar apunta a google maps con el lugar correcto y no rompe el layout", async ({ page }) => {
    await page.goto(EVENTO_URL, { waitUntil: "networkidle" })

    const link = page.getByRole("link", { name: "Cómo llegar" })
    await expect(link, "el link Como llegar debe existir cuando el evento tiene lugar cargado").toBeVisible()

    const href = await link.getAttribute("href")
    expect(href).toBe(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(LUGAR)}`)
    await expect(link).toHaveAttribute("target", "_blank")
    await expect(link).toHaveAttribute("rel", "noopener noreferrer")

    // Layout: el nombre del lugar sigue visible y truncado a la izquierda, el link no lo empuja fuera.
    const lugarSpan = page.locator("span.truncate.flex-1.min-w-0", { hasText: LUGAR })
    await expect(lugarSpan).toBeVisible()

    // El link y el span de lugar deben estar en la misma fila (misma altura aprox.) - no wrap roto.
    const lugarBox = await lugarSpan.boundingBox()
    const linkBox = await link.boundingBox()
    expect(lugarBox && linkBox).toBeTruthy()
    if (lugarBox && linkBox) {
      const verticalOverlap = Math.abs(lugarBox.y - linkBox.y) < lugarBox.height
      expect(verticalOverlap, "el link Como llegar debe estar en la misma fila que el lugar, no en una linea aparte rota").toBe(true)
    }
  })

  test("categoria agotada (Early Bird): nombre tachado, card con opacidad reducida, y WaitlistButton funcional", async ({ page }) => {
    // BUG CONFIRMADO (backend, no frontend): el endpoint GET /tenant/:slug/evento/:id
    // (backend/src/routes/tenant.ts:2598, y su gemelo en la sub-ruta /categorias:2107)
    // filtra "AND ec.stock_disponible > 0" en la query SQL. Esto significa que la
    // categoria Early Bird (stock_disponible=0) NUNCA llega al payload que consume
    // esta pagina (platea/app/t/[tenant]/evento/[id]/page.tsx linea 111), por lo
    // tanto el bloque "isAgotado" de evento-detalle-sections.tsx (linea 274 en
    // adelante: line-through, opacity-60, WaitlistButton) es código inalcanzable
    // en este flujo real. Este test documenta el criterio del brief y FALLA a
    // proposito para dejar evidencia reproducible.
    const diag = trackDiagnostics(page)
    await page.goto(EVENTO_URL, { waitUntil: "networkidle" })

    const nombre = page.getByText("Early Bird", { exact: true })
    await expect(nombre).toBeVisible()
    await expect(nombre, "el nombre de la categoria agotada debe estar tachado").toHaveClass(/line-through/)

    const agotadaCardOpacity = page.locator(".opacity-60", { has: nombre })
    await expect(agotadaCardOpacity, "la card de la categoria agotada debe tener opacity-60").toHaveCount(1)

    await expect(page.getByText("Agotado", { exact: true }).first()).toBeVisible()

    // WaitlistButton: para la categoria agotada, no debe existir stepper +/- ni boton Agregar.
    const waitlistBtn = page.getByRole("button", { name: "Anotarme en lista de espera" })
    await expect(waitlistBtn, "debe aparecer el boton de lista de espera para la categoria agotada").toBeVisible()

    await waitlistBtn.click()
    await expect(page.getByRole("heading", { name: "Lista de espera" })).toBeVisible()
    await expect(page.getByText("Early Bird", { exact: false }).first()).toBeVisible()

    // Confirmamos que el submit no rompe la pagina (puede fallar por falta de sesion de
    // comprador - eso es aceptable; lo que NO es aceptable es un crash de runtime).
    await page.getByRole("button", { name: "Anotarme", exact: true }).click()
    await page.waitForTimeout(1000)

    expect(diag.pageErrors, `pageerrors tras click en waitlist: ${diag.pageErrors.map((e) => e.message).join(" | ")}`).toEqual([])
  })

  test("categorias con stock (General/VIP): stepper +/- y agregar al carrito funcionan", async ({ page }) => {
    const diag = trackDiagnostics(page)
    await page.goto(EVENTO_URL, { waitUntil: "networkidle" })

    const generalCard = page.locator("div.rounded-2xl.p-4.border", { hasText: "General" }).first()
    await expect(generalCard).toBeVisible()

    const plusBtn = generalCard.getByRole("button", { name: "Agregar unidad" })
    const minusBtn = generalCard.getByRole("button", { name: "Quitar unidad" })
    const cantidadSpan = generalCard.locator("span.w-6.text-center.font-bold")

    await expect(cantidadSpan).toHaveText("0")
    await expect(minusBtn, "quitar debe estar disabled en 0").toBeDisabled()

    await plusBtn.click()
    await expect(cantidadSpan).toHaveText("1")
    await plusBtn.click()
    await expect(cantidadSpan).toHaveText("2")
    await minusBtn.click()
    await expect(cantidadSpan).toHaveText("1")

    const agregarBtn = generalCard.getByRole("button", { name: /Agregar$/ })
    await expect(agregarBtn, "con cantidad > 0 el boton Agregar debe estar habilitado").toBeEnabled()
    await agregarBtn.click()
    await expect(generalCard.getByRole("button", { name: /Agregado/ })).toBeVisible()

    // El badge del carrito en la navbar debe reflejar el item agregado.
    await expect(page.getByRole("link", { name: /Ver carrito/ })).toContainText("1")

    expect(diag.pageErrors, `pageerrors: ${diag.pageErrors.map((e) => e.message).join(" | ")}`).toEqual([])
  })

  test("CTA sticky con el total: NO existe en desktop; en mobile es un bloque distinto al descripto ('Agregar al carrito', no 'Ir al checkout')", async ({ page, isMobile }) => {
    // HALLAZGO: `EventoDetalleStickyCheckout` (evento-detalle-sections.tsx linea 559,
    // texto "Ir al checkout →") NO esta importado/renderizado por ningun componente
    // del repo (unico match de "EventoDetalleStickyCheckout" es su propia definicion).
    // Es codigo huerfano. El unico CTA inferior real vive inline en
    // components/tenant/evento-detalle.tsx lineas 301-318: es `md:hidden` (invisible
    // en tablet/desktop >=768px), dice "Agregar al carrito" (no "Ir al checkout"), y
    // desaparece su semantica de "total ya agregado" porque solo refleja la seleccion
    // pendiente del stepper (useState `seleccion`), no lo ya confirmado con "Agregar".
    const diag = trackDiagnostics(page)
    await page.goto(EVENTO_URL, { waitUntil: "networkidle" })

    const generalCard = page.locator("div.rounded-2xl.p-4.border", { hasText: "General" }).first()
    await generalCard.getByRole("button", { name: "Agregar unidad" }).click()

    const irAlCheckout = page.locator("button", { hasText: "Ir al checkout" })
    await expect(
      irAlCheckout,
      "el CTA 'Ir al checkout' descripto en el brief no existe en ningun viewport: EventoDetalleStickyCheckout está sin usar en el árbol de componentes"
    ).toHaveCount(0)

    const agregarAlCarritoBar = page.locator("button", { hasText: "Agregar al carrito" })
    if (isMobile) {
      await expect(agregarAlCarritoBar, "en mobile SÍ existe una barra inferior, pero con otro copy/semántica").toBeVisible()
      await expect(agregarAlCarritoBar).toContainText("1 entrada")
      await expect(agregarAlCarritoBar).toContainText(/8[.,]000|8000/)
    } else {
      // El bloque existe en el DOM (md:hidden es una clase CSS, no un "no renderizar"),
      // pero no debe ser visible para el usuario en desktop/tablet.
      await expect(agregarAlCarritoBar, "en desktop el bloque debe estar oculto vía md:hidden").toBeHidden()
    }

    expect(diag.pageErrors, `pageerrors: ${diag.pageErrors.map((e) => e.message).join(" | ")}`).toEqual([])
  })

  test("responsive: la pagina no rompe en mobile (375px) ni en tablet (768px)", async ({ page }) => {
    for (const viewport of [{ width: 375, height: 812 }, { width: 768, height: 1024 }]) {
      await page.setViewportSize(viewport)
      const diag = trackDiagnostics(page)
      await page.goto(EVENTO_URL, { waitUntil: "networkidle" })
      await expect(page.getByRole("heading", { name: "PRUEBA POS Entradas" })).toBeVisible()
      const link = page.getByRole("link", { name: "Cómo llegar" })
      await expect(link).toBeVisible()
      expect(diag.pageErrors, `pageerrors @${viewport.width}px`).toEqual([])
    }
  })
})
