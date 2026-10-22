// Diagnóstico de hydration mismatches (React #418/#423/#425).
//
// POR QUÉ EXISTE ESTE ARCHIVO
// ---------------------------
// En producción React solo reporta el código minificado ("Minified React error
// #418"), sin el nodo que falló. El `componentStack` que React SÍ le pasa a
// `onRecoverableError` como segundo argumento se pierde antes de llegarnos:
// Next 16 cablea su propio handler en `hydrateRoot` (ver
// `next/dist/client/app-index.js`, opción `onRecoverableError`) y ese handler
// descarta el `errorInfo` — solo reenvía el `error` a `window.reportError()`.
// No hay hook de usuario para reemplazarlo en App Router.
//
// Entonces, en vez de perseguir el nodo, capturamos EVIDENCIA que discrimina
// entre las causas posibles. Dos tests deterministas, no heurísticas:
//
//   1. CANARIO  -> ¿alguien reescribió el DOM antes de que React hidratara?
//      (traductor automático del navegador, in-app browser de Instagram/FB)
//   2. HUELLA INTL -> ¿el ICU del navegador formatea distinto que el de Node?
//      Si difiere, CADA precio y fecha en un client component es un mismatch.
//
// El snapshot solo se calcula cuando ya explotó un error de hidratación, así
// que no cuesta nada en el camino feliz.
//
// TEMPORAL: instrumentación de diagnóstico. Cuando sepamos la causa, borrar
// este módulo, el canario del root layout y la rama de hidratación en
// `client-error-logger.ts`.

import { formatDateShortWeekday, formatDateTime, formatMoney } from "./format"

// --- 1. Canario de reescritura del DOM --------------------------------------
//
// Texto en español, fijo, renderizado por el servidor. Si al momento del error
// el DOM tiene otra cosa, algo externo reescribió los nodos de texto de la
// página — que es exactamente la firma de un traductor automático.
//
// Va con `suppressHydrationWarning` en el layout: si el traductor lo tocó, no
// queremos que el canario se convierta él mismo en un error nuevo.
export const CANARY_ATTR = "data-vk-canary"
export const CANARY_TEXT = "control de integridad"

// --- 2. Huella del ICU ------------------------------------------------------
//
// Se compara en codepoints hex y no en el string crudo porque la diferencia
// típica es invisible a ojo: U+00A0 (NBSP) vs U+202F (narrow NBSP) vs sin
// espacio entre el símbolo y el número.
//
// Valores de referencia fijos. El instante es una constante UTC, así el
// resultado depende solo del formateador y nunca del reloj.
const REF_AMOUNT = 15000
const REF_INSTANT = "2026-01-02T03:04:05.000Z"

function codepoints(value: string): string {
  return Array.from(value, (char) => char.codePointAt(0)!.toString(16)).join(" ")
}

// Tercera muestra: la fecha corta de las tarjetas de evento de la home.
//
// ✅ CAUSA ENCONTRADA Y CORREGIDA (07-ago-2026). Esta era la que rompía. El
// reporte de producción dio:
//     servidor "vie, 2 ene"   cliente "vie, 2 ene."     (`intlCoincide: false`)
// más `formatDateTime` en 12h en el servidor y 24h en el cliente. El teléfono
// tenía `navigator.language = es-419` y su ICU resolvía `es-AR` distinto que el
// Node de Vercel.
//
// `lib/format.ts` ya no usa datos de locale para nada: compone las palabras con
// tablas propias y de `Intl` solo toma la aritmética de zona horaria. Por eso
// esta muestra ahora apunta al formateador real y DEBERÍA coincidir siempre.
// Si vuelve a dar `intlCoincide: false`, es un formateador nuevo que se coló
// usando `Intl` para palabras — no es este.
function shortDateSample(): string {
  return formatDateShortWeekday(REF_INSTANT)
}

/**
 * Huella de los formateadores compartidos de `lib/format.ts`. Se calcula igual
 * en servidor y en cliente; si los dos resultados no coinciden, encontramos la
 * causa del mismatch.
 */
export function intlFingerprint(): string {
  try {
    return [
      codepoints(formatMoney(REF_AMOUNT)),
      codepoints(formatDateTime(REF_INSTANT)),
      codepoints(shortDateSample()),
    ].join("|")
  } catch {
    return "unavailable"
  }
}

// --- Snapshot ---------------------------------------------------------------

// El backend solo persiste escalares planos en `context` (ver
// `backend/src/routes/client-errors.ts`, `pickContext`): nada de objetos
// anidados ni arrays, y strings recortados a 1000 chars.
type Snapshot = Record<string, string | number | boolean>

function texto(value: string | null | undefined, max = 200): string {
  return (value ?? "").trim().slice(0, max)
}

/**
 * Evidencia para triaje, capturada en el momento del error de hidratación.
 * Nunca tira: si algo falla, devuelve lo que haya juntado hasta ahí.
 */
export function hydrationSnapshot(serverIntl: string | null): Snapshot {
  const snap: Snapshot = { hidratacion: true }

  try {
    const clientIntl = intlFingerprint()
    snap.intlCliente = clientIntl
    if (serverIntl) {
      snap.intlServidor = serverIntl
      // El campo que mira uno primero al abrir el reporte.
      snap.intlCoincide = serverIntl === clientIntl
    }
  } catch {
    /* seguimos con el resto */
  }

  try {
    const canary = document.querySelector(`[${CANARY_ATTR}]`)
    const found = texto(canary?.textContent, 120)
    snap.canario = canary ? found : "ausente"
    // Si el canario ya no dice lo que el servidor escribió, el DOM fue
    // reescrito por algo externo a nosotros.
    snap.canarioIntacto = found === CANARY_TEXT
  } catch {
    /* seguimos con el resto */
  }

  try {
    const html = document.documentElement
    snap.htmlLang = texto(html.lang, 20)
    // Google Translate marca el <html> con `translated-ltr` / `translated-rtl`
    // y envuelve los nodos de texto en <font>, un tag que nosotros no usamos
    // en ningún lado. Safari traduce sin dejar marca en el <html>: para ese
    // caso el canario es el único testigo.
    snap.htmlClass = texto(html.className, 200)
    snap.fontTags = document.getElementsByTagName("font").length
  } catch {
    /* seguimos con el resto */
  }

  try {
    snap.navLang = texto(navigator.language, 20)
    snap.navLangs = texto(navigator.languages?.join(","), 100)
  } catch {
    /* seguimos con el resto */
  }

  return snap
}

/**
 * ¿Es un mismatch de hidratación? Cubre los códigos minificados de producción
 * y los mensajes largos de desarrollo.
 *
 * Deliberadamente NO incluye #419 (Suspense que no terminó en el servidor) ni
 * #421: son problemas de streaming, no de HTML divergente.
 */
export function esErrorDeHidratacion(message: string): boolean {
  if (/react error #(418|423|425)\b/i.test(message)) return true
  return /hydration failed|hydrating|text content does not match/i.test(message)
}
