"use client"

import { useCallback, useEffect, useState } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { useTenant } from "./tenant-provider"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import type { GaleriaFotoItem } from "@/lib/tenant"

export default function TenantGaleriaSection({ galeria }: { galeria: GaleriaFotoItem[] }) {
  const tenant = useTenant()
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)

  const count = galeria.length
  const selectedFoto = selectedIndex !== null ? galeria[selectedIndex] : null

  const prev = useCallback(() => {
    setSelectedIndex((i) => i !== null ? (i - 1 + count) % count : null)
  }, [count])

  const next = useCallback(() => {
    setSelectedIndex((i) => i !== null ? (i + 1) % count : null)
  }, [count])

  useEffect(() => {
    if (selectedIndex === null) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") prev()
      if (e.key === "ArrowRight") next()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [selectedIndex, prev, next])

  if (!count) return null

  return (
    <section className="w-full px-4 py-8 md:px-8">
      <h2 className="text-xl font-bold mb-6" style={{ color: tenant.color_texto }}>
        Galería
      </h2>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {galeria.map((foto, index) => (
          <button
            key={foto.id}
            type="button"
            className="relative aspect-square overflow-hidden rounded-lg focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary/50"
            style={{ borderColor: tenant.color_primario }}
            onClick={() => setSelectedIndex(index)}
          >
            <img
              src={foto.url}
              alt={foto.titulo || "Foto de galería"}
              className="w-full h-full object-cover transition-transform duration-200 hover:scale-105"
              loading="lazy"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none" }}
            />
          </button>
        ))}
      </div>

      <Dialog open={selectedIndex !== null} onOpenChange={(open) => { if (!open) setSelectedIndex(null) }}>
        <DialogContent
          className="w-[98vw] max-w-[1400px] p-2 pt-8 sm:p-4 sm:pt-10"
          style={{ background: tenant.color_fondo, color: tenant.color_texto, borderColor: `${tenant.color_primario}40` }}
        >
          <DialogTitle className="sr-only">
            {selectedFoto?.titulo || "Foto de galería"}
          </DialogTitle>
          {selectedFoto && (
            <div className="flex flex-col gap-3">
              <div className="relative flex items-center">
                <button
                  type="button"
                  onClick={prev}
                  aria-label="Foto anterior"
                  className="absolute left-2 z-10 flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-black/40 backdrop-blur-sm transition-colors hover:bg-black/60"
                >
                  <ChevronLeft className="h-5 w-5 text-white" />
                </button>

                <img
                  src={selectedFoto.url}
                  alt={selectedFoto.titulo || "Foto de galería"}
                  className="w-full rounded-lg object-contain"
                  style={{ maxHeight: "85vh" }}
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none" }}
                />

                <button
                  type="button"
                  onClick={next}
                  aria-label="Foto siguiente"
                  className="absolute right-2 z-10 flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-black/40 backdrop-blur-sm transition-colors hover:bg-black/60"
                >
                  <ChevronRight className="h-5 w-5 text-white" />
                </button>
              </div>

              <div className="flex items-center justify-between px-2">
                {selectedFoto.titulo
                  ? <p className="text-sm opacity-70">{selectedFoto.titulo}</p>
                  : <span />
                }
                <span className="text-xs opacity-40">{(selectedIndex ?? 0) + 1} / {count}</span>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  )
}
