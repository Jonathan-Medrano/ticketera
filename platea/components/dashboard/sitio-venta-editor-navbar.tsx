"use client"

import { useRouter } from "next/navigation"
import { ArrowLeft, Copy, ExternalLink, MoreVertical, RotateCcw, Save } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { SitioVentaEditor } from "./sitio-venta/use-sitio-venta-editor"

export function SitioVentaEditorNavbar({ editor }: { editor: SitioVentaEditor }) {
  const router = useRouter()

  function handleVolver() {
    editor.handleGuardedAction(() => {
      if (typeof window !== "undefined" && window.opener) {
        window.close()
        return
      }
      router.push("/dashboard")
    })
  }

  function handleVerSitio() {
    window.open(editor.publicUrl, "_blank", "noopener,noreferrer")
  }

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-3 sm:px-4">
      <div className="flex min-w-0 items-center gap-2">
        <Button type="button" variant="ghost" size="sm" className="h-9 gap-1.5 px-2" onClick={handleVolver}>
          <ArrowLeft className="h-4 w-4" />
          <span className="hidden sm:inline">Volver</span>
        </Button>
        <div className="hidden h-5 w-px bg-border sm:block" />
        <div className="min-w-0 hidden sm:block">
          <p className="truncate text-sm font-semibold text-foreground">Editor de sitio de venta</p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="hidden items-center gap-1.5 text-xs text-muted-foreground md:flex">
          <span className={`h-1.5 w-1.5 rounded-full ${editor.draftLoaded && editor.formChanged ? "bg-primary" : "bg-muted-foreground/40"}`} />
          {editor.draftLoaded ? (editor.formChanged ? "Cambios sin guardar" : "Sin cambios pendientes") : "Cargando..."}
        </span>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="sm" className="h-9 gap-1.5 px-2">
              <MoreVertical className="h-4 w-4" />
              <span className="hidden sm:inline">Opciones</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onSelect={() => editor.copiarUrlPublica()}>
              <Copy className="h-4 w-4" /> Copiar URL
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={handleVerSitio}>
              <ExternalLink className="h-4 w-4" /> Ver sitio
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!editor.formChanged || !editor.canEdit}
              onSelect={() => editor.setRestoreConfirmOpen(true)}
            >
              <RotateCcw className="h-4 w-4" /> Restaurar
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          type="button"
          className={`h-9 gap-1.5 transition-shadow duration-300 ${
            editor.formChanged && editor.canEdit
              ? "shadow-[0_0_0_2px_hsl(var(--primary)/0.35),0_0_14px_hsl(var(--primary)/0.2)]"
              : ""
          }`}
          disabled={!editor.canEdit}
          onClick={() => editor.handleGuardar()}
        >
          <Save className="h-4 w-4" />
          Guardar
        </Button>
      </div>
    </header>
  )
}
