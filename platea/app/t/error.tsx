"use client"

import { useEffect } from "react"

export default function TenantShellError({
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
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-gray-950 px-4 text-center text-gray-100">
      <div className="flex flex-col items-center gap-2">
        <h1 className="text-xl font-semibold">Algo salió mal</h1>
        <p className="max-w-xs text-sm text-gray-400">
          No pudimos cargar esta página. Por favor, intentá de nuevo.
        </p>
      </div>
      <button
        type="button"
        onClick={reset}
        className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-80"
      >
        Intentar de nuevo
      </button>
    </div>
  )
}
