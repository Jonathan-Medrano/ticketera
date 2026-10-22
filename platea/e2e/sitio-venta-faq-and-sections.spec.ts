import path from "node:path"
import { test, expect, type Locator, type Page } from "@playwright/test"

/**
 * Editor de sitio de venta (sitio-venta-editor-shell.tsx + sitio-venta/*.tsx).
 *
 * Cubre DOS cambios puntuales:
 *  1. faq-section.tsx: reorder de FAQs migrado a dnd-kit (antes drag nativo HTML5).
 *  2. sections-order-manager.tsx: "+" contextual entre secciones del Home para
 *     insertar una sección nueva en una posición exacta (antes siempre al final).
 *
 * Ninguno de los dos tests hace click en "Guardar" -> las mutaciones quedan en
 * estado local de React (use-sitio-venta-editor.ts solo persiste via
 * handleGuardar -> fetch("/api/sitio-venta")), asi que no ensucian el fixture
 * "empresaprueba" en la DB entre corridas.
 *
 * Auth: reutiliza la storageState de e2e/helpers/generate-auth-state.mjs (ver
 * nota de rate-limit en dashboard-evento-detalle.spec.ts).
 */

const EDITOR_URL = "/dashboard/sitio-venta"
const AUTH_FILE = path.join(__dirname, ".auth", "empresaprueba.json")

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

/** Drag `source` onto `target` simulating real pointer events (dnd-kit's
 * PointerSensor listens to pointerdown/pointermove/pointerup, not native HTML5
 * drag-and-drop, so Playwright's `dragTo()` — built for the native DnD API —
 * does not work here). */
async function dragOnto(page: Page, source: Locator, target: Locator) {
  // scrollIntoViewIfNeeded es obligatorio antes de leer boundingBox(): si el
  // elemento quedo fuera de viewport (p.ej. tras tipear en un editor mas abajo
  // en la pagina), boundingBox() devuelve coordenadas stale y el mousedown cae
  // sobre otro elemento -> termina en una seleccion de texto nativa, no un drag.
  await source.scrollIntoViewIfNeeded()
  await target.scrollIntoViewIfNeeded()
  // Ambos scrolls resueltos -> recien ahi leemos las bounding boxes finales.
  const sourceBox = await source.boundingBox()
  const targetBox = await target.boundingBox()
  if (!sourceBox || !targetBox) throw new Error("No se pudo obtener el bounding box del elemento a arrastrar")

  const startX = sourceBox.x + sourceBox.width / 2
  const startY = sourceBox.y + sourceBox.height / 2
  const endX = targetBox.x + targetBox.width / 2
  const endY = targetBox.y + targetBox.height / 2

  await page.mouse.move(startX, startY)
  await page.mouse.down()
  const steps = 12
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(
      startX + ((endX - startX) * i) / steps,
      startY + ((endY - startY) * i) / steps,
      { steps: 1 },
    )
  }
  // Segundo pase quieto sobre el target: dnd-kit's closestCenter recalcula
  // "over" en cada pointermove, un frame extra evita quedar justo en el borde.
  await page.mouse.move(endX, endY, { steps: 1 })
  await page.mouse.up()
}

