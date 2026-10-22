"use client"

import { useEffect } from "react"
import { Button } from "@/components/ui/button"

export default function SuperAdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 px-4 text-center">
      <div className="flex flex-col items-center gap-2">
        <h1 className="text-xl font-semibold text-foreground">Algo salió mal</h1>
        <p className="max-w-xs text-sm text-muted-foreground">
          No se pudo cargar esta sección. Revisá los logs o intentá de nuevo.
        </p>
      </div>
      <div className="flex gap-3">
        <Button variant="outline" onClick={reset}>
          Reintentar
        </Button>
        <Button onClick={() => (window.location.href = "/super-admin/dashboard")}>
          Ir al dashboard
        </Button>
      </div>
    </div>
  )
}
