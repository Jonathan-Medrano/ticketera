import path from "node:path"
import { test, expect, type Page } from "@playwright/test"

/**
 * Edición inline del título de la sección "Eventos" directo sobre el preview
 * (fase 3 del spike de inline-edit — components/tenant/editable-text.tsx,
 * components/tenant/tenant-provider.tsx, components/tenant/tenant-home.tsx,
 * components/dashboard/sitio-venta-editor-preview.tsx,
 * components/dashboard/sitio-venta-editor-shell.tsx, lib/tenant-preview-override.ts).
 *
 * Spike acotado a UN solo campo: `titulo_eventos_home`.
 *
 * HISTORIAL — dos bugs encontrados y arreglados (16-jul-2026):
 *
 * 1) "Título vacío al cargar" — el <h2> editable del preview se renderizaba
 *    VACÍO hasta que el usuario tipeaba algo. Causa raíz: el `useLayoutEffect`
 *    de `components/tenant/editable-text.tsx` que escribe `el.textContent =
 *    value` dependía solo de `[value]`; al pasar de `editable=false` (rama con
 *    children JSX) a `editable=true` (rama sin children, solo ref+
 *    contentEditable), React vacía el nodo, y si `value` no cambió entre esos
 *    dos renders (el caso típico: el primer snapshot casi siempre trae el
 *    mismo valor que ya traía el SSR) el efecto no se re-ejecutaba para volver
 *    a escribir el texto. FIX aplicado: se agregó `editable` al array de
 *    dependencias (`[value, editable]`). Confirmado resuelto: 0 reproducciones
 *    en 9 corridas post-fix, en TODAS las veces que el preview llegó a cargar
 *    el texto coincidió con el valor real/fallback esperado.
 *
 * 2) "Handshake ready<->snapshot se pierde intermitentemente" (preview colgado
 *    en "Cargando vista previa..." para siempre) — causa raíz originalmente
 *    diagnosticada: `onFieldEdit`/`onNavigate` pasados a
 *    `SitioVentaEditorPreview` desde `sitio-venta-editor-shell.tsx` eran
 *    funciones inline nuevas en cada render, haciendo que el efecto que
 *    suscribe el listener de `message` en `sitio-venta-editor-preview.tsx`
 *    hiciera remove+add en cada re-render del shell (cada keystroke en
 *    cualquier campo), abriendo una ventana de carrera donde el "ready" del
 *    iframe podía perderse. FIX aplicado: `setActiveSection` y
 *    `handlePreviewFieldEdit` ahora están en `useCallback` con deps estables.
 *
 *    PARCIALMENTE RESUELTO. Instrumenté `window.addEventListener` en la página
 *    padre y confirmé que, post-fix, el listener de "message" se registra
 *    EXACTAMENTE UNA VEZ por carga (antes se re-registraba en cada keystroke)
 *    — la causa específica diagnosticada SÍ está resuelta. Pero el SÍNTOMA
 *    (loader colgado) siguió reproduciéndose (4/4 en la ronda final de
 *    verificación). Instrumenté ADEMÁS `window.postMessage` y
 *    `addEventListener` en AMBOS lados (padre y iframe, con `performance.now()`
 *    por documento) y encontré la causa real, con timestamps: el hijo dispara
 *    `TENANT_PREVIEW_READY_TYPE` ~400ms después de arrancar su propio script,
 *    pero el padre recién registra su listener de "message" ~650-950ms después
 *    del suyo — el padre llega **sistemáticamente tarde**, no por una carrera
 *    ocasional de timing parejo. Ejemplo real capturado:
 *      CHILD->PARENT postMessage type=ready  en t=396.0ms
 *      PARENT addEventListener(message)       en t=932.3ms   <- 536ms tarde
 *    Como `TENANT_PREVIEW_READY_TYPE` es fire-and-forget (una sola vez, sin
 *    retry/ack) en `components/tenant/tenant-provider.tsx`, ese mensaje se
 *    pierde para siempre — no hay forma de recuperarlo salvo clickear
 *    "Refrescar" (que remonta el iframe con un `previewKey` nuevo, dándole al
 *    handshake una chance nueva e independiente). El iframe (bundle liviano:
 *    solo el storefront tenant) hidrata y dispara su efecto más rápido que el
 *    padre (bundle más pesado: shell del editor completo con auth, sidebar,
 *    form state, etc.) — es estructural, no cosmético.
 *    RESUELTO (fix final). `components/tenant/tenant-provider.tsx` ahora
 *    reintenta mandar `TENANT_PREVIEW_READY_TYPE` cada 250ms hasta recibir el
 *    primer `TENANT_PREVIEW_MESSAGE_TYPE` real de vuelta, con un tope de 5s de
 *    reintentos (el padre ya manejaba "ready" repetidos de forma idempotente —
 *    simplemente re-llama `sendSnapshot()` — así que no hizo falta tocar ese
 *    lado). Confirmado: **30/30 cargas del preview exitosas, 0 cuelgues** en la
 *    verificación final (10 corridas chromium-desktop + 3 chromium-mobile +
 *    1 corrida con ambos proyectos en paralelo, para simular contención). Antes
 *    del fix la tasa era ~1/3 de cuelgues; después de este fix, cero
 *    reproducciones en 30 intentos. Dar por cerrado.
 *
 * Auth: reutiliza la storageState de e2e/helpers/generate-auth-state.mjs.
 */