test.describe("dashboard - editor de sitio de venta - FAQ dnd-kit (empresaprueba)", () => {
  test("carga sin errores, agregar/escribir/reordenar/ocultar/eliminar FAQ funciona", async ({ page }) => {
    const { pageErrors, consoleErrors } = trackDiagnostics(page)
    await page.setViewportSize({ width: 1280, height: 1600 })
    const response = await page.goto(EDITOR_URL, { waitUntil: "networkidle" })
    expect(response!.status()).toBeLessThan(400)

    await page.getByRole("button", { name: /^Soporte/ }).click()
    await expect(page.getByText("Preguntas frecuentes", { exact: true })).toBeVisible()

    const addFaqBtn = page.getByRole("button", { name: "Agregar pregunta frecuente" })
    const questionInputs = page.getByPlaceholder("Ej: ¿Cómo descargo mi entrada?")
    const answerEditors = page.locator('[contenteditable="true"]')

    // --- Agregar 2 FAQs nuevas con texto marcador único ---
    await addFaqBtn.click()
    await expect(questionInputs).toHaveCount((await questionInputs.count()))
    let count = await questionInputs.count()
    await questionInputs.nth(count - 1).fill("ZZZ-FAQ-A pregunta")
    await answerEditors.nth(count - 1).click()
    await answerEditors.nth(count - 1).fill("Respuesta A de prueba E2E")

    await addFaqBtn.click()
    count = await questionInputs.count()
    await questionInputs.nth(count - 1).fill("ZZZ-FAQ-B pregunta")
    await answerEditors.nth(count - 1).click()
    await answerEditors.nth(count - 1).fill("Respuesta B de prueba E2E")

    // Confirmamos que lo tipeado quedo en el input/editor correcto (no cruzado).
    await expect(questionInputs.nth(count - 2)).toHaveValue("ZZZ-FAQ-A pregunta")
    await expect(questionInputs.nth(count - 1)).toHaveValue("ZZZ-FAQ-B pregunta")

    async function questionOrder(): Promise<string[]> {
      return questionInputs.evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value))
    }

    const orderBeforeDrag = await questionOrder()
    const indexA = orderBeforeDrag.indexOf("ZZZ-FAQ-A pregunta")
    const indexB = orderBeforeDrag.indexOf("ZZZ-FAQ-B pregunta")
    expect(indexA, "FAQ A debe existir antes del drag").toBeGreaterThanOrEqual(0)
    expect(indexB, "FAQ B debe existir antes del drag").toBeGreaterThanOrEqual(0)
    expect(indexA, "FAQ A se agrego antes que B").toBeLessThan(indexB)

    // --- Reorder: arrastrar la fila de A (por su handle) sobre la fila de B ---
    const handleA = page.getByLabel(`Reordenar FAQ ${indexA + 1}`)
    const handleB = page.getByLabel(`Reordenar FAQ ${indexB + 1}`)
    await dragOnto(page, handleA, handleB)

    const orderAfterDrag = await questionOrder()
    const newIndexA = orderAfterDrag.indexOf("ZZZ-FAQ-A pregunta")
    const newIndexB = orderAfterDrag.indexOf("ZZZ-FAQ-B pregunta")
    expect(
      newIndexA,
      `orden esperado invertido tras el drag; orden completo: ${orderAfterDrag.join(" | ")}`,
    ).toBeGreaterThan(newIndexB)
    expect(orderAfterDrag.length, "no debe perderse ni duplicarse ninguna FAQ durante el drag").toBe(
      orderBeforeDrag.length,
    )

    // --- Ocultar / mostrar sigue funcionando ---
    // Ubicamos la fila de B por el input que contiene su value (robusto al drag).
    const rowBByInput = page.locator("div.rounded-xl.border.border-border\\/60.bg-muted\\/30").filter({
      has: page.locator('input[value="ZZZ-FAQ-B pregunta"]'),
    })
    await expect(rowBByInput).toHaveCount(1)
    await expect(rowBByInput.getByText("Visible", { exact: true })).toBeVisible()
    await rowBByInput.getByLabel(/^Ocultar FAQ/).click()
    await expect(rowBByInput.getByText("Oculta", { exact: true })).toBeVisible()
    await rowBByInput.getByLabel(/^Mostrar FAQ/).click()
    await expect(rowBByInput.getByText("Visible", { exact: true })).toBeVisible()

    // --- Eliminar sigue funcionando (A y B, para no dejar basura en el estado local) ---
    const rowAByInput = page.locator("div.rounded-xl.border.border-border\\/60.bg-muted\\/30").filter({
      has: page.locator('input[value="ZZZ-FAQ-A pregunta"]'),
    })
    await rowAByInput.getByLabel(/^Eliminar FAQ/).click()
    await expect(rowAByInput).toHaveCount(0)
    await rowBByInput.getByLabel(/^Eliminar FAQ/).click()
    await expect(rowBByInput).toHaveCount(0)

    expect(pageErrors, `pageerrors: ${pageErrors.map((e) => e.message).join(" | ")}`).toEqual([])
    if (consoleErrors.length > 0) {
      console.log(`[info] console.error capturados (no fatales, ver README sobre ruido de Next dev):\n${consoleErrors.join("\n")}`)
    }
  })
})

