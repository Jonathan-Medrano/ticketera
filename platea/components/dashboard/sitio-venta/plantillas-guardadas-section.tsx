"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { AlertTriangle, LayoutTemplate, Save, Sparkles, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useLoading } from "@/components/loading-provider"
import { formatDate } from "@/lib/format"
import { SectionCard } from "./shared-ui"
import { sanitizeSitioVentaDraft } from "./form-helpers"
import { aplicarPreset, SITIO_VENTA_PRESETS, type SitioVentaPreset } from "./presets"
import type { SitioVentaForm } from "./types"

// Fase A de sitio-venta-editor-plantillas-bloques: panel de plantillas guardables.
// A diferencia del resto de las secciones (que solo mutan `form` en memoria y se
// persisten juntas al apretar "Guardar" en el navbar), este panel hace su propio
// CRUD contra /api/sitio-venta/templates — el snapshot guardado/aplicado es
// independiente del guardado del sitio. "Aplicar" NUNCA persiste solo: mergea el
// snapshot sobre el form actual (mismo draft/dirty-state que cualquier otro campo),
// el usuario tiene que apretar "Guardar" para confirmarlo — y puede usar "Restaurar"
// si no le convence, igual que cualquier otro cambio sin guardar.

type SitioVentaTemplate = {
  id: string
  nombre: string
  snapshot: Record<string, unknown>
  created_at: string
  updated_at: string
}

const MAX_NOMBRE_LENGTH = 60

