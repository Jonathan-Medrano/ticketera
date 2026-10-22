"use client"

import { useCallback, useEffect, useState } from "react"
import dynamic from "next/dynamic"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type { Permisos } from "@/lib/permisos"
import { useSitioVentaEditor } from "./sitio-venta/use-sitio-venta-editor"
import { SitioVentaEditorNavbar } from "./sitio-venta-editor-navbar"
import {
  SITIO_VENTA_EDITOR_SECTIONS,
  SitioVentaEditorSidebar,
  type SitioVentaEditorSection,
} from "./sitio-venta-editor-sidebar"
import { SitioVentaEditorPreview } from "./sitio-venta-editor-preview"
import {
  AnnouncementSection,
  BrandingVisualSection,
  EditorialHomeSection,
  EventCardsSection,
  LayoutHomeSection,
  ImagenesSection,
  InformacionSection,
  PlantillasGuardadasSection,
  PresentacionHomeSection,
  SocialLinksSection,
  type GaleriaFotoItem,
  type SitioVentaEmpresa,
} from "./sitio-venta-sections"
import type { EventoPasadoOption } from "./sitio-venta/types"

// Preserves the dynamic import from the old tabs-based editor: SectionsOrderManager
// pulls in a drag-and-drop lib that has no reason to ship in the initial bundle.
const SectionsOrderManager = dynamic(
  () =>
    import("@/components/dashboard/sitio-venta/sections-order-manager").then(
      (m) => ({ default: m.SectionsOrderManager }),
    ),
  { ssr: false, loading: () => <div className="h-64 animate-pulse rounded-lg bg-muted" /> },
)

// FaqSection ahora reordena preguntas con dnd-kit (Fase 1 del plan de mejoras del
// editor) — mismo motivo que SectionsOrderManager arriba: no cargar la lib de
// drag-and-drop hasta que el organizador entra a la pestaña de soporte/FAQ.
const FaqSection = dynamic(
  () => import("@/components/dashboard/sitio-venta/faq-section").then((m) => ({ default: m.FaqSection })),
  { ssr: false, loading: () => <div className="h-64 animate-pulse rounded-lg bg-muted" /> },
)