test.describe("dashboard - editor de sitio de venta - '+' contextual para secciones del Home (empresaprueba)", () => {
  test("insertar seccion en posicion intermedia exacta + drag normal sigue funcionando", async ({ page }) => {
    const { pageErrors } = trackDiagnostics(page)
    await page.goto(EDITOR_URL, { waitUntil: "networkidle" })

    await page.getByRole("button", { name: /^Home/ }).click()
    await expect(page.getByText("Secciones del home", { exact: true })).toBeVisible()

    const sectionLabels = page.locator(
      "div.flex.items-center.gap-2.p-3 > div.flex-1 > p.text-sm.font-semibold.text-foreground",
    )
    const dragHandles = page.getByRole("button", { name: "Reordenar sección" })

    const labelsBefore = await sectionLabels.allTextContents()
    expect(labelsBefore.length, "el fixture necesita al menos 2 secciones cargadas para este test").toBeGreaterThanOrEqual(2)

    // Divisor "+" entre la 1ra y 2da seccion: solo se renderiza para idx>0, asi
    // que el primero en el DOM corresponde exactamente a esa posicion. Y no debe
    // haber ninguno ANTES de la primera seccion (comportamiento esperado segun brief).
    const insertButtons = page.getByRole("button", { name: "Insertar sección acá" })
    await expect(insertButtons).toHaveCount(labelsBefore.length - 1)
    const firstDivider = insertButtons.first()
    await firstDivider.hover()
    await firstDivider.click()

    // El picker de tipos debe expandirse.
    const picker = page.locator("div.flex.flex-wrap.justify-center.gap-2.rounded-xl.border.border-dashed")
    await expect(picker).toBeVisible()
    const typeButtons = picker.locator("button")
    const typeButtonCount = await typeButtons.count()
    expect(typeButtonCount, "debe haber al menos un tipo de seccion disponible para insertar").toBeGreaterThan(0)

    const chosenLabel = (await typeButtons.first().innerText()).trim()
    expect(labelsBefore, `el tipo elegido (${chosenLabel}) no deberia estar ya en la lista (son singulares)`).not.toContain(
      chosenLabel,
    )
    await typeButtons.first().click()

    const labelsAfter = await sectionLabels.allTextContents()
    expect(labelsAfter.length, "debe haber exactamente una seccion mas").toBe(labelsBefore.length + 1)
    expect(labelsAfter[0], "la 1ra seccion original no debe moverse").toBe(labelsBefore[0])
    expect(labelsAfter[1], "la seccion nueva debe insertarse EXACTAMENTE en la posicion 1 (intermedia), no al final").toBe(
      chosenLabel,
    )
    expect(labelsAfter.slice(2), "el resto de las secciones originales deben conservar su orden relativo").toEqual(
      labelsBefore.slice(1),
    )

    // --- El drag & drop normal (por el handle, no el "+") sigue funcionando ---
    // Swap con el vecino inmediato (idx 1 <-> idx 2), no un salto de varias
    // pantallas: en mobile (viewport angosto/bajo) un salto largo requeriria
    // simular el auto-scroll de dnd-kit durante el drag, que este helper (un
    // solo movimiento de mouse.move) no reproduce -- swap adyacente valida el
    // mismo comportamiento (reorder por handle) sin depender de eso.
    await dragOnto(page, dragHandles.nth(1), dragHandles.nth(2))

    const labelsAfterManualDrag = await sectionLabels.allTextContents()
    expect(labelsAfterManualDrag.length).toBe(labelsAfter.length)
    expect(
      labelsAfterManualDrag[1],
      `drag manual deberia haber swapeado idx1<->idx2; orden resultante: ${labelsAfterManualDrag.join(" | ")}`,
    ).toBe(labelsAfter[2])
    expect(labelsAfterManualDrag[2]).toBe(chosenLabel)

    expect(pageErrors, `pageerrors: ${pageErrors.map((e) => e.message).join(" | ")}`).toEqual([])
  })
})
