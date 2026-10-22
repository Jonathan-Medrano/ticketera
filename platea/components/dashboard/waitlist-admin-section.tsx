"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { ArrowLeft, Bell, BellRing, CheckCircle2, ChevronRight, Clock, Loader2, RefreshCw, Trash2, X, XCircle } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { formatDateTime } from "@/lib/format"

type Entry = {
  id: string
  evento_id: string
  categoria_id: string
  categoria_nombre: string
  comprador_id: string
  comprador_nombre: string
  comprador_apellido: string | null
  comprador_email: string | null
  cantidad_solicitada: number
  estado: "esperando" | "asignado" | "comprado" | "expirado" | "cancelado"
  asignado_at: string | null
  expires_at: string | null
  notificado_at: string | null
  created_at: string
}

type Stats = Record<string, number>

const ESTADO_LABEL: Record<Entry["estado"], string> = {
  esperando: "Esperando",
  asignado: "Asignado (tiene 15 min)",
  comprado: "Comprado",
  expirado: "Expirado",
  cancelado: "Cancelado",
}

const ESTADO_COLOR: Record<Entry["estado"], string> = {
  esperando: "bg-slate-500/15 text-slate-700",
  asignado: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  comprado: "bg-success/15 text-success",
  expirado: "bg-rose-500/15 text-rose-700 dark:text-rose-400",
  cancelado: "bg-slate-500/15 text-slate-500",
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const h = Math.floor(diff / 3_600_000)
  if (h < 24) return `hace ${h}h`
  return `hace ${Math.floor(h / 24)}d`
}

export default function WaitlistAdminSection({ eventoId, eventoNombre }: { eventoId: string; eventoNombre: string }) {
  const [entries, setEntries] = useState<Entry[]>([])
  const [stats, setStats] = useState<Stats>({})
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<"all" | Entry["estado"]>("esperando")
  const [confirmTarget, setConfirmTarget] = useState<Entry | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/dashboard/waitlist?evento_id=${eventoId}`, { cache: "no-store" })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as { data: { entries: Entry[]; stats: Stats } }
      setEntries(json.data.entries)
      setStats(json.data.stats)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error cargando")
    } finally {
      setLoading(false)
    }
  }, [eventoId])

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  const doCancel = useCallback(async (entry: Entry) => {
    try {
      const res = await fetch(`/api/dashboard/waitlist/${entry.id}`, { method: "DELETE" })
      if (!res.ok && res.status !== 204) throw new Error(`HTTP ${res.status}`)
      toast.success("Cancelado")
      setConfirmTarget(null)
      void fetchData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error cancelando")
      setConfirmTarget(null)
    }
  }, [fetchData])

  const filtered = entries.filter((e) => filter === "all" || e.estado === filter)

  return (
    <>
    <div className="space-y-6 p-4 md:p-6">
      <header className="space-y-1">
        <nav aria-label="Navegación" className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Link href="/dashboard/eventos" className="hover:text-foreground transition-colors">Eventos</Link>
          <ChevronRight className="h-3.5 w-3.5 opacity-50" />
          <Link href={`/dashboard/eventos/${eventoId}`} className="hover:text-foreground transition-colors truncate max-w-[180px]">{eventoNombre}</Link>
          <ChevronRight className="h-3.5 w-3.5 opacity-50" />
          <span className="text-foreground font-medium">Lista de espera</span>
        </nav>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Lista de espera</h1>
        <p className="text-sm text-muted-foreground">
          <strong>{eventoNombre}</strong> · personas anotadas en espera de cupo. Cuando se libera stock (refund, expiración de checkout
          o stock manual) el sistema asigna automáticamente al primero en estado <em>esperando</em>.
        </p>
      </header>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Total" value={stats.total ?? 0} icon={Bell} />
        <StatCard label="Esperando" value={stats.esperando ?? 0} icon={Clock} accent="info" />
        <StatCard label="Asignados ahora" value={stats.asignado ?? 0} icon={BellRing} accent="warn" />
        <StatCard label="Compraron" value={stats.comprado ?? 0} icon={CheckCircle2} accent="ok" />
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        {(["all", "esperando", "asignado", "comprado", "expirado", "cancelado"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`h-10 rounded-lg border px-3 text-xs ${
              filter === f ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-muted"
            }`}
          >
            {f === "all" ? "Todos" : ESTADO_LABEL[f]}
          </button>
        ))}
        <button
          type="button"
          onClick={() => void fetchData()}
          className="ml-auto inline-flex h-10 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-xs hover:bg-muted"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refrescar
        </button>
      </div>

      {/* Tabla */}
      {loading && entries.length === 0 ? (
        <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando…
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/60 px-4 py-10 text-center">
          <Bell className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">
            {entries.length === 0
              ? "Nadie se anotó en lista de espera todavía. Si una categoría se agota, los compradores van a ver el botón en la página del evento."
              : "Ningún entry coincide con el filtro."}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border/60">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border/60 bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2.5 font-medium">Comprador</th>
                <th className="px-3 py-2.5 font-medium">Categoría</th>
                <th className="px-3 py-2.5 font-medium text-right">Cant.</th>
                <th className="px-3 py-2.5 font-medium">Estado</th>
                <th className="px-3 py-2.5 font-medium">Anotado</th>
                <th className="px-3 py-2.5 font-medium" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={e.id} className="border-b border-border/40 last:border-b-0">
                  <td className="px-3 py-3">
                    <div className="font-medium">{e.comprador_nombre} {e.comprador_apellido}</div>
                    <div className="text-xs text-muted-foreground">{e.comprador_email}</div>
                  </td>
                  <td className="px-3 py-3 text-xs">{e.categoria_nombre}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{e.cantidad_solicitada}</td>
                  <td className="px-3 py-3">
                    <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${ESTADO_COLOR[e.estado]}`}>
                      {ESTADO_LABEL[e.estado]}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-xs text-muted-foreground" title={formatDateTime(e.created_at)}>{relTime(e.created_at)}</td>
                  <td className="px-3 py-3 text-right">
                    {(e.estado === "esperando" || e.estado === "asignado") && (
                      <button
                        type="button"
                        onClick={() => setConfirmTarget(e)}
                        className="relative rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-rose-500 after:absolute after:-inset-2.5 after:content-['']"
                        title="Cancelar"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>

    <Dialog open={!!confirmTarget} onOpenChange={(v) => { if (!v) setConfirmTarget(null) }}>
      <DialogContent className="bg-card sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>¿Cancelar inscripción?</DialogTitle>
          <DialogDescription>
            Se cancelará la inscripción al waitlist de{" "}
            <span className="font-semibold text-foreground">
              {confirmTarget?.comprador_nombre} {confirmTarget?.comprador_apellido}
            </span>
            . Esta acción no se puede deshacer.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setConfirmTarget(null)}>
            Volver
          </Button>
          <Button
            variant="destructive"
            onClick={() => { if (confirmTarget) void doCancel(confirmTarget) }}
          >
            Cancelar inscripción
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  )
}

function StatCard({ label, value, icon: Icon, accent }: { label: string; value: number; icon: typeof Bell; accent?: "info" | "ok" | "warn" }) {
  const accentClass: Record<NonNullable<typeof accent>, string> = {
    info: "border-cyan-500/30 bg-cyan-500/5",
    ok: "border-success/30 bg-success/5",
    warn: "border-amber-500/30 bg-amber-500/5",
  }
  return (
    <div className={`rounded-xl border p-3 ${accent ? accentClass[accent] : "border-border/60"}`}>
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-0.5 text-xl font-bold tabular-nums">{value}</div>
    </div>
  )
}

void XCircle
