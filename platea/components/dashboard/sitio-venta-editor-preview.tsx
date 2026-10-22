"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Loader2, Monitor, RefreshCw, Smartphone } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  buildTenantPreviewOverride,
  TENANT_PREVIEW_FIELD_EDIT_TYPE,
  TENANT_PREVIEW_MESSAGE_TYPE,
  TENANT_PREVIEW_NAVIGATION_TYPE,
  TENANT_PREVIEW_QUERY_FLAG,
  TENANT_PREVIEW_READY_TYPE,
  type TenantPreviewFieldEditPayload,
} from "@/lib/tenant-preview-override"
import type { SitioVentaEditorSection } from "./sitio-venta-editor-sidebar"
import type { EventoPasadoOption, SitioVentaForm } from "./sitio-venta/types"

type PreviewViewport = "desktop" | "mobile"

/**
 * Maps the page currently shown inside the preview iframe to the editor section
 * most relevant to it, so the sidebar follows along instead of staying on whatever
 * was selected before navigating. Home/soporte/información have a dedicated
 * section; everything else (evento, checkout, mis-tickets, etc.) falls back to
 * "branding" since that's the only section whose settings (navbar, colores, logo)
 * are actually visible on those pages.
 */
function mapPreviewPathToSection(relativePath: string): SitioVentaEditorSection {
  if (relativePath === "" || relativePath === "/") return "home"
  if (relativePath.startsWith("/soporte")) return "soporte"
  if (relativePath.startsWith("/informacion")) return "informacion"
  return "branding"
}

/** Ancho fijo del iframe en modo mobile — el mismo viewport width que usa el resto
 * de la auditoría de responsive del proyecto (375-390px, rango real de celulares). */
const MOBILE_PREVIEW_WIDTH = 390

/**
 * Live preview panel for the sitio-venta editor. Renders the tenant storefront
 * (same origin, /t/[slug] path — the public subdomain would be blocked by
 * X-Frame-Options: SAMEORIGIN) inside an iframe, and keeps it in sync with the
 * in-memory draft via postMessage — no save required to see changes reflected.
 *
 * Handshake: the iframe (TenantProvider, in preview mode) posts
 * TENANT_PREVIEW_READY_TYPE once its message listener is mounted. Only after
 * that do we send snapshots — posting earlier would race the listener setup.
 * Subsequent form changes are batched to one postMessage per animation frame.
 */
export function SitioVentaEditorPreview({
  previewPath,
  form,
  eventosPasados = [],
  onNavigate,
  onFieldEdit,
}: {
  previewPath: string
  form: SitioVentaForm
  /** Eventos pasados en memoria (mismo dataset del selector) — permite que la card
   * de testimonio anclado a un evento se vea correcta en vivo, sin guardar. */
  eventosPasados?: EventoPasadoOption[]
  /** Se llama cuando el usuario navega dentro del iframe de preview (ej: entra a un
   * evento) con la sección del editor más relevante para esa página. */
  onNavigate?: (section: SitioVentaEditorSection) => void
  /** Inline-edit spike (fase 3): se llama cuando el usuario edita un campo directo
   * sobre el preview (hoy solo `titulo_eventos_home`, ver components/tenant/editable-text.tsx). */
  onFieldEdit?: (field: TenantPreviewFieldEditPayload["field"], value: string) => void
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const formRef = useRef(form)
  const eventosPasadosRef = useRef(eventosPasados)
  const rafRef = useRef<number | null>(null)
  const [previewKey, setPreviewKey] = useState(0)
  const [ready, setReady] = useState(false)
  const [viewport, setViewport] = useState<PreviewViewport>("desktop")

  const previewSrc = `${previewPath}${previewPath.includes("?") ? "&" : "?"}${TENANT_PREVIEW_QUERY_FLAG}=1`

  const sendSnapshot = useCallback(() => {
    const win = iframeRef.current?.contentWindow
    if (!win) return
    win.postMessage(
      {
        type: TENANT_PREVIEW_MESSAGE_TYPE,
        version: 1,
        payload: buildTenantPreviewOverride(formRef.current, eventosPasadosRef.current),
      },
      window.location.origin
    )
  }, [])

  // Keep the latest form in a ref (read inside the rAF callback below) without
  // re-subscribing the message listener effect on every keystroke.
  useEffect(() => {
    formRef.current = form
    eventosPasadosRef.current = eventosPasados
    if (!ready) return

    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      sendSnapshot()
    })

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [form, eventosPasados, ready, sendSnapshot])

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return
      if (event.source !== iframeRef.current?.contentWindow) return

      if (event.data?.type === TENANT_PREVIEW_READY_TYPE) {
        setReady(true)
        sendSnapshot()
        return
      }

      if (event.data?.type === TENANT_PREVIEW_NAVIGATION_TYPE && onNavigate) {
        const path = typeof event.data.path === "string" ? event.data.path : ""
        const relativePath = path.startsWith(previewPath) ? path.slice(previewPath.length) : path
        onNavigate(mapPreviewPathToSection(relativePath))
      }

      if (event.data?.type === TENANT_PREVIEW_FIELD_EDIT_TYPE && onFieldEdit) {
        const payload = event.data.payload as Partial<TenantPreviewFieldEditPayload> | undefined
        if (payload?.field === "titulo_eventos_home" && typeof payload.value === "string") {
          onFieldEdit(payload.field, payload.value)
        }
      }
    }

    window.addEventListener("message", handleMessage)
    return () => window.removeEventListener("message", handleMessage)
    // previewKey re-runs the handshake wait after a manual "Refrescar" remounts the iframe.
  }, [sendSnapshot, previewKey, onNavigate, onFieldEdit, previewPath])

  function handleRefrescar() {
    setReady(false)
    setPreviewKey((key) => key + 1)
  }

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <p className="hidden text-xs text-muted-foreground sm:block">
          Vista previa en vivo — refleja los cambios sin guardar
        </p>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-lg border border-border bg-muted/40 p-0.5">
            <button
              type="button"
              onClick={() => setViewport("desktop")}
              aria-label="Ver en modo escritorio"
              aria-pressed={viewport === "desktop"}
              className={cn(
                "flex h-7 w-8 items-center justify-center rounded-md transition-colors",
                viewport === "desktop"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Monitor className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setViewport("mobile")}
              aria-label="Ver en modo celular"
              aria-pressed={viewport === "mobile"}
              className={cn(
                "flex h-7 w-8 items-center justify-center rounded-md transition-colors",
                viewport === "mobile"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Smartphone className="h-3.5 w-3.5" />
            </button>
          </div>
          <Button type="button" variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs" onClick={handleRefrescar}>
            <RefreshCw className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Refrescar</span>
          </Button>
        </div>
      </div>
      <div
        className={cn(
          "relative min-h-0 flex-1 bg-muted/30",
          viewport === "mobile" && "flex items-start justify-center overflow-y-auto py-6",
        )}
      >
        {!ready && (
          <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 bg-muted/30 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Cargando vista previa...
          </div>
        )}
        <iframe
          key={previewKey}
          ref={iframeRef}
          src={previewSrc}
          className={cn(
            "border-0",
            viewport === "mobile"
              ? "h-[780px] shrink-0 rounded-[2rem] border-8 border-foreground/80 shadow-xl"
              : "h-full w-full",
          )}
          style={viewport === "mobile" ? { width: MOBILE_PREVIEW_WIDTH } : undefined}
          title="Vista previa en vivo del sitio de venta"
        />
      </div>
    </div>
  )
}
