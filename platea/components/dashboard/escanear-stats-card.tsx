"use client"

import { useCallback, useEffect, useState } from "react"
import { Activity, AlertCircle, CheckCircle2, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatInt } from "@/lib/format"

type StatsData = {
  evento: { id: string; nombre: string }
  total: number
  validas: number
  usadas: number
  canceladas: number
  pendientes: number
  porcentaje_check_in: number
  usadas_ultima_hora: number
  usadas_ultimos_5_min: number
  ultima_usada_at: string | null
  server_time: string
}

const POLL_INTERVAL_MS = 10000 // 10 segundos

export default function EscanearStatsCard({ eventoId }: { eventoId: string | null }) {
  const [stats, setStats] = useState<StatsData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)

  const fetchStats = useCallback(async () => {
    if (!eventoId) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/escanear/stats?evento_id=${encodeURIComponent(eventoId)}`)
      const data = (await res.json()) as { data?: StatsData; error?: string }
      if (!res.ok || !data.data) {
        setError(data.error ?? "No se pudieron cargar stats")
        return
      }
      setStats(data.data)
      setLastUpdate(new Date())
    } catch {
      setError("Error de red")
    } finally {
      setLoading(false)
    }
  }, [eventoId])

  // Fetch inicial + polling
  useEffect(() => {
    if (!eventoId) {
      setStats(null)
      return
    }
    void fetchStats()
    const id = setInterval(() => {
      void fetchStats()
    }, POLL_INTERVAL_MS)
    return () => clearInterval(id)
  }, [eventoId, fetchStats])

  if (!eventoId) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card/50 px-4 py-6 text-center text-xs text-muted-foreground">
        Elegí un evento para ver stats en vivo
      </div>
    )
  }

  if (error && !stats) {
    return (
      <div className="rounded-2xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-xs text-red-700 dark:text-red-400">
        <AlertCircle className="inline h-3.5 w-3.5 mr-1" />
        {error}
      </div>
    )
  }

  if (!stats) {
    return (
      <div className="rounded-2xl border border-border bg-card px-4 py-6 text-center text-xs text-muted-foreground">
        <Loader2 className="inline h-4 w-4 animate-spin mr-2" />
        Cargando stats...
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Activity className={cn("h-4 w-4 text-success", loading && "animate-pulse")} />
          <p className="text-sm font-semibold text-foreground">Check-in en vivo</p>
        </div>
        <div className="text-[10px] text-muted-foreground">
          {lastUpdate
            ? `Act. ${lastUpdate.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "America/Argentina/Buenos_Aires" })}`
            : "—"}
        </div>
      </div>

      {/* Progress bar de check-in */}
      <div className="mb-3">
        <div className="flex items-end justify-between mb-1">
          <div>
            <p className="text-2xl font-bold text-foreground tabular-nums">
              {formatInt(stats.usadas)}
              <span className="text-base font-normal text-muted-foreground"> / {formatInt(stats.total - stats.canceladas)}</span>
            </p>
            <p className="text-xs text-muted-foreground">entradas escaneadas</p>
          </div>
          <div className="text-right">
            <p className={cn(
              "text-2xl font-bold tabular-nums",
              stats.porcentaje_check_in >= 75 ? "text-success" : "text-foreground",
            )}>
              {stats.porcentaje_check_in}%
            </p>
            <p className="text-[10px] text-muted-foreground">completado</p>
          </div>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-gradient-to-r from-success to-sky-500 transition-all duration-500"
            style={{ width: `${stats.porcentaje_check_in}%` }}
          />
        </div>
      </div>

      {/* Stats secundarias */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="rounded-lg bg-muted/40 px-2 py-1.5 text-center">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Pendientes</p>
          <p className="text-sm font-bold text-[color:var(--marketing-accent)] tabular-nums">{stats.pendientes}</p>
        </div>
        <div className="rounded-lg bg-muted/40 px-2 py-1.5 text-center">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Última hora</p>
          <p className="text-sm font-bold text-success tabular-nums">+{stats.usadas_ultima_hora}</p>
        </div>
        <div className="rounded-lg bg-muted/40 px-2 py-1.5 text-center">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Últimos 5&apos;</p>
          <p className="text-sm font-bold text-success tabular-nums">+{stats.usadas_ultimos_5_min}</p>
        </div>
      </div>

      {stats.canceladas > 0 ? (
        <p className="text-[10px] text-muted-foreground border-t border-border pt-2">
          <AlertCircle className="inline h-3 w-3 mr-1" />
          {stats.canceladas} canceladas excluidas del total
        </p>
      ) : null}

      {stats.porcentaje_check_in === 100 ? (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-success font-medium">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Aforo completo — todas escaneadas
        </div>
      ) : null}
    </div>
  )
}