export function PlantillasGuardadasSection({
  form,
  setForm,
}: {
  form: SitioVentaForm
  setForm: React.Dispatch<React.SetStateAction<SitioVentaForm>>
}) {
  const { withLoading } = useLoading()
  const [templates, setTemplates] = useState<SitioVentaTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [saveDialogOpen, setSaveDialogOpen] = useState(false)
  const [nombreDraft, setNombreDraft] = useState("")

  const [deleteTarget, setDeleteTarget] = useState<SitioVentaTemplate | null>(null)

  async function loadTemplates() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/sitio-venta/templates")
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError(data?.error ?? "No se pudieron cargar las plantillas guardadas")
        return
      }
      setTemplates(Array.isArray(data?.data) ? data.data : [])
    } catch {
      setError("No se pudo conectar al servidor")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadTemplates()
  }, [])

  async function handleGuardarPlantilla(e?: React.FormEvent) {
    e?.preventDefault()
    const nombre = nombreDraft.trim()
    if (!nombre) {
      toast.error("Ingresá un nombre para la plantilla")
      return
    }

    await withLoading(async () => {
      const res = await fetch("/api/sitio-venta/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre, snapshot: form }),
      })
      const data = await res.json().catch(() => null)

      if (!res.ok) {
        toast.error(data?.error ?? "No se pudo guardar la plantilla")
        return
      }

      toast.success(`Plantilla "${nombre}" guardada`)
      setTemplates((prev) => [data.data, ...prev])
      setSaveDialogOpen(false)
      setNombreDraft("")
    })
  }

  function aplicarPlantilla(template: SitioVentaTemplate) {
    // Whitelist explícito de campos conocidos de SitioVentaForm — el snapshot es
    // JSON opaco que el backend no valida (ver sitio-venta-templates.ts), y este
    // es el mismo sanitizador que ya protege la carga del draft de localStorage.
    const parcial = sanitizeSitioVentaDraft(template.snapshot)
    setForm((prev) => ({ ...prev, ...parcial }))
    toast.success(`Plantilla "${template.nombre}" aplicada — revisá el preview y guardá para confirmar los cambios`)
  }

  async function handleEliminar() {
    if (!deleteTarget) return
    const target = deleteTarget
    await withLoading(async () => {
      const res = await fetch(`/api/sitio-venta/templates/${target.id}`, { method: "DELETE" })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        toast.error(data?.error ?? "No se pudo eliminar la plantilla")
        setDeleteTarget(null)
        return
      }
      setTemplates((prev) => prev.filter((t) => t.id !== target.id))
      toast.success(`Plantilla "${target.nombre}" eliminada`)
      setDeleteTarget(null)
    })
  }

  function aplicarPresetDeFabrica(preset: SitioVentaPreset) {
    // Mismo contrato que las guardadas: NO persiste solo. Mergea sobre el form
    // en memoria y el usuario decide si guarda o restaura.
    setForm((prev) => aplicarPreset(prev, preset))
    toast.success(`Plantilla "${preset.nombre}" aplicada — revisá el preview y guardá para confirmar`)
  }

  return (
    <>
      <SectionCard
        icon={Sparkles}
        title="Plantillas de fábrica"
        subtitle="Estilos listos para usar. Cambian colores, tipografía y layout — no tocan tu contenido"
        fullWidth
      >
        <div className="grid grid-cols-1 gap-3 @md:grid-cols-2 @xl:grid-cols-3">
          {SITIO_VENTA_PRESETS.map((preset) => (
            <div
              key={preset.id}
              className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3 transition-colors hover:border-primary/50"
            >
              {/* Miniatura: fondo + acento + superficie de la paleta real */}
              <div
                className="flex h-16 items-center gap-2 rounded-lg px-3"
                style={{ background: preset.swatch[0] }}
                aria-hidden
              >
                <span className="h-8 w-8 shrink-0 rounded-md" style={{ background: preset.swatch[1] }} />
                <span className="h-8 flex-1 rounded-md" style={{ background: preset.swatch[2] }} />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-foreground">{preset.nombre}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{preset.descripcion}</p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => aplicarPresetDeFabrica(preset)}
                className="w-full"
              >
                Aplicar
              </Button>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Aplicar no guarda nada: podés ver cómo queda en el preview y usar <b>Restaurar</b> si no te convence.
          Tu logo, banners, eventos, FAQs y páginas de información quedan intactos.
        </p>
      </SectionCard>

      <SectionCard
        icon={LayoutTemplate}
        title="Plantillas guardadas"
        subtitle="Guardá el estado completo del editor y volvé a aplicarlo cuando quieras"
        fullWidth
      >
        <div className="space-y-4">
          <div className="flex flex-col gap-3 @sm:flex-row @sm:items-center @sm:justify-between">
            <p className="text-xs text-muted-foreground max-w-md">
              Guardar captura branding, home, información y soporte tal como están ahora mismo en el editor.
            </p>
            <Button type="button" onClick={() => setSaveDialogOpen(true)} className="w-full shrink-0 @sm:w-auto">
              <Save className="h-4 w-4" /> Guardar plantilla actual
            </Button>
          </div>

          {loading ? (
            <div className="space-y-2">
              {[0, 1].map((i) => (
                <div key={i} className="h-16 animate-pulse rounded-xl bg-muted/40" />
              ))}
            </div>
          ) : error ? (
            <div className="flex flex-col gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 @sm:flex-row @sm:items-center @sm:justify-between">
              <p className="text-sm text-destructive">{error}</p>
              <Button type="button" variant="outline" size="sm" onClick={loadTemplates} className="shrink-0">
                Reintentar
              </Button>
            </div>
          ) : templates.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
              Todavía no guardaste ninguna plantilla — armá tu sitio como te guste y guardalo para reusarlo después.
            </div>
          ) : (
            <div className="space-y-2">
              {templates.map((template) => (
                <div
                  key={template.id}
                  className="flex flex-col gap-3 rounded-xl border border-border/60 bg-muted/30 p-3 @sm:flex-row @sm:items-center @sm:justify-between @sm:p-4"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">{template.nombre}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Guardada el {formatDate(template.created_at)}</p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => aplicarPlantilla(template)}>
                      Aplicar
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="text-destructive hover:bg-destructive/10"
                      onClick={() => setDeleteTarget(template)}
                      aria-label={`Eliminar plantilla ${template.nombre}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </SectionCard>

      <Dialog
        open={saveDialogOpen}
        onOpenChange={(open) => {
          setSaveDialogOpen(open)
          if (!open) setNombreDraft("")
        }}
      >
        <DialogContent className="bg-card sm:max-w-sm p-6">
          <DialogHeader>
            <DialogTitle className="text-foreground">Guardar plantilla actual</DialogTitle>
            <DialogDescription className="text-muted-foreground text-sm mt-1">
              Se guarda el estado completo del editor tal como está ahora mismo. Vas a poder aplicarlo de nuevo desde esta lista.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleGuardarPlantilla} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="plantilla-nombre" className="text-[13px] font-medium text-foreground/70">
                Nombre
              </Label>
              <Input
                id="plantilla-nombre"
                className="h-10"
                placeholder="Ej: Verano 2026"
                maxLength={MAX_NOMBRE_LENGTH}
                value={nombreDraft}
                onChange={(e) => setNombreDraft(e.target.value)}
                autoFocus
              />
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1 h-10" onClick={() => setSaveDialogOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" className="flex-1 h-10" disabled={!nombreDraft.trim()}>
                Guardar
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="bg-card sm:max-w-sm p-6">
          <DialogHeader>
            <DialogTitle className="text-foreground">¿Eliminar plantilla?</DialogTitle>
            <DialogDescription className="sr-only">Confirmar eliminación de plantilla guardada</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-xl border border-border/60 bg-muted/30 p-4">
              <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5 text-foreground" />
              <div>
                <p className="text-sm font-semibold text-foreground mb-1">
                  Se va a eliminar &ldquo;{deleteTarget?.nombre}&rdquo;
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed">Esta acción no se puede deshacer.</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1 h-10" onClick={() => setDeleteTarget(null)}>
                Cancelar
              </Button>
              <Button type="button" variant="destructive" className="flex-1 h-10" onClick={handleEliminar}>
                Eliminar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