const EDITOR_URL = "/dashboard/sitio-venta"
const AUTH_FILE = path.join(__dirname, ".auth", "empresaprueba.json")
const PREVIEW_IFRAME_TITLE = "Vista previa en vivo del sitio de venta"
const DEFAULT_TITULO_FALLBACK = "Elegí tu próximo evento"

test.use({ storageState: AUTH_FILE })

function trackDiagnostics(page: Page) {
  const pageErrors: Error[] = []
  const consoleErrors: string[] = []
  page.on("pageerror", (err) => pageErrors.push(err))
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text())
  })
  return { pageErrors, consoleErrors }
}

async function gotoEditorAndWaitPreviewReady(page: Page) {
  await page.goto(EDITOR_URL, { waitUntil: "networkidle" })
  // El handshake ready<->snapshot tiene retry cada 250ms con tope de 5s (ver
  // tenant-provider.tsx) desde el fix del bug #2 documentado arriba — 30/30
  // cargas exitosas post-fix. 20s de margen alcanza de sobra; si esto falla,
  // NO asumas que es flakiness del entorno primero — puede ser una regresión
  // real del handshake (repetí el diagnóstico con postMessage/addEventListener
  // instrumentados en ambos lados antes de descartarlo como ambiente).
  await expect(page.getByText("Cargando vista previa...")).toBeHidden({ timeout: 20_000 })
  const frame = page.frameLocator(`iframe[title="${PREVIEW_IFRAME_TITLE}"]`)
  const titleEditable = frame.locator('[data-ticketera-editable="true"]')
  await expect(titleEditable).toHaveCount(1)
  return { frame, titleEditable }
}

