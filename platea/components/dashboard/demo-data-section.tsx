"use client"

import { useCallback, useState } from "react"
import { AlertTriangle, Beer, CheckCircle2, History, Loader2, RotateCcw, ShoppingCart, Sparkles, Ticket } from "lucide-react"
import { formatMoney, formatDateTime } from "@/lib/format"

type ResultLine = {
  id: string
  tipo: "compra" | "consumible" | "reembolso" | "reconciliacion"
  resumen: string
  detalle: Record<string, unknown>
  timestamp: string
}

const GENERADORES = [
  {
    tipo: "compra" as const,
    endpoint: "/api/dashboard/demo-data/compra",
    titulo: "Compra de entrada",
    descripcion:
      "Genera un comprador fake, una checkout_session 'confirmada' (payment_id DEMO-*) y emite 1-3 entradas válidas con QR único. Decrementa stock real de una categoría con stock.",
    icon: Ticket,
    color: "text-cyan-600",
    bg: "bg-cyan-500/10",
    border: "border-cyan-500/30",
  },
  {
    tipo: "consumible" as const,
    endpoint: "/api/dashboard/demo-data/consumible",
    titulo: "Venta de consumibles",
    descripcion:
      "Toma una barra activa al azar, elige 1-3 consumibles con stock y crea una venta 'pendiente'. Decrementa stock_actual con lock atómico.",
    icon: Beer,
    color: "text-amber-600",
    bg: "bg-amber-500/10",
    border: "border-amber-500/30",
  },
  {
    tipo: "reembolso" as const,
    endpoint: "/api/dashboard/demo-data/reembolso",
    titulo: "Caso de reembolso",
    descripcion:
      "Necesita una compra demo previa. Crea un refund_manual_case en estado 'requested' con la última compra demo. NO ejecuta el refund (no toca Mercado Pago real).",
    icon: RotateCcw,
    color: "text-rose-600",
    bg: "bg-rose-500/10",
    border: "border-rose-500/30",
  },
  {
    tipo: "reconciliacion" as const,
    endpoint: "/api/dashboard/demo-data/reconciliacion",
    titulo: "Caso de reconciliación",
    descripcion:
      "Simula 'MP aprobó pero no se emitieron entradas': checkout_session con expires_at en el pasado + payment_id fake + reconciliation_note='approved_after_expiry'. Aparece en /dashboard/reconciliacion.",
    icon: AlertTriangle,
    color: "text-violet-600",
    bg: "bg-violet-500/10",
    border: "border-violet-500/30",
  },
]

