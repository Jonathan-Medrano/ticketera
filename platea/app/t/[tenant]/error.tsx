"use client"

import { useEffect } from "react"

export default function TenantError({
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
    <div
      className="flex min-h-[60vh] flex-col items-center justify-center gap-6 px-4 text-center"
      style={{ background: "var(--tenant-fondo)", color: "var(--tenant-texto)" }}
    >
      <div className="flex flex-col items-center gap-2">
        <h1 className="text-xl font-semibold">Algo salió mal</h1>
        <p className="max-w-xs text-sm" style={{ opacity: 0.6 }}>
          No pudimos cargar esta página. Por favor, intentá de nuevo.
        </p>
      </div>
      <button
        type="button"
        onClick={reset}
        className="rounded-lg px-5 py-2.5 text-sm font-medium transition-opacity hover:opacity-80"
        style={{ background: "var(--tenant-primary)", color: "#fff" }}
      >
        Intentar de nuevo
      </button>
    </div>
  )
}
