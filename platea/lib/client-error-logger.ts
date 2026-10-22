// Client-side error reporting. Posts to /api/client-errors which proxies to backend.
//
// Designed to NEVER throw and NEVER block. Failures to report are swallowed
// (we can't log a logging failure — would infinite loop).

import { esErrorDeHidratacion, hydrationSnapshot } from "./hydration-diagnostics"

type Severity = "error" | "fatal" | "warn"

type ReportParams = {
  message: string
  stack?: string | null
  severity?: Severity
  context?: Record<string, unknown> | null
}

const REPORT_ENDPOINT = "/api/client-errors"

// Local throttle: avoid flooding when a single broken render keeps re-throwing.
// 60 reports per 60s window matches the server-side rate limit.
const REPORT_WINDOW_MS = 60_000
const REPORT_WINDOW_MAX = 60
let windowStartedAt = 0
let windowCount = 0

function shouldReport(): boolean {
  const now = Date.now()
  if (now - windowStartedAt > REPORT_WINDOW_MS) {
    windowStartedAt = now
    windowCount = 0
  }
  if (windowCount >= REPORT_WINDOW_MAX) return false
  windowCount += 1
  return true
}

export function reportClientError(params: ReportParams): void {
  if (typeof window === "undefined") return
  if (!shouldReport()) return

  const payload = {
    message: params.message,
    stack: params.stack ?? null,
    severity: params.severity ?? "error",
    context: {
      ...(params.context ?? {}),
      url: window.location.href,
      pathname: window.location.pathname,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
    },
  }

  try {
    // sendBeacon is more reliable on page unload, but doesn't allow setting
    // Content-Type properly in all browsers. Use fetch with keepalive instead.
    void fetch(REPORT_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
      credentials: "same-origin",
    }).catch(() => {
      // swallow — can't log a log failure
    })
  } catch {
    // swallow
  }
}

// --- Filtro de ruido de terceros -------------------------------------------
//
// Los navegadores in-app (Instagram, Facebook, TikTok) inyectan su propia
// telemetria en la pagina. Esos scripts fallan solos al descargar la vista
// (el puente nativo ya se destruyo) y disparan window.onerror. No es codigo
// nuestro y no hay nada que arreglar de nuestro lado.
//
// Detectado 01-ago-2026 en ctrlzfiesta.ticketera.com con trafico que venia del
// link en bio de Instagram. Aparece de dos formas:
//   1. filename = "iabjs://navigation_performance_logger_android"
//   2. filename = NUESTRA propia URL, porque Meta inyecta el script inline y
//      los frames se atribuyen al documento. Por eso NO alcanza con filtrar
//      por el esquema: hay que mirar tambien los nombres de funcion.
const NOISE_PATTERNS = [
  // puente nativo de los in-app browsers
  "sendDataToNative",
  "sendPageHideMessage",
  "sendBeforeUnloadMessage",
  "navigation_performance_logger",
  "Java object is gone",
  "iabjs://",
  // Safari/WKWebView enmascara el origen de sus propias inyecciones
  "webkit-masked-url://",
]

function esRuidoDeTerceros(message: string, stack: string | null, filename?: string): boolean {
  // "Script error." sin filename es el error cross-origin clasico: no trae
  // ninguna informacion util, solo infla la tabla.
  if (!filename && /^script error\.?$/i.test(message.trim())) return true

  // Cualquier esquema que no sea http(s) no puede ser codigo nuestro.
  if (filename && /^[a-z0-9.+-]+:\/\//i.test(filename) && !/^https?:\/\//i.test(filename)) {
    return true
  }

  const blob = `${message}\n${stack ?? ""}`
  return NOISE_PATTERNS.some((p) => blob.includes(p))
}

let installed = false

// Huella del ICU calculada EN EL SERVIDOR. Llega como prop desde el root layout
// (server component) y la guardamos para poder compararla contra la del
// navegador cuando explota un error de hidratación. Ver `hydration-diagnostics.ts`.
let serverIntlFingerprint: string | null = null

export function installGlobalClientErrorHandlers(options?: { serverIntl?: string | null }): void {
  if (typeof window === "undefined") return
  // La huella se guarda aunque los listeners ya estén puestos: el componente
  // que la provee puede remontarse.
  if (options?.serverIntl) serverIntlFingerprint = options.serverIntl
  if (installed) return
  installed = true

  // Synchronous errors (script errors, render exceptions that escape boundaries).
  window.addEventListener("error", (event) => {
    if (!event) return
    const err = event.error
    const message = err?.message ?? event.message ?? "unknown error"
    const stack = err?.stack ?? null

    if (esRuidoDeTerceros(message, stack, event.filename)) return

    // Los mismatches de hidratación llegan por acá: React los reporta con
    // `window.reportError()`, que dispara este mismo evento "error". Como el
    // stack minificado no dice qué nodo falló, adjuntamos evidencia extra.
    let extra: Record<string, unknown> = {}
    if (esErrorDeHidratacion(message)) {
      try {
        extra = hydrationSnapshot(serverIntlFingerprint)
      } catch {
        extra = { hidratacion: true, snapshotFallo: true }
      }
    }

    reportClientError({
      message,
      stack,
      severity: "error",
      context: {
        kind: "window.onerror",
        filename: event.filename,
        line: event.lineno,
        col: event.colno,
        ...extra,
      },
    })
  })

  // Unhandled promise rejections.
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event?.reason
    const message = reason instanceof Error ? reason.message : String(reason ?? "unhandled rejection")
    const stack = reason instanceof Error ? reason.stack : null

    if (esRuidoDeTerceros(message, stack ?? null)) return

    reportClientError({
      message,
      stack,
      severity: "error",
      context: { kind: "unhandledrejection" },
    })
  })
}
