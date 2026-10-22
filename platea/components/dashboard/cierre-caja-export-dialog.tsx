"use client"

import { useEffect, useState } from "react"
import { Download, FileSpreadsheet, FileText, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DASHBOARD_DATE_PRESETS, matchActivePreset } from "@/lib/date-presets"
import { cn } from "@/lib/utils"

export type CierreCajaExportDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  eventos: Array<{ id: string; nombre: string }>
  /** Período actual del dashboard — se hereda como sugerencia pero se puede sobrescribir. */
  initialPeriodo: { desde: string | null; hasta: string | null }
  /** Evento actual filtrado en el dashboard — sugerencia inicial. */
  initialEventoId: string
}

type ExportFormat = "csv" | "xlsx"

export default function CierreCajaExportDialog({
  open,
  onOpenChange,
  eventos,
  initialPeriodo,
  initialEventoId,
}: CierreCajaExportDialogProps) {
  const [desde, setDesde] = useState<string>(initialPeriodo.desde ?? "")
  const [hasta, setHasta] = useState<string>(initialPeriodo.hasta ?? "")
  const [eventoId, setEventoId] = useState<string>(initialEventoId || "todos")
  const [format, setFormat] = useState<ExportFormat>("xlsx")
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Reset al re-abrir con valores frescos del dashboard actual
  useEffect(() => {
    if (open) {
      setDesde(initialPeriodo.desde ?? "")
      setHasta(initialPeriodo.hasta ?? "")
      setEventoId(initialEventoId || "todos")
      setFormat("xlsx")
    }
  }, [open, initialPeriodo.desde, initialPeriodo.hasta, initialEventoId])

  const activePresetId = matchActivePreset(desde || null, hasta || null)

  function applyPreset(presetId: string) {
    const preset = DASHBOARD_DATE_PRESETS.find((p) => p.id === presetId)
    if (!preset) return
    const { desde: newDesde, hasta: newHasta } = preset.compute()
    setDesde(newDesde)
    setHasta(newHasta)
  }

  async function submit() {
    if (isSubmitting) return

    if (desde && hasta && desde > hasta) {
      toast.error("'Desde' debe ser anterior o igual a 'Hasta'")
      return
    }

    setIsSubmitting(true)
    try {
      const params = new URLSearchParams()
      if (desde) params.set("desde", desde)
      if (hasta) params.set("hasta", hasta)
      if (eventoId && eventoId !== "todos") params.set("evento", eventoId)
      params.set("format", format)

      const res = await fetch(`/api/dashboard/cierre-caja/export?${params.toString()}`)
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null
        toast.error(data?.error ?? "No se pudo exportar el resumen")
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      const ext = format === "xlsx" ? "xlsx" : "csv"
      const sufijo = desde && hasta
        ? `${desde}_${hasta}`
        : `ultimos-30-dias-${new Date().toISOString().slice(0, 10)}`
      a.download = `cierre-caja-${sufijo}.${ext}`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      toast.success(`Resumen exportado (${format.toUpperCase()})`)
      onOpenChange(false)
    } catch {
      toast.error("Error de red — no se pudo contactar al backend")
    } finally {
      setIsSubmitting(false)
    }
  }

  const noFiltroAclaracion = !desde && !hasta

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!isSubmitting) onOpenChange(next) }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            Exportar resumen
          </DialogTitle>
          <DialogDescription>
            Exportá el resumen de ventas por período y evento en Excel o CSV. Sin fechas, se usan los últimos 30 días.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Presets */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Período rápido</Label>
            <div className="flex flex-wrap gap-1.5">
              {DASHBOARD_DATE_PRESETS.map((preset) => {
                const isActive = activePresetId === preset.id
                return (
                  <Badge
                    key={preset.id}
                    variant={isActive ? "default" : "outline"}
                    className={cn(
                      "cursor-pointer select-none transition-all px-2.5 py-1 text-[11px]",
                      isActive
                        ? "font-semibold ring-2 ring-primary/30 hover:bg-primary/90"
                        : "font-normal text-muted-foreground hover:bg-accent hover:text-foreground",
                    )}
                    onClick={() => applyPreset(preset.id)}
                  >
                    {isActive ? "✓ " : ""}{preset.label}
                  </Badge>
                )
              })}
            </div>
          </div>

          {/* Date inputs */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Desde</Label>
              <Input
                type="date"
                className="h-11 bg-background"
                value={desde}
                max={hasta || undefined}
                onChange={(e) => setDesde(e.target.value)}
                disabled={isSubmitting}
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-medium text-muted-foreground">Hasta</Label>
                {(desde || hasta) ? (
                  <button
                    type="button"
                    onClick={() => { setDesde(""); setHasta("") }}
                    disabled={isSubmitting}
                    className="text-xs font-medium text-red-500 transition-colors hover:text-red-600 disabled:opacity-50"
                  >
                    &times; Limpiar fechas
                  </button>
                ) : null}
              </div>
              <Input
                type="date"
                className="h-11 bg-background"
                value={hasta}
                min={desde || undefined}
                onChange={(e) => setHasta(e.target.value)}
                disabled={isSubmitting}
              />
            </div>
          </div>

          {/* Evento */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Evento</Label>
            <Select value={eventoId} onValueChange={setEventoId} disabled={isSubmitting}>
              <SelectTrigger className="h-11 w-full bg-background">
                <SelectValue placeholder="Todos los eventos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos los eventos (con descuentos)</SelectItem>
                {eventos.map((ev) => (
                  <SelectItem key={ev.id} value={ev.id}>
                    {ev.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {eventoId !== "todos" ? (
              <p className="text-[11px] text-muted-foreground">
                Filtro por evento activo — los descuentos empresa-wide NO se incluyen (evitan distorsión).
              </p>
            ) : null}
          </div>

          {/* Format */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Formato</Label>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={format === "xlsx" ? "default" : "outline"}
                className="h-9 gap-2"
                onClick={() => setFormat("xlsx")}
                disabled={isSubmitting}
              >
                <FileSpreadsheet className="h-4 w-4" />
                Excel
              </Button>
              <Button
                type="button"
                variant={format === "csv" ? "default" : "outline"}
                className="h-9 gap-2"
                onClick={() => setFormat("csv")}
                disabled={isSubmitting}
              >
                <FileText className="h-4 w-4" />
                CSV
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter className="sm:justify-between">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={isSubmitting} className="gap-2">
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {isSubmitting ? "Exportando..." : "Exportar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
