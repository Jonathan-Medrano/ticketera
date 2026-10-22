"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { useLoading } from "@/components/loading-provider"
import { puedeHacer, type Permisos } from "@/lib/permisos"
import { buildTenantPath, buildTenantPublicUrl } from "@/lib/tenant-routes"
import {
  buildSitioVentaPayload,
  createSitioVentaInitialForm,
  isValidSupportContactEmail,
  sanitizeSitioVentaDraft,
} from "./form-helpers"
import type { PLANTILLAS_SITIO } from "./branding-section"
import type { SitioVentaEmpresa, SitioVentaForm } from "./types"

/**
 * All state + persistence + save logic for the "sitio de venta" editor, extracted
 * from the old sitio-venta-content.tsx (tabs) so the new shell (navbar + sidebar +
 * live preview) can consume it without duplicating behavior. Behavior is unchanged:
 * same localStorage draft key, same validations, same PATCH payload, same toasts.
 */
export function useSitioVentaEditor({
  empresa,
  permisos,
  esEmpleado,
}: {
  empresa: SitioVentaEmpresa
  permisos?: Permisos
  esEmpleado?: boolean
}) {
  const puede = (permiso: keyof Permisos) => puedeHacer(permiso, esEmpleado ?? false, permisos)
  const canEdit = puede("editar_configuracion")
  const router = useRouter()
  const { withLoading } = useLoading()
  const [draftLoaded, setDraftLoaded] = useState(false)
  const didApplyDraft = useRef(false)

  const initialForm = useMemo<SitioVentaForm>(() => createSitioVentaInitialForm(empresa), [empresa])
  const [form, setForm] = useState<SitioVentaForm>(initialForm)

  const draftKey = useMemo(() => `sitio-venta-draft:${empresa.id}`, [empresa.id])
  const formChanged = JSON.stringify(form) !== JSON.stringify(initialForm)
  const publicUrl = buildTenantPublicUrl(empresa.slug)
  // Use the internal path for the preview iframe so it loads from the same origin as the
  // dashboard — the subdomain URL would be blocked by X-Frame-Options: SAMEORIGIN.
  const previewPath = buildTenantPath(empresa.slug, "/")

  const [navGuardOpen, setNavGuardOpen] = useState(false)
  const [pendingHref, setPendingHref] = useState<string | null>(null)
  const pendingActionRef = useRef<(() => void) | null>(null)
  const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false)

  // Escape hatch genérico: cualquier salida del editor (navegar a un href, cerrar
  // la ventana, etc.) pasa por acá para respetar el mismo aviso de "cambios sin
  // guardar" que ya usaba InformacionSection vía handleNavigateAway.
  function handleGuardedAction(action: () => void) {
    if (!formChanged) {
      action()
      return
    }
    pendingActionRef.current = action
    setNavGuardOpen(true)
  }

  function handleNavigateAway(href: string) {
    setPendingHref(formChanged ? href : null)
    handleGuardedAction(() => router.push(href))
  }

  function confirmNavigation() {
    setNavGuardOpen(false)
    const action = pendingActionRef.current
    pendingActionRef.current = null
    setPendingHref(null)
    action?.()
  }

  useEffect(() => {
    if (didApplyDraft.current) return
    didApplyDraft.current = true

    try {
      const raw = window.localStorage.getItem(draftKey)
      if (!raw) {
        setDraftLoaded(true)
        return
      }

      const parsed = sanitizeSitioVentaDraft(JSON.parse(raw))
      setForm((prev) => ({ ...prev, ...parsed }))
    } catch {
      // ignore invalid draft
    } finally {
      setDraftLoaded(true)
    }
  }, [draftKey])

  useEffect(() => {
    if (!draftLoaded) return
    try {
      window.localStorage.setItem(draftKey, JSON.stringify(form))
    } catch {
      // ignore storage issues
    }
  }, [draftLoaded, draftKey, form])

  async function handleGuardar(e?: React.FormEvent) {
    e?.preventDefault()

    const invalidInfoPage = form.info_pages.find((page) => page.enabled && page.content.trim().length === 0)
    if (invalidInfoPage) {
      toast.error(`Completá el contenido de "${invalidInfoPage.title || "esta página"}" antes de guardar`)
      return
    }

    if (form.support_contact_email.trim() && !isValidSupportContactEmail(form.support_contact_email)) {
      toast.error("Ingresá un email de soporte válido o dejalo vacío para ocultar el formulario público")
      return
    }

    await withLoading(async () => {
      const res = await fetch("/api/sitio-venta", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildSitioVentaPayload(form)),
      })

      const data = await res.json()

      if (!res.ok) {
        toast.error(data.error ?? "Error al guardar los cambios")
        return
      }

      toast.success("Cambios guardados — el sitio puede demorar ~30 segundos en reflejar los cambios")
      try {
        window.localStorage.removeItem(draftKey)
        window.localStorage.setItem("ticketera_sitio_configurado", "true")
      } catch {
        // ignore storage issues
      }
      router.refresh()
    })
  }

  function aplicarPlantilla(plantilla: (typeof PLANTILLAS_SITIO)[number]) {
    setForm((prev) => ({
      ...prev,
      color_primario: plantilla.color_primario,
      color_fondo: plantilla.color_fondo,
      color_texto: plantilla.color_texto,
      border_radius: plantilla.border_radius,
      button_style: plantilla.button_style,
      font: plantilla.font,
      heading_font: plantilla.heading_font,
    }))
  }

  async function copiarUrlPublica() {
    try {
      await navigator.clipboard.writeText(publicUrl)
      toast.success("URL copiada al portapapeles")
    } catch {
      toast.error("No se pudo copiar la URL")
    }
  }

  function restaurarCambios() {
    setForm(initialForm)
    try {
      window.localStorage.removeItem(draftKey)
    } catch {
      // ignore storage issues
    }
    toast.success("Volviste al último estado guardado")
  }

  return {
    form,
    setForm,
    initialForm,
    draftLoaded,
    formChanged,
    canEdit,
    publicUrl,
    previewPath,
    handleGuardar,
    aplicarPlantilla,
    copiarUrlPublica,
    restaurarCambios,
    navGuardOpen,
    setNavGuardOpen,
    pendingHref,
    handleNavigateAway,
    handleGuardedAction,
    confirmNavigation,
    restoreConfirmOpen,
    setRestoreConfirmOpen,
  }
}

export type SitioVentaEditor = ReturnType<typeof useSitioVentaEditor>