export default function SitioVentaEditorShell({
  empresa,
  permisos,
  esEmpleado,
  eventosPasados = [],
}: {
  empresa: SitioVentaEmpresa
  permisos?: Permisos
  esEmpleado?: boolean
  /** Eventos pasados/finalizados del tenant — para "Vincular a un evento" en el bloque testimonios. */
  eventosPasados?: EventoPasadoOption[]
}) {
  const editor = useSitioVentaEditor({ empresa, permisos, esEmpleado })
  const activeSectionStorageKey = `sitio-venta-active-section:${empresa.id}`
  const [activeSection, setActiveSectionState] = useState<SitioVentaEditorSection>("branding")
  const { form, setForm, canEdit } = editor

  // Restaura la última sección visitada (mismo criterio que el `activeTab` del editor viejo).
  useEffect(() => {
    if (typeof window === "undefined") return
    const stored = window.localStorage.getItem(activeSectionStorageKey)
    const isValid = SITIO_VENTA_EDITOR_SECTIONS.some((section) => section.value === stored)
    if (isValid) setActiveSectionState(stored as SitioVentaEditorSection)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al montar, la key no cambia en la vida del componente
  }, [])

  // useCallback — no solo estilo: sitio-venta-editor-preview.tsx re-suscribe su listener
  // de `message` cada vez que esta prop (pasada como onNavigate) cambia de identidad.
  // Una función recreada en cada render abre una ventana de carrera donde el handshake
  // "ready" del iframe puede llegar justo en el gap remove/add y perderse para siempre
  // (bug real encontrado con E2E en vivo, ver sitio-venta-inline-edit.spec.ts — el
  // preview quedaba colgado en "Cargando..." de forma intermitente).
  const setActiveSection = useCallback((section: SitioVentaEditorSection) => {
    setActiveSectionState(section)
    if (typeof window !== "undefined") {
      window.localStorage.setItem(activeSectionStorageKey, section)
    }
  }, [activeSectionStorageKey])

  // Mismo motivo que setActiveSection arriba: identidad estable para no reabrir la
  // ventana de carrera del handshake de preview en cada keystroke del formulario.
  const handlePreviewFieldEdit = useCallback((field: "titulo_eventos_home", value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }))
  }, [setForm])

  return (
    <div className="flex min-h-screen flex-col bg-background lg:h-screen lg:overflow-hidden">
      <SitioVentaEditorNavbar editor={editor} />

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <SitioVentaEditorSidebar activeSection={activeSection} onSelectSection={setActiveSection} />

        <div className="flex min-w-0 flex-1 flex-col lg:flex-row lg:overflow-hidden">
          <div className="@container min-w-0 shrink-0 lg:w-[380px] lg:overflow-y-auto lg:border-r lg:border-border xl:w-[420px]">
            <fieldset disabled={!canEdit} className="min-w-0 space-y-4 p-4 md:p-6">
              {!canEdit && (
                <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
                  Tenés acceso para ver la configuración, pero no para editarla. Si necesitás cambios, pedile permiso a un administrador.
                </div>
              )}

              {activeSection === "branding" && (
                <div className="space-y-4">
                  <BrandingVisualSection form={form} setForm={setForm} aplicarPlantilla={editor.aplicarPlantilla} />
                  <ImagenesSection form={form} setForm={setForm} />
                  <AnnouncementSection form={form} setForm={setForm} />
                  <SocialLinksSection form={form} setForm={setForm} />
                </div>
              )}

              {activeSection === "home" && (
                <div className="space-y-4">
                  <EditorialHomeSection form={form} setForm={setForm} />
                  <PresentacionHomeSection form={form} setForm={setForm} />
                  <LayoutHomeSection form={form} setForm={setForm} />
                  <EventCardsSection form={form} setForm={setForm} />
                  <SectionsOrderManager
                    sections={form.sections}
                    onChange={(sections) => setForm((prev) => ({ ...prev, sections }))}
                    galeria_fotos={form.galeria_fotos}
                    onGaleriaChange={(fotos: GaleriaFotoItem[]) => setForm((prev) => ({ ...prev, galeria_fotos: fotos }))}
                    canEdit={canEdit}
                    eventosPasados={eventosPasados}
                  />
                </div>
              )}

              {activeSection === "informacion" && (
                <div className="grid gap-4">
                  <InformacionSection form={form} onNavigateAway={editor.handleNavigateAway} />
                </div>
              )}

              {activeSection === "soporte" && (
                <div className="grid gap-4">
                  <FaqSection form={form} setForm={setForm} />
                </div>
              )}

              {activeSection === "plantillas" && (
                <div className="grid gap-4">
                  <PlantillasGuardadasSection form={form} setForm={setForm} />
                </div>
              )}
            </fieldset>
          </div>

          <div className="h-[50vh] min-w-0 shrink-0 border-t border-border lg:h-auto lg:flex-1 lg:border-t-0">
            <SitioVentaEditorPreview
              previewPath={editor.previewPath}
              form={form}
              eventosPasados={eventosPasados}
              onNavigate={setActiveSection}
              onFieldEdit={handlePreviewFieldEdit}
            />
          </div>
        </div>
      </div>

      <Dialog open={editor.navGuardOpen} onOpenChange={editor.setNavGuardOpen}>
        <DialogContent className="bg-card sm:max-w-sm p-6">
          <DialogHeader>
            <DialogTitle className="text-foreground">Tenés cambios sin guardar</DialogTitle>
            <DialogDescription className="text-muted-foreground text-sm mt-1">
              Si salís ahora, los cambios en el editor se van a perder.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2 mt-4">
            <Button type="button" variant="outline" className="flex-1 h-10" onClick={() => editor.setNavGuardOpen(false)}>
              Quedarme
            </Button>
            <Button type="button" className="flex-1 h-10" onClick={editor.confirmNavigation}>
              Salir igual
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={editor.restoreConfirmOpen} onOpenChange={editor.setRestoreConfirmOpen}>
        <DialogContent className="bg-card sm:max-w-sm p-6">
          <DialogHeader>
            <DialogTitle className="text-foreground">¿Descartar los cambios sin guardar?</DialogTitle>
            <DialogDescription className="text-muted-foreground text-sm mt-1">
              Vas a volver al último estado guardado y se pierden las ediciones actuales.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2 mt-4">
            <Button type="button" variant="outline" className="flex-1 h-10" onClick={() => editor.setRestoreConfirmOpen(false)}>
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="flex-1 h-10"
              onClick={() => {
                editor.restaurarCambios()
                editor.setRestoreConfirmOpen(false)
              }}
            >
              Descartar cambios
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
