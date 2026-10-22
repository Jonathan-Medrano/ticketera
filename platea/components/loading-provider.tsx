"use client"

import { createContext, useContext, useState, useCallback, useEffect, useMemo } from "react"
import { Loader2 } from "lucide-react"
import { usePathname } from "next/navigation"

interface LoadingCtx {
  startLoading: () => void
  stopLoading: () => void
  withLoading: <T>(fn: () => Promise<T>) => Promise<T>
}

const LoadingContext = createContext<LoadingCtx | null>(null)

export function useLoading() {
  const ctx = useContext(LoadingContext)
  if (!ctx) throw new Error("useLoading must be used within LoadingProvider")
  return ctx
}

export default function LoadingProvider({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState(false)
  const [tenantTheme, setTenantTheme] = useState({ background: "", foreground: "", primary: "" })
  const pathname = usePathname()
  const isTenantRoute = pathname === "/" || pathname.startsWith("/t/") || pathname.startsWith("/auth") || pathname.startsWith("/evento") || pathname.startsWith("/checkout") || pathname.startsWith("/mis-tickets") || pathname.startsWith("/configuracion") || pathname.startsWith("/pago")

  useEffect(() => {
    if (!active || !isTenantRoute) return

    const rootStyles = getComputedStyle(document.documentElement)
    setTenantTheme({
      background: rootStyles.getPropertyValue("--tenant-fondo").trim(),
      foreground: rootStyles.getPropertyValue("--tenant-texto").trim(),
      primary: rootStyles.getPropertyValue("--tenant-primary").trim(),
    })
  }, [active, isTenantRoute, pathname])

  const startLoading = useCallback(() => setActive(true), [])
  const stopLoading = useCallback(() => setActive(false), [])

  const withLoading = useCallback(async <T,>(fn: () => Promise<T>): Promise<T> => {
    setActive(true)
    try {
      return await fn()
    } finally {
      setActive(false)
    }
  }, [])

  const contextValue = useMemo(() => ({ startLoading, stopLoading, withLoading }), [startLoading, stopLoading, withLoading])

  return (
    <LoadingContext.Provider value={contextValue}>
      {children}
      {active && (
        <div
          className="fixed inset-0 z-999 backdrop-blur-sm flex items-center justify-center"
          style={isTenantRoute && tenantTheme.background && tenantTheme.foreground
            ? { background: `${tenantTheme.background}cc` }
            : undefined}
        >
          <div
            className="rounded-2xl px-8 py-6 flex items-center gap-4 shadow-lg bg-card border border-border"
            style={isTenantRoute && tenantTheme.background && tenantTheme.foreground
              ? { background: tenantTheme.background, border: `1px solid ${tenantTheme.foreground}20`, color: tenantTheme.foreground }
              : undefined}
          >
            <Loader2 className="h-6 w-6 animate-spin text-primary" style={isTenantRoute && tenantTheme.primary ? { color: tenantTheme.primary } : undefined} />
            <p className="text-sm font-medium text-foreground" style={isTenantRoute && tenantTheme.foreground ? { color: tenantTheme.foreground } : undefined}>Procesando...</p>
          </div>
        </div>
      )}
    </LoadingContext.Provider>
  )
}