test.describe("dashboard - editor de sitio de venta - edicion inline del titulo de Eventos en el preview (empresaprueba)", () => {
  test("FIX verificado: el titulo se muestra en el preview al cargar (ya no queda vacio)", async ({ page }) => {
    test.setTimeout(90_000)
    const { titleEditable } = await gotoEditorAndWaitPreviewReady(page)
    await expect(titleEditable).toBeVisible()
    await expect(titleEditable).toHaveAttribute("contenteditable", "true")
    await expect(titleEditable).toHaveAttribute("role", "textbox")

    // El valor "real" configurado en el fixture (lo que el panel lateral ya tiene guardado).
    await page.getByRole("button", { name: /^Home/ }).click()
    const panelInput = page.getByPlaceholder(DEFAULT_TITULO_FALLBACK)
    await expect(panelInput).toBeVisible()
    const configuredTitle = (await panelInput.inputValue()).trim()
    const expectedInitialText = configuredTitle || DEFAULT_TITULO_FALLBACK

    // Esperamos de sobra (3s) para descartar que sea timing/handshake lento, no un bug real.
    await page.waitForTimeout(3000)
    const actualText = ((await titleEditable.textContent()) ?? "").trim()

    expect(
      actualText,
      `El <h2> editable del preview deberia mostrar "${expectedInitialText}" (el valor configurado o su fallback) ` +
        `pero esta VACIO ("${actualText}"). Ver comentario del archivo: useLayoutEffect en editable-text.tsx no repuebla ` +
        `textContent al pasar de editable=false a editable=true cuando "value" no cambio entre esos dos renders.`,
    ).toBe(expectedInitialText)
  })

  test("tipeo caracter-a-caracter mantiene el cursor, Enter hace blur (no newline), sincroniza el panel y sobrevive un cambio concurrente de otro campo", async ({
    page,
  }) => {
    test.setTimeout(120_000)
    const { pageErrors, consoleErrors } = trackDiagnostics(page)
    await page.setViewportSize({ width: 1440, height: 1000 })
    const { frame, titleEditable } = await gotoEditorAndWaitPreviewReady(page)

    // Post fix del bug "titulo vacio al cargar", el nodo YA arranca con texto real
    // (el titulo configurado o su fallback) — usamos ese texto real como base para
    // el test de insercion en el medio, en vez de sembrar uno sintetico (un click()
    // sin posicion cae en el CENTRO del elemento, y como ahora hay texto real ahi,
    // tipear sin reposicionar antes insertaria en medio del texto existente, no en
    // un nodo vacio).
    const baseline = ((await titleEditable.textContent()) ?? "").trim()
    expect(baseline.length, "el titulo debe tener contenido real tras el fix del bug 'vacio al cargar'").toBeGreaterThan(2)

    // --- Insertar caracter-a-caracter EN MEDIO del texto (no al final) ---
    const insertionIndex = Math.min(12, Math.max(1, Math.floor(baseline.length / 2)))
    await titleEditable.click()
    await page.keyboard.press("Home")
    for (let i = 0; i < insertionIndex; i++) await page.keyboard.press("ArrowRight")

    const part1 = "QAX"
    await page.keyboard.type(part1, { delay: 70 })

    const expectedAfterPart1 = baseline.slice(0, insertionIndex) + part1 + baseline.slice(insertionIndex)
    await expect(
      titleEditable,
      "el texto tipeado caracter-a-caracter debe insertarse EXACTAMENTE en la posicion del cursor, no al final/principio",
    ).toHaveText(expectedAfterPart1)

    // --- Mientras seguimos "editando" (sin blur explicito), cambiamos OTRO campo
    // desde el panel lateral (color primario de Branding, tab activa por default)
    // para forzar el resnapshot rAF-debounced del preview completo con el titulo
    // todavia sin commitear. ---
    const primaryColorInput = page.locator('input[placeholder="#000000"]').first()
    await expect(primaryColorInput, "el input de color primario debe estar visible en Branding (tab activa por default)").toBeVisible()
    const newColor = "#123abc"
    // El navegador serializa color inline como rgb(...) en el atributo style, no en hex.
    const newColorRgb = "rgb(18, 58, 188)"
    await primaryColorInput.fill(newColor)

    // El resto de la pagina reacciona: el precio de una card de evento usa color_primario.
    const priceEl = frame.locator(".font-black.font-mono.tabular-nums:visible").first()
    await expect(priceEl, "debe haber al menos una card de evento con precio visible en el fixture").toBeVisible()
    await expect
      .poll(async () => (await priceEl.getAttribute("style")) ?? "", {
        message: "el precio de la card deberia reflejar el nuevo color_primario tras el cambio en el panel",
        timeout: 5_000,
      })
      .toContain(newColorRgb)

    // El cambio de color NO debe haber roto/reseteado lo que se tipeo en el titulo.
    await expect(
      titleEditable,
      "cambiar otro campo (color) mientras se edita el titulo en preview no debe resetear ni perder lo ya tipeado",
    ).toHaveText(expectedAfterPart1)

    // --- Continuar tipeando el resto, caracter-a-caracter, para confirmar que el
    // cursor sigue en una posicion coherente (no saltó) tras el snapshot concurrente. ---
    await titleEditable.click()
    await page.keyboard.press("End")
    const part2 = "ZZZ"
    await page.keyboard.type(part2, { delay: 70 })
    const expectedAfterPart2 = expectedAfterPart1 + part2
    await expect(titleEditable).toHaveText(expectedAfterPart2)

    // --- Enter debe hacer blur (commit) en vez de insertar un salto de linea ---
    await page.keyboard.press("Enter")
    await expect(titleEditable).not.toBeFocused()
    const finalText = (await titleEditable.textContent()) ?? ""
    expect(finalText, "Enter no debe insertar un salto de linea dentro del titulo").toBe(expectedAfterPart2)
    expect(finalText.includes("\n"), "el titulo debe seguir siendo un texto plano de una sola linea").toBe(false)

    // --- El panel lateral (Home -> EditorialHomeSection) debe reflejar el mismo texto ---
    await page.getByRole("button", { name: /^Home/ }).click()
    const panelTituloInput = page.getByPlaceholder(DEFAULT_TITULO_FALLBACK)
    await expect(
      panelTituloInput,
      "el input del panel lateral (Home) debe sincronizarse con lo editado en el preview tras el blur",
    ).toHaveValue(expectedAfterPart2)

    expect(pageErrors, `pageerrors: ${pageErrors.map((e) => e.message).join(" | ")}`).toEqual([])
    if (consoleErrors.length > 0) {
      console.log(`[info] console.error capturados (no fatales):\n${consoleErrors.join("\n")}`)
    }
  })
})
