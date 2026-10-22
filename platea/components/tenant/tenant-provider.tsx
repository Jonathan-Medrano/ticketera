"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { usePathname } from "next/navigation"
import CartProvider from "./cart-provider"
import ConsumiblesCartProvider from "./consumibles-cart-provider"
import type { TenantEmpresa, TenantSalesReadiness } from "@/lib/tenant"
import { tenantNavbarHeightPx } from "@/lib/tenant-logo"
import {
  TENANT_PREVIEW_FIELD_EDIT_TYPE,
  TENANT_PREVIEW_MESSAGE_TYPE,
  TENANT_PREVIEW_NAVIGATION_TYPE,
  TENANT_PREVIEW_QUERY_FLAG,
  TENANT_PREVIEW_READY_TYPE,
  type TenantPreviewFieldEditPayload,
} from "@/lib/tenant-preview-override"

const HEX_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

const FONT_META: Record<string, { family: string; url: string }> = {
  inter:          { family: "'Inter', sans-serif",          url: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" },
  poppins:        { family: "'Poppins', sans-serif",        url: "https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap" },
  "dm-sans":      { family: "'DM Sans', sans-serif",        url: "https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap" },
  montserrat:     { family: "'Montserrat', sans-serif",     url: "https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap" },
  "space-grotesk":{ family: "'Space Grotesk', sans-serif",  url: "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap" },
  raleway:        { family: "'Raleway', sans-serif",        url: "https://fonts.googleapis.com/css2?family=Raleway:wght@400;500;600;700&display=swap" },
  playfair:       { family: "'Playfair Display', serif",    url: "https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&display=swap" },
  bebas:          { family: "'Bebas Neue', sans-serif",     url: "https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap" },
}

const BORDER_RADIUS_MAP: Record<string, string> = {
  sharp:   "0px",
  soft:    "4px",
  rounded: "12px",
}

function safeTenantColor(value: string | null | undefined, fallback: string): string {
  if (value && HEX_COLOR_RE.test(value)) return value
  return fallback
}

const TenantContext = createContext<TenantEmpresa | null>(null)
const TenantSalesReadinessContext = createContext<TenantSalesReadiness | null>(null)
const TenantThemeContext = createContext<{
  mode: "dark" | "light"
  setMode: (mode: "dark" | "light") => void
} | null>(null)

// Inline-edit spike (sitio-venta-editor-inline.md, fase 3): lets storefront components
// know whether they're rendering inside the editor's live-preview iframe and, if so,
// gives them a way to report a direct edit back to the editor's form. Outside preview
// mode (all real buyer traffic) this is always the default no-op value below — nothing
// about the public storefront changes.
const TenantPreviewEditContext = createContext<{
  editable: boolean
  editField: (field: TenantPreviewFieldEditPayload["field"], value: string) => void
}>({ editable: false, editField: () => {} })

/** Read from any storefront component to know if it's safe to render an inline-editable
 * affordance (contentEditable, hover outline, etc.) and how to report edits upstream. */
export function useTenantPreviewEdit() {
  return useContext(TenantPreviewEditContext)
}

export function useTenant() {
  const ctx = useContext(TenantContext)
  if (!ctx) throw new Error("useTenant must be used within TenantProvider")
  return ctx
}

export function useTenantTheme() {
  const ctx = useContext(TenantThemeContext)
  if (!ctx) throw new Error("useTenantTheme must be used within TenantProvider")
  return ctx
}

export function useTenantSalesReadiness() {
  return useContext(TenantSalesReadinessContext)
}

export default function TenantProvider({
  empresa,
  initialMode = "dark",
  children,
}: {
  empresa: TenantEmpresa
  initialMode?: "dark" | "light"
  children: React.ReactNode
}) {
  const storageKey = `tenant-theme:${empresa.slug}`
  const cookieKey = `tenant-theme-${empresa.slug}`
  // El primer render del cliente TIENE que coincidir con el del servidor, si no
  // React aborta la hidratacion (error #418, visto en produccion 01-ago-2026 en
  // ctrlzfiesta.ticketera.com).
  //
  // Antes esto leia localStorage dentro del inicializador de useState: el server
  // renderiza con `initialMode` (que viene de la cookie) y el cliente arrancaba
  // con lo que hubiera en localStorage. Normalmente coinciden, pero divergen
  // justo en el caso que mas nos importa: los navegadores in-app de Instagram y
  // Facebook suelen bloquear o particionar cookies y conservar localStorage.
  // Por eso el error aparecia solo en el trafico que venia con `fbclid`.
  //
  // Ahora se arranca SIEMPRE con el valor del servidor y se reconcilia despues
  // de montar. Si difieren hay un cambio de tema imperceptible, que es
  // infinitamente mejor que perder la hidratacion de toda la pagina.
  const [mode, setMode] = useState<"dark" | "light">(initialMode)
  const reconciliado = useRef(false)

  useEffect(() => {
    if (reconciliado.current) return
    reconciliado.current = true
    try {
      const saved = window.localStorage.getItem(storageKey)
      if ((saved === "light" || saved === "dark") && saved !== mode) setMode(saved)
    } catch {
      // ignore storage issues
    }
    // Solo al montar: despues manda el estado, no el storage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    // No persistir hasta haber leido lo guardado, si no el valor del servidor
    // pisaria la preferencia real del visitante en el primer render.
    if (!reconciliado.current) return
    try {
      window.localStorage.setItem(storageKey, mode)
      document.cookie = `${cookieKey}=${mode}; path=/; max-age=31536000; samesite=lax`
    } catch {
      // ignore storage issues
    }
  }, [cookieKey, mode, storageKey])

  useEffect(() => {
    try {
      const ref = new URLSearchParams(window.location.search).get("ref")
      if (ref) sessionStorage.setItem("ticketera_ref", ref)
    } catch {
      // ignore storage issues
    }
  }, [])

  // "Sitio de venta" editor live-preview: this tenant runtime can be embedded in an
  // iframe by the editor (platea/components/dashboard/sitio-venta-editor-preview.tsx)
  // to reflect unsaved draft changes instantly. Only activates when explicitly flagged
  // via query param AND actually embedded (window.top !== window.self) — the flag alone
  // is not trusted, since a public visitor could append it to a URL.
  const [previewOverride, setPreviewOverride] = useState<Partial<TenantEmpresa> | null>(null)
  // Captured once at mount from the URL the iframe was first loaded with — client-side
  // navigations inside the preview (Link clicks) don't carry the query flag along, so
  // re-reading window.location.search on every route change would silently drop preview
  // mode after the very first click. The layout wrapping TenantProvider persists across
  // those navigations (App Router), so "once at mount" correctly covers the whole session.
  const previewActiveRef = useRef(false)
  const pathname = usePathname()
  const navMountedRef = useRef(false)
  // Mirrors previewActiveRef as state: the ref alone doesn't trigger a re-render, but
  // components reading `editable` via useTenantPreviewEdit() need one once preview mode
  // is confirmed (flag + embedded) shortly after mount.
  const [previewEditable, setPreviewEditable] = useState(false)

  const editField = useCallback((field: TenantPreviewFieldEditPayload["field"], value: string) => {
    if (!previewActiveRef.current) return
    try {
      const payload: TenantPreviewFieldEditPayload = { field, value }
      window.parent.postMessage({ type: TENANT_PREVIEW_FIELD_EDIT_TYPE, payload }, window.location.origin)
    } catch {
      // ignore — same progressive-enhancement rationale as the other preview effects
    }
  }, [])

  useEffect(() => {
    try {
      const isPreviewFlagged = new URLSearchParams(window.location.search).get(TENANT_PREVIEW_QUERY_FLAG) === "1"
      const isEmbedded = window.top !== window.self
      if (!isPreviewFlagged || !isEmbedded) return
      previewActiveRef.current = true
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time mount sync mirroring previewActiveRef so components can react to preview mode (hydration-safe: same false value on server + first client render, only flips post-mount like the rest of this effect)
      setPreviewEditable(true)

      let firstSnapshotReceived = false

      function handlePreviewMessage(event: MessageEvent) {
        // Never trust event.source — only the origin check below is a safe guard.
        if (event.origin !== window.location.origin) return
        if (event.data?.type !== TENANT_PREVIEW_MESSAGE_TYPE) return
        firstSnapshotReceived = true
        setPreviewOverride(event.data.payload ?? null)
      }

      window.addEventListener("message", handlePreviewMessage)

      // Handshake retry — found via live E2E verification (sitio-venta-inline-edit.spec.ts),
      // not theoretical: the parent editor shell (auth + sidebar + full form state) measurably
      // takes longer to mount its `message` listener than this lightweight storefront bundle
      // takes to reach this point (~900ms+ vs ~400ms in real runs), and TENANT_PREVIEW_READY_TYPE
      // had no ack — a single fire-and-forget post sent before the parent is listening is lost
      // forever, leaving the preview stuck on its loading state ~1/3 of loads. Retry on a short
      // interval until the first real snapshot arrives; safe to over-send since the parent's
      // handler just re-sends the current snapshot each time, which is idempotent.
      function sendReady() {
        if (firstSnapshotReceived) return
        window.parent.postMessage({ type: TENANT_PREVIEW_READY_TYPE }, window.location.origin)
      }
      sendReady()
      const retryInterval = window.setInterval(() => {
        if (firstSnapshotReceived) {
          window.clearInterval(retryInterval)
          return
        }
        sendReady()
      }, 250)
      // Give up after a few seconds — if the parent hasn't responded by then something else
      // is wrong, and retrying forever would just be pointless background noise.
      const stopRetryTimeout = window.setTimeout(() => window.clearInterval(retryInterval), 5000)

      return () => {
        window.removeEventListener("message", handlePreviewMessage)
        window.clearInterval(retryInterval)
        window.clearTimeout(stopRetryTimeout)
      }
    } catch {
      // ignore — preview mode is a progressive enhancement, never block the public site
    }
  }, [])

  // Reports in-preview navigation (e.g. Home -> event detail) so the editor's sidebar
  // can follow along instead of staying stuck on whatever section was active before.
  // Skips the first run (initial page load) — only real navigation should switch sections.
  useEffect(() => {
    if (!previewActiveRef.current) return
    if (!navMountedRef.current) {
      navMountedRef.current = true
      return
    }
    try {
      window.parent.postMessage({ type: TENANT_PREVIEW_NAVIGATION_TYPE, path: pathname }, window.location.origin)
    } catch {
      // ignore — same progressive-enhancement rationale as above
    }
  }, [pathname])

  const baseEmpresa = useMemo<TenantEmpresa>(
    () => (previewOverride ? { ...empresa, ...previewOverride } : empresa),
    [empresa, previewOverride]
  )

  const themedEmpresa = useMemo<TenantEmpresa>(() => {
    // Ensure brand colors are never null/invalid downstream so that every
    // component using tenant.color_primario, color_fondo, color_texto in
    // inline styles renders correctly even when the empresa hasn't configured
    // its brand yet.
    const colorPrimario = safeTenantColor(baseEmpresa.color_primario, "#0052cc")

    if (mode === "dark") {
      return {
        ...baseEmpresa,
        color_primario: colorPrimario,
        color_fondo: safeTenantColor(baseEmpresa.color_fondo, "#061a3d"),
        color_texto: safeTenantColor(baseEmpresa.color_texto, "#f8fafc"),
      }
    }

    return {
      ...baseEmpresa,
      color_primario: colorPrimario,
      color_fondo: "#fff3eb",
      color_texto: "#061a3d",
    }
  }, [baseEmpresa, mode])

  const previewEditContextValue = useMemo(
    () => ({ editable: previewEditable, editField }),
    [previewEditable, editField]
  )

  return (
    <TenantThemeContext.Provider value={{ mode, setMode }}>
      <TenantSalesReadinessContext.Provider value={empresa.sales_readiness ?? null}>
        <TenantContext.Provider value={themedEmpresa}>
          <TenantPreviewEditContext.Provider value={previewEditContextValue}>
            <CartProvider>
              <ConsumiblesCartProvider>
                {baseEmpresa.font && FONT_META[baseEmpresa.font] && (
                  <link rel="stylesheet" href={FONT_META[baseEmpresa.font].url} />
                )}
                {baseEmpresa.heading_font && FONT_META[baseEmpresa.heading_font] && baseEmpresa.heading_font !== baseEmpresa.font && (
                  <link rel="stylesheet" href={FONT_META[baseEmpresa.heading_font].url} />
                )}
                <style>{`
                  :root {
                    --tenant-primary: ${safeTenantColor(themedEmpresa.color_primario, "#0052cc")};
                    --tenant-accent: #ffd6c0;
                    --tenant-fondo: ${safeTenantColor(themedEmpresa.color_fondo, "#061a3d")};
                    --tenant-texto: ${safeTenantColor(themedEmpresa.color_texto, "#f8fafc")};
                    ${baseEmpresa.color_superficie && HEX_COLOR_RE.test(baseEmpresa.color_superficie) ? `--tenant-superficie: ${baseEmpresa.color_superficie};` : ""}
                    --tenant-radius: ${baseEmpresa.border_radius && BORDER_RADIUS_MAP[baseEmpresa.border_radius] ? BORDER_RADIUS_MAP[baseEmpresa.border_radius] : "12px"};
                    ${baseEmpresa.font && FONT_META[baseEmpresa.font] ? `--tenant-font: ${FONT_META[baseEmpresa.font].family};` : ""}
                    ${baseEmpresa.heading_font && FONT_META[baseEmpresa.heading_font] ? `--tenant-heading-font: ${FONT_META[baseEmpresa.heading_font].family};` : ""}
                    /* Contempla el logo: un logo grande sobre un navbar chico
                       agranda la barra, y si el clearance no acompaña el
                       contenido de todas las páginas queda tapado. */
                    --tenant-navbar-h: ${tenantNavbarHeightPx(baseEmpresa.logo_size, baseEmpresa.navbar_size)}px;
                  }
                  ${baseEmpresa.font && FONT_META[baseEmpresa.font] ? `body { font-family: var(--tenant-font); }` : ""}
                  ${baseEmpresa.heading_font && FONT_META[baseEmpresa.heading_font] ? `h1,h2,h3,h4,h5,h6 { font-family: var(--tenant-heading-font); }` : ""}
                `}</style>
                {children}
              </ConsumiblesCartProvider>
            </CartProvider>
          </TenantPreviewEditContext.Provider>
        </TenantContext.Provider>
      </TenantSalesReadinessContext.Provider>
    </TenantThemeContext.Provider>
  )
}