export default function DemoDataSection({ empresaNombre }: { empresaNombre: string }) {
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [history, setHistory] = useState<ResultLine[]>([])
  const [err, setErr] = useState<string | null>(null)

  const generar = useCallback(async (gen: typeof GENERADORES[number]) => {
    setBusy((p) => ({ ...p, [gen.tipo]: true }))
    setErr(null)
    try {
      const res = await fetch(gen.endpoint, { method: "POST" })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error ?? `HTTP ${res.status}`)
      }
      const json = (await res.json()) as { data: Record<string, unknown> }
      const resumen = buildResumen(gen.tipo, json.data)
      setHistory((prev) => [
        {
          id: `${gen.tipo}-${Date.now()}`,
          tipo: gen.tipo,
          resumen,
          detalle: json.data,
          timestamp: formatDateTime(new Date().toISOString()),
        },
        ...prev,
      ].slice(0, 20))
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error generando caso")
    } finally {
      setBusy((p) => {
        const next = { ...p }
        delete next[gen.tipo]
        return next
      })
    }
  }, [])

  return (
    <div className="space-y-6 p-4 md:p-6">
      <header className="space-y-1">
        <div className="inline-flex items-center gap-2 rounded-md bg-violet-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-violet-700">
          <Sparkles className="h-3 w-3" />
          Cuenta de prueba
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Generadores de datos demo</h1>
        <p className="text-sm text-muted-foreground">
          Botones para crear casos sintéticos en <strong>{empresaNombre}</strong>. Cada click genera 1 caso real (con su FK,
          stock, etc.) usando datos fake (nombres random, DNIs random, emails @demo.test). Útil para mostrar el sistema en
          vivo a un cliente sin tener data real cargada.
        </p>
      </header>

      <div className="rounded-xl border border-border/60 bg-muted/50 p-3 text-xs text-foreground/80">
        <strong>Importante:</strong> los datos generados son <em>reales</em> en la DB (consumen stock, aparecen en reportes,
        cuentan para auditoría). Solo están aislados porque la empresa está marcada <code className="font-mono">es_prueba=true</code>{" "}
        y los super-admin reports los excluyen. Los reembolsos y reconciliaciones <strong>NO tocan Mercado Pago real</strong>{" "}
        — payment_id siempre empieza con <code className="font-mono">DEMO-</code>.
      </div>

      {err && (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-400">
          {err}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {GENERADORES.map((gen) => {
          const Icon = gen.icon
          const isBusy = !!busy[gen.tipo]
          return (
            <div key={gen.tipo} className={`rounded-2xl border ${gen.border} bg-card p-5 space-y-3`}>
              <div className="flex items-start gap-3">
                <div className={`rounded-lg ${gen.bg} p-2`}>
                  <Icon className={`h-5 w-5 ${gen.color}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-foreground">{gen.titulo}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">{gen.descripcion}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void generar(gen)}
                disabled={isBusy}
                className={`inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-opacity ${gen.bg} ${gen.color} hover:opacity-80 disabled:opacity-50`}
              >
                {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
                {isBusy ? "Generando..." : `Generar ${gen.titulo.toLowerCase()}`}
              </button>
            </div>
          )
        })}
      </div>

      {/* Historial */}
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center gap-2 mb-3">
          <History className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-base font-semibold text-foreground">Historial de esta sesión</h2>
          {history.length > 0 && (
            <button
              type="button"
              onClick={() => setHistory([])}
              className="ml-auto text-xs text-muted-foreground hover:text-foreground"
            >
              Limpiar
            </button>
          )}
        </div>

        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavía no generaste nada en esta sesión.</p>
        ) : (
          <div className="space-y-2">
            {history.map((h) => (
              <div key={h.id} className="rounded-lg border border-border/60 bg-background p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                      <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{h.tipo}</span>
                      <span className="text-[10px] text-muted-foreground">{h.timestamp}</span>
                    </div>
                    <p className="mt-1 text-sm">{h.resumen}</p>
                  </div>
                </div>
                <details className="mt-2">
                  <summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground">Ver JSON</summary>
                  <pre className="mt-1 overflow-x-auto rounded bg-muted/40 p-2 text-[10px] leading-relaxed">
                    {JSON.stringify(h.detalle, null, 2)}
                  </pre>
                </details>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
        <ShoppingCart className="h-3 w-3" />
        Para ver los datos generados, navegá a <strong>/dashboard/ventas</strong> (compras), <strong>/dashboard/consumibles</strong>{" "}
        (ventas de barra), <strong>/dashboard/reembolsos</strong> (casos) o <strong>/dashboard/reconciliacion</strong> (sesiones
        en revisión).
      </p>
    </div>
  )
}

function buildResumen(tipo: ResultLine["tipo"], data: Record<string, unknown>): string {
  switch (tipo) {
    case "compra": {
      const d = data as { cantidad?: number; categoria?: { nombre?: string }; comprador?: { nombre?: string; apellido?: string }; total?: number }
      return `${d.cantidad ?? 1}× ${d.categoria?.nombre ?? "Entrada"} · ${d.comprador?.nombre ?? "?"} ${d.comprador?.apellido ?? ""} · ${formatMoney(d.total ?? 0)}`
    }
    case "consumible": {
      const d = data as { items?: Array<{ nombre: string; cantidad: number }>; barra?: { nombre?: string }; total?: number }
      const lista = (d.items ?? []).map((it) => `${it.cantidad}× ${it.nombre}`).join(", ")
      return `${lista} · ${d.barra?.nombre ?? "Barra"} · ${formatMoney(d.total ?? 0)}`
    }
    case "reembolso": {
      const d = data as { amount?: number; status?: string }
      return `Caso refund creado · ${formatMoney(d.amount ?? 0)} · estado: ${d.status ?? "requested"}`
    }
    case "reconciliacion": {
      const d = data as { reconciliation_note?: string; amount?: number; comprador_email?: string }
      return `${d.reconciliation_note ?? "needs_review"} · ${formatMoney(d.amount ?? 0)} · ${d.comprador_email ?? ""}`
    }
    default:
      return "Caso generado"
  }
}
