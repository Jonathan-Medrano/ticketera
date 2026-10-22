"use client"

import { useState } from "react"
import { FileSpreadsheet, FileText, Download, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"

type ExportFormat = "xlsx" | "csv"

function resolveCsvFileName(disposition: string | null | undefined, fallback: string) {
  return disposition?.match(/filename="?([^";]+)"?/)?.[1] ?? fallback
}

interface Props {
  eventos: { id: string; nombre: string }[]
  eventoIdActivo?: string
}

export function BarrasExportAction({ eventos, eventoIdActivo }: Props) {
  const [isOpen, setIsOpen] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [eventoId, setEventoId] = useState(eventoIdActivo ?? "")
  const [formato, setFormato] = useState<ExportFormat>("xlsx")

  function handleOpen() {
    setEventoId(eventoIdActivo ?? "")
    setIsOpen(true)
  }

  async function handleExport() {
    if (!eventoId || isExporting) return
    setIsExporting(true)

    try {
      const url = `/api/consumibles/barras/export?evento_id=${encodeURIComponent(eventoId)}&formato=${formato}`
      const response = await fetch(url, { method: "GET" })

      if (!response.ok) { toast.error("No se pudo exportar"); return }

      const blob = await response.blob()
      const downloadUrl = window.URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = downloadUrl
      link.download = resolveCsvFileName(
        response.headers.get("content-disposition"),
        formato === "xlsx" ? `barras-resumen-${eventoId}.xlsx` : `barras-resumen-${eventoId}.csv`
      )
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(downloadUrl)
      toast.success("Exportación lista")
    } finally {
      setIsExporting(false)
      setIsOpen(false)
    }
  }

  if (eventos.length === 0) return null

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="gap-2 h-10"
        onClick={handleOpen}
        disabled={isExporting}
      >
        {isExporting ? "Procesando..." : "Exportar resumen"}
      </Button>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Exportar resumen de barras</DialogTitle>
            <DialogDescription>
              Elegí el evento y el formato para exportar el resumen de todas sus barras.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-muted-foreground">
                Evento <span className="text-destructive">*</span>
              </label>
              <Select value={eventoId} onValueChange={setEventoId}>
                <SelectTrigger className="h-11 w-full bg-background">
                  <SelectValue placeholder="Seleccioná un evento..." />
                </SelectTrigger>
                <SelectContent>
                  {eventos.map((ev) => (
                    <SelectItem key={ev.id} value={ev.id}>
                      {ev.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Formato</Label>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={formato === "xlsx" ? "default" : "outline"}
                  className="h-9 gap-2"
                  onClick={() => setFormato("xlsx")}
                >
                  <FileSpreadsheet className="h-4 w-4" />
                  Excel
                </Button>
                <Button
                  type="button"
                  variant={formato === "csv" ? "default" : "outline"}
                  className="h-9 gap-2"
                  onClick={() => setFormato("csv")}
                >
                  <FileText className="h-4 w-4" />
                  CSV
                </Button>
              </div>
            </div>
          </div>

          <DialogFooter className="sm:justify-between">
            <Button type="button" variant="outline" onClick={() => setIsOpen(false)} disabled={isExporting}>
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={() => void handleExport()}
              disabled={isExporting || !eventoId}
              className="gap-2"
            >
              {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {isExporting ? "Exportando..." : "Exportar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
