"use client"

import { useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Clock,
  ExternalLink,
  ListFilter,
  Loader2,
  Search,
  Send,
  Wallet,
} from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useDashboardDebouncedSearch } from "@/lib/use-dashboard-debounced-search"
import { writeDashboardSearchParam } from "@/lib/dashboard-grid-search"
import { formatMoney, formatDateTime } from "@/lib/format"

export type ReconciliacionCaso = {
  id: string
  created_at: string
  expires_at: string | null
  amount_total: number | string | null
  payment_id: string | null
  payment_status: string | null
  reconciliation_status: string | null
  reconciliation_note: string | null
  refund_status: string | null
  refund_provider_id: string | null
  refund_amount: number | string | null
  refund_initiated_at: string | null
  refund_completed_at: string | null
  refund_initiated_by: string | null
  refund_error: string | null
  refund_reason: string | null
  delivery_status: string | null
  delivery_retry_count: number | null
  delivery_last_error: string | null
  delivery_next_attempt_at: string | null
  delivery_completed_at: string | null
  session_estado: string
  evento_id: string | null
  evento_nombre: string | null
  comprador_id: string | null
  comprador_nombre: string | null
  comprador_email: string | null
  comprador_dni: string | null
}

export type ReconciliacionData = {
  casos: ReconciliacionCaso[]
  eventos: Array<{ id: string; nombre: string }>
  totalPendientes: number
  montoPendiente: number
}

type Pagination = {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

interface Props {
  data: ReconciliacionData
  pagination: Pagination
  puedeGestionarReembolsos: boolean
}

const ESTADO_OPTIONS = [
  { value: "pendiente", label: "Pendientes" },
  { value: "emitido", label: "Emitidos manualmente" },
  { value: "notificacion_fallida", label: "Notificación fallida" },
  { value: "reembolsado", label: "Reembolsados" },
  { value: "todos", label: "Todos" },
] as const

function deriveMotivo(c: ReconciliacionCaso): { label: string; tone: "critical" | "warning" | "ok" } {
  if (c.reconciliation_note === "emitted_manually") {
    return { label: "Emitida manualmente", tone: "ok" }
  }
  if (c.reconciliation_note === "approved_after_expiry") {
    return { label: "Pago aprobado fuera de plazo", tone: "critical" }
  }
  if (c.payment_id && c.session_estado !== "confirmada" && c.session_estado !== "cancelada") {
    return { label: "Sesión sin confirmar", tone: "warning" }
  }
  return { label: c.reconciliation_note ?? "Desconocido", tone: "warning" }
}

function renderRefundBadge(c: ReconciliacionCaso) {
  if (c.refund_status === "completed") {
    return (
      <Badge variant="outline" className="border-success/40 bg-success/10 text-success">
        <CheckCircle2 className="mr-1 h-3 w-3" /> Reembolsado
      </Badge>
    )
  }
  if (c.refund_status === "pending") {
    return (
      <Badge variant="outline" className="border-[color:var(--marketing-accent)]/40 bg-[color:var(--marketing-accent)]/10 text-[color:var(--marketing-accent)]">
        <Clock className="mr-1 h-3 w-3" /> Procesando
      </Badge>
    )
  }
  if (c.refund_status === "failed") {
    return (
      <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400" title={c.refund_error ?? ""}>
        <AlertTriangle className="mr-1 h-3 w-3" /> Reembolso falló
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400">
      Pendiente
    </Badge>
  )
}

type Severity = "critico" | "atencion" | "resuelto"

const SEVERITY_META: Record<
  Severity,
  { label: string; rail: string; chip: string; icon: typeof AlertTriangle; iconWrap: string }
> = {
  critico: {
    label: "Crítico",
    rail: "bg-red-500",
    chip: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400",
    icon: AlertTriangle,
    iconWrap: "bg-red-100/80 dark:bg-red-900/30 text-red-700 dark:text-red-400",
  },
  atencion: {
    label: "Requiere atención",
    rail: "bg-amber-500",
    chip: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
    icon: Clock,
    iconWrap: "bg-amber-100/80 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400",
  },
  resuelto: {
    label: "Resuelto",
    rail: "bg-success",
    chip: "border-success/40 bg-success/10 text-success",
    icon: CheckCircle2,
    iconWrap: "bg-success/15 text-success",
  },
}

const SEVERITY_ORDER: Severity[] = ["critico", "atencion", "resuelto"]

function deriveSeverity(c: ReconciliacionCaso): Severity {
  if (c.refund_status === "completed") return "resuelto"
  if (c.reconciliation_note === "approved_after_expiry") return "critico"
  if (c.refund_status === "failed") return "critico"
  if (c.delivery_status === "abandoned") return "critico"
  if (c.reconciliation_note === "emitted_manually" && c.session_estado === "confirmada") return "resuelto"
  if (c.payment_id && c.session_estado !== "confirmada" && c.session_estado !== "cancelada") return "atencion"
  return "atencion"
}

const SORT_OPTIONS = [
  { value: "created_at:desc", label: "Más recientes" },
  { value: "created_at:asc", label: "Más antiguos" },
  { value: "comprador_nombre:asc", label: "Comprador (A–Z)" },
  { value: "comprador_nombre:desc", label: "Comprador (Z–A)" },
] as const

function KpiCard({
  label,
  value,
  sub,
  icon: Icon,
  tone,
  surface,
  mono = false,
}: {
  label: string
  value: string
  sub?: string
  icon: typeof AlertTriangle
  tone: string
  surface: string
  mono?: boolean
}) {
  return (
    <article className="rounded-card border border-border bg-card p-4 shadow-sm md:p-5">
      <div className={`flex h-10 w-10 items-center justify-center rounded-2xl ${surface}`}>
        <Icon className={`h-4 w-4 ${tone}`} />
      </div>
      <p className="mt-4 text-xs font-medium text-muted-foreground">{label}</p>
      <p
        className={`mt-2 text-xl font-bold tracking-[-0.04em] text-foreground tabular-nums md:text-2xl lg:text-[1.9rem] ${
          mono ? "font-mono" : ""
        }`}
      >
        {value}
      </p>
      {sub ? <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{sub}</p> : null}
    </article>
  )
}

export default function ReconciliacionContent({ data, pagination, puedeGestionarReembolsos }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const estado = searchParams.get("estado") ?? "pendiente"
  const eventoId = searchParams.get("evento_id") ?? "todos"
  const desde = searchParams.get("desde") ?? ""
  const hasta = searchParams.get("hasta") ?? ""
  const busqueda = searchParams.get("busqueda") ?? ""
  const sortBy = searchParams.get("sortBy") ?? "created_at"
  const sortDir = (searchParams.get("sortDir") ?? "desc") as "asc" | "desc"
  const pageSize = Number(searchParams.get("pageSize") ?? "25")

  // Modal refund state
  const [refundTarget, setRefundTarget] = useState<ReconciliacionCaso | null>(null)
  const [refundAmountInput, setRefundAmountInput] = useState("")
  const [refundReason, setRefundReason] = useState("")
  const [refundSubmitting, setRefundSubmitting] = useState(false)

  // Modal emit state
  const [emitTarget, setEmitTarget] = useState<ReconciliacionCaso | null>(null)
  const [emitReason, setEmitReason] = useState("")
  const [emitForceWithoutStock, setEmitForceWithoutStock] = useState(false)
  const [emitSubmitting, setEmitSubmitting] = useState(false)
  const [emitError, setEmitError] = useState<string | null>(null)

  // Resend state (confirm dialog + loading)
  const [resendConfirmTarget, setResendConfirmTarget] = useState<ReconciliacionCaso | null>(null)
  const [resendingId, setResendingId] = useState<string | null>(null)

  // Card expandible: qué caso está abierto mostrando el detalle completo
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Draft states para filtros (aplican al hacer click en "Buscar")
  const [estadoDraft, setEstadoDraft] = useState(estado)
  const [eventoIdDraft, setEventoIdDraft] = useState(eventoId)
  const [desdeDraft, setDesdeDraft] = useState(desde)
  const [hastaDraft, setHastaDraft] = useState(hasta)

  async function confirmResend() {
    if (!resendConfirmTarget || resendingId) return
    const caso = resendConfirmTarget
    setResendConfirmTarget(null)
    setResendingId(caso.id)
    try {
      const res = await fetch(`/api/reconciliacion/${caso.id}/reenviar-notificacion`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })
      const data = (await res.json()) as {
        data?: {
          preference: "email" | "whatsapp" | "both"
          attempts: Array<{ channel: string; status: string; errorMessage?: string | null }>
          entradasNotificadas: number
        }
        error?: string
      }

      if (!res.ok) {
        toast.error(data.error ?? "No se pudo reenviar la notificación")
        return
      }

      const okAttempts = data.data?.attempts.filter((a) => a.status === "ok") ?? []
      const failAttempts = data.data?.attempts.filter((a) => a.status !== "ok") ?? []

      if (okAttempts.length > 0) {
        const channels = okAttempts.map((a) => a.channel).join(" + ")
        toast.success(`Notificación enviada vía ${channels} (${data.data?.entradasNotificadas} entradas)`)
      }
      if (failAttempts.length > 0) {
        const firstFail = failAttempts[0]
        toast.warning(
          `Algunos canales fallaron: ${firstFail.channel}${firstFail.errorMessage ? ` — ${firstFail.errorMessage}` : ""}`,
        )
      }
      router.refresh()
    } catch {
      toast.error("Error de red — no se pudo contactar al backend")
    } finally {
      setResendingId(null)
    }
  }

  function openRefund(caso: ReconciliacionCaso) {
    setRefundTarget(caso)
    setRefundAmountInput("")
    setRefundReason("")
  }

  function closeRefund() {
    if (refundSubmitting) return
    setRefundTarget(null)
    setRefundAmountInput("")
    setRefundReason("")
  }

  function openEmit(caso: ReconciliacionCaso) {
    setEmitTarget(caso)
    setEmitReason("")
    setEmitForceWithoutStock(false)
    setEmitError(null)
  }

  function closeEmit() {
    if (emitSubmitting) return
    setEmitTarget(null)
    setEmitReason("")
    setEmitForceWithoutStock(false)
    setEmitError(null)
  }

  async function submitEmit() {
    if (!emitTarget || emitSubmitting) return
    if (!emitReason.trim() || emitReason.trim().length < 5) {
      toast.error("Escribí un motivo (mínimo 5 caracteres)")
      return
    }

    setEmitSubmitting(true)
    setEmitError(null)
    try {
      const res = await fetch(`/api/reconciliacion/${emitTarget.id}/emitir-manual`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason: emitReason.trim(),
          forceWithoutStock: emitForceWithoutStock,
        }),
      })
      const data = (await res.json()) as {
        data?: { entradasEmitidas: number; forceWithoutStock: boolean }
        error?: string
        code?: string
        disponible?: number
        necesario?: number
      }

      if (!res.ok) {
        if (data.code === "insufficient_stock") {
          setEmitError(
            `Stock insuficiente (disponible ${data.disponible}, necesario ${data.necesario}). Activá "Forzar sin stock" si querés sobrevender conscientemente.`,
          )
        } else {
          setEmitError(data.error ?? "No se pudo emitir la entrada")
        }
        return
      }

      const cantidad = data.data?.entradasEmitidas ?? 0
      toast.success(
        `${cantidad} entrada${cantidad !== 1 ? "s" : ""} emitida${cantidad !== 1 ? "s" : ""} ${
          data.data?.forceWithoutStock ? "(sin descontar stock)" : ""
        }`,
      )
      setEmitTarget(null)
      setEmitReason("")
      setEmitForceWithoutStock(false)
      router.refresh()
    } catch {
      setEmitError("Error de red — no se pudo contactar al backend")
    } finally {
      setEmitSubmitting(false)
    }
  }

  async function submitRefund() {
    if (!refundTarget || refundSubmitting) return

    const expected = Number(refundTarget.amount_total)
    const typed = Number(refundAmountInput.replace(",", "."))

    if (!Number.isFinite(typed) || Math.abs(typed - expected) > 0.01) {
      toast.error(`El monto tipeado no coincide con ${formatMoney(expected)}`)
      return
    }

    if (!refundReason.trim() || refundReason.trim().length < 5) {
      toast.error("Escribí un motivo (mínimo 5 caracteres) — queda en audit log")
      return
    }

    setRefundSubmitting(true)
    try {
      const res = await fetch(`/api/reconciliacion/${refundTarget.id}/reembolsar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: expected, reason: refundReason.trim() }),
      })
      const data = (await res.json()) as { data?: { refundProviderId?: string | null }; error?: string }

      if (!res.ok) {
        toast.error(data.error ?? "No se pudo ejecutar el reembolso")
        return
      }

      toast.success(
        data.data?.refundProviderId
          ? `Reembolso completado · Ref MP ${data.data.refundProviderId}`
          : "Reembolso completado",
      )
      setRefundTarget(null)
      setRefundAmountInput("")
      setRefundReason("")
      router.refresh()
    } catch {
      toast.error("Error de red — no se pudo contactar al backend")
    } finally {
      setRefundSubmitting(false)
    }
  }

  const { value: busquedaInput, setValue: setBusquedaInput } = useDashboardDebouncedSearch({
    urlValue: busqueda,
    emit: (next) => updateQuery({ busqueda: next, page: 1 }),
  })

  const rangeStart = pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.pageSize + 1
  const rangeEnd = Math.min(pagination.total, pagination.page * pagination.pageSize)

  function updateQuery(next: {
    page?: number
    pageSize?: number
    estado?: string
    evento_id?: string
    desde?: string
    hasta?: string
    busqueda?: string
    sortBy?: string
    sortDir?: string
  }) {
    const params = new URLSearchParams(searchParams.toString())

    if (next.page !== undefined) params.set("page", String(next.page))
    if (next.pageSize !== undefined) {
      if (next.pageSize !== 25) params.set("pageSize", String(next.pageSize))
      else params.delete("pageSize")
    }
    if (next.estado !== undefined) {
      if (next.estado && next.estado !== "pendiente") params.set("estado", next.estado)
      else params.delete("estado")
    }
    if (next.evento_id !== undefined) {
      if (next.evento_id && next.evento_id !== "todos") params.set("evento_id", next.evento_id)
      else params.delete("evento_id")
    }
    if (next.desde !== undefined) {
      if (next.desde) params.set("desde", next.desde)
      else params.delete("desde")
    }
    if (next.hasta !== undefined) {
      if (next.hasta) params.set("hasta", next.hasta)
      else params.delete("hasta")
    }
    if (next.busqueda !== undefined) {
      writeDashboardSearchParam(params, "busqueda", next.busqueda)
    }
    if (next.sortBy !== undefined) {
      if (next.sortBy && next.sortBy !== "created_at") params.set("sortBy", next.sortBy)
      else params.delete("sortBy")
    }
    if (next.sortDir !== undefined) {
      if (next.sortDir && next.sortDir !== "desc") params.set("sortDir", next.sortDir)
      else params.delete("sortDir")
    }

    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname)
  }

  function applyFilters() {
    updateQuery({
      estado: estadoDraft,
      evento_id: eventoIdDraft,
      desde: desdeDraft,
      hasta: hastaDraft,
      page: 1,
    })
  }

  // KPIs honestos: pendientes, dinero en riesgo y resultados son GLOBALES (vienen del backend);
  // críticos y notificaciones caídas son de la PÁGINA visible (lo dejamos claro en el sub).
  const criticosPagina = data.casos.filter((c) => deriveSeverity(c) === "critico").length
  const notifCaidasPagina = data.casos.filter((c) => c.delivery_status === "abandoned").length

  // Agrupar los casos de la página por severidad, preservando el orden del backend dentro de cada grupo.
  const grupos = SEVERITY_ORDER.map((sev) => ({
    sev,
    casos: data.casos.filter((c) => deriveSeverity(c) === sev),
  })).filter((g) => g.casos.length > 0)

  const sortValue = `${sortBy}:${sortDir}`

  function renderCaseActions(c: ReconciliacionCaso) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {c.payment_id ? (
          <a
            href={`https://www.mercadopago.com.ar/activities/detail/${c.payment_id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="Ver en Mercado Pago"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Mercado Pago
          </a>
        ) : null}
        {puedeGestionarReembolsos && c.refund_status !== "completed" && c.session_estado !== "confirmada" ? (
          <Button variant="default" size="sm" className="h-8 gap-1.5 px-2.5 text-xs" onClick={() => openEmit(c)}>
            <CheckCircle2 className="h-3.5 w-3.5" /> Emitir entrada
          </Button>
        ) : null}
        {puedeGestionarReembolsos && c.refund_status !== "completed" && c.payment_id && c.session_estado !== "confirmada" ? (
          <Button variant="outline" size="sm" className="h-8 gap-1.5 px-2.5 text-xs" onClick={() => openRefund(c)}>
            <Wallet className="h-3.5 w-3.5" /> Reembolsar
          </Button>
        ) : null}
        {puedeGestionarReembolsos && c.session_estado === "confirmada" ? (
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 px-2.5 text-xs"
            onClick={() => setResendConfirmTarget(c)}
            disabled={resendingId === c.id}
          >
            {resendingId === c.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            Reenviar
          </Button>
        ) : null}
      </div>
    )
  }

  function renderDeliveryLine(c: ReconciliacionCaso) {
    if (c.delivery_status === "abandoned") {
      return (
        <span className="font-semibold text-red-700 dark:text-red-400" title={c.delivery_last_error ?? ""}>
          Notificación abandonada · {c.delivery_retry_count ?? 0} intentos
        </span>
      )
    }
    if (c.delivery_status === "pending" && (c.delivery_retry_count ?? 0) > 0) {
      return (
        <span className="text-amber-700 dark:text-amber-400">Reintento {c.delivery_retry_count}/6 pendiente</span>
      )
    }
    if (c.delivery_status === "sent") {
      return <span className="text-success">Notificada correctamente</span>
    }
    return <span className="text-muted-foreground">Sin envíos registrados</span>
  }

  return (
    <div className="space-y-5 md:space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-[-0.02em] text-foreground">Reconciliación de pagos</h1>
          <p className="text-muted-foreground text-sm mt-1 max-w-2xl text-pretty">
            Compras donde Mercado Pago cobró pero la entrada no se emitió, o donde la notificación al comprador falló.
            Casos detectados automáticamente por el sistema. Resolvelos desde acá: emitir entrada manualmente,
            reembolsar el pago vía MP o reenviar la notificación.
          </p>
        </div>
      </div>

      {/* Strip de KPIs — pendientes y resultados son globales; dinero y notif. son de la página visible */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:gap-4">
        <KpiCard
          label="Pendientes de resolver"
          value={String(data.totalPendientes)}
          sub={data.totalPendientes > 0 ? "En toda la empresa, sin acción tomada" : "Todo emitido correctamente"}
          icon={data.totalPendientes > 0 ? AlertTriangle : CheckCircle2}
          tone={
            data.totalPendientes > 0
              ? "text-red-700 dark:text-red-400"
              : "text-success"
          }
          surface={
            data.totalPendientes > 0
              ? "bg-red-100/80"
              : "bg-success/15"
          }
        />
        <KpiCard
          label="Dinero en riesgo"
          value={formatMoney(data.montoPendiente)}
          sub="Total pendiente en toda la empresa"
          icon={Wallet}
          tone="text-amber-700 dark:text-amber-400"
          surface="bg-amber-100/80"
          mono
        />
        <KpiCard
          label="Notificaciones caídas"
          value={String(notifCaidasPagina)}
          sub="Compradores sin su entrada, en esta página"
          icon={Bell}
          tone="text-[color:var(--marketing-accent)]"
          surface="bg-sky-100/80"
        />
        <KpiCard
          label="Resultados del filtro"
          value={String(pagination.total)}
          sub={`${criticosPagina} crítico${criticosPagina !== 1 ? "s" : ""} en esta página`}
          icon={ListFilter}
          tone="text-foreground"
          surface="bg-muted"
        />
      </section>

      {data.totalPendientes === 0 && estado === "pendiente" ? (
        <section className="rounded-panel border border-success/30 bg-success/10 p-6 text-center text-sm text-success">
          <CheckCircle2 className="inline h-4 w-4 mr-2" />
          Sin casos pendientes de reconciliación. Todo emitido correctamente.
        </section>
      ) : null}

      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-foreground">Filtros</h2>
            <p className="text-sm text-muted-foreground">Refiná qué casos querés ver.</p>
          </div>
          <Button type="button" onClick={applyFilters} className="w-full sm:w-auto">Buscar</Button>
        </div>

        <div className="grid gap-4 xl:grid-cols-4 xl:items-end">
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-muted-foreground">Estado</label>
            <Select value={estadoDraft} onValueChange={setEstadoDraft}>
              <SelectTrigger className="h-10 bg-background w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ESTADO_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-muted-foreground">Evento</label>
            <Select value={eventoIdDraft} onValueChange={setEventoIdDraft}>
              <SelectTrigger className="h-10 bg-background w-full">
                <SelectValue placeholder="Todos los eventos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos los eventos</SelectItem>
                {data.eventos.map((ev) => (
                  <SelectItem key={ev.id} value={ev.id}>{ev.nombre}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end xl:col-span-2">
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-muted-foreground">Desde</label>
              <Input type="date" className="h-10 bg-background w-full" value={desdeDraft} max={hastaDraft || undefined} onChange={(e) => setDesdeDraft(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-muted-foreground">Hasta</label>
              <Input type="date" className="h-10 bg-background w-full" value={hastaDraft} min={desdeDraft || undefined} onChange={(e) => setHastaDraft(e.target.value)} />
            </div>
          </div>
        </div>
      </section>

      <Dialog open={resendConfirmTarget !== null} onOpenChange={(open) => { if (!open) setResendConfirmTarget(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="h-5 w-5 text-primary" />
              Reenviar notificación
            </DialogTitle>
            <DialogDescription>
              Se enviará de nuevo el email o WhatsApp con los QR de las entradas a{" "}
              <span className="font-medium text-foreground">{resendConfirmTarget?.comprador_nombre ?? "el comprador"}</span>.
            </DialogDescription>
          </DialogHeader>
          {resendConfirmTarget ? (
            <div className="rounded-panel border border-border bg-muted/30 px-4 py-3 space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Comprador</span>
                <span className="font-medium text-foreground">{resendConfirmTarget.comprador_nombre ?? "—"}</span>
              </div>
              {resendConfirmTarget.comprador_email ? (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Email</span>
                  <span className="font-medium text-foreground">{resendConfirmTarget.comprador_email}</span>
                </div>
              ) : null}
              {resendConfirmTarget.evento_nombre ? (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Evento</span>
                  <span className="font-medium text-foreground text-right">{resendConfirmTarget.evento_nombre}</span>
                </div>
              ) : null}
            </div>
          ) : null}
          <DialogFooter className="sm:justify-between">
            <Button type="button" variant="outline" onClick={() => setResendConfirmTarget(null)}>
              Cancelar
            </Button>
            <Button type="button" className="gap-2" onClick={() => void confirmResend()}>
              <Send className="h-4 w-4" /> Reenviar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={refundTarget !== null} onOpenChange={(open) => { if (!open) closeRefund() }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-700 dark:text-red-400" />
              Reembolsar pago
            </DialogTitle>
            <DialogDescription>
              Vas a devolverle al comprador todo el monto vía Mercado Pago. Esta acción NO se puede deshacer.
            </DialogDescription>
          </DialogHeader>
          {refundTarget ? (
            <div className="space-y-4">
              <div className="rounded-panel border border-border bg-muted/30 px-4 py-3 space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Comprador</span>
                  <span className="font-medium text-foreground">{refundTarget.comprador_nombre ?? "—"}</span>
                </div>
                {refundTarget.comprador_email ? (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Email</span>
                    <span className="font-medium text-foreground">{refundTarget.comprador_email}</span>
                  </div>
                ) : null}
                {refundTarget.evento_nombre ? (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Evento</span>
                    <span className="font-medium text-foreground text-right">{refundTarget.evento_nombre}</span>
                  </div>
                ) : null}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Monto cobrado</span>
                  <span className="font-mono font-bold text-foreground">{formatMoney(refundTarget.amount_total)}</span>
                </div>
                {refundTarget.payment_id ? (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">MP payment_id</span>
                    <span className="font-mono text-foreground">{refundTarget.payment_id}</span>
                  </div>
                ) : null}
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">
                  Confirmá tipeando el monto exacto:
                </Label>
                <Input
                  type="text"
                  inputMode="decimal"
                  className="h-11 bg-background font-mono"
                  placeholder={Number(refundTarget.amount_total).toFixed(2)}
                  value={refundAmountInput}
                  onChange={(e) => setRefundAmountInput(e.target.value)}
                  disabled={refundSubmitting}
                  autoFocus
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">
                  Motivo (queda en audit log, mínimo 5 caracteres):
                </Label>
                <Input
                  type="text"
                  className="h-11 bg-background"
                  placeholder="Ej: pago aprobado fuera de plazo, sin entrada emitida"
                  value={refundReason}
                  onChange={(e) => setRefundReason(e.target.value)}
                  disabled={refundSubmitting}
                />
              </div>

              {refundTarget.refund_status === "failed" && refundTarget.refund_error ? (
                <div className="rounded-panel border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                  <span className="font-semibold">Intento previo falló:</span> {refundTarget.refund_error}
                </div>
              ) : null}
            </div>
          ) : null}
          <DialogFooter className="sm:justify-between">
            <Button type="button" variant="outline" onClick={closeRefund} disabled={refundSubmitting}>
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void submitRefund()}
              disabled={refundSubmitting || !refundAmountInput || !refundReason}
              className="gap-2"
            >
              {refundSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {refundSubmitting
                ? "Procesando..."
                : `Reembolsar ${refundTarget ? formatMoney(refundTarget.amount_total) : ""}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={emitTarget !== null} onOpenChange={(open) => { if (!open) closeEmit() }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-success" />
              Emitir entrada manualmente
            </DialogTitle>
            <DialogDescription>
              Vas a generar las entradas que originalmente no se emitieron. Por default se intenta descontar el stock.
            </DialogDescription>
          </DialogHeader>
          {emitTarget ? (
            <div className="space-y-4">
              <div className="rounded-panel border border-border bg-muted/30 px-4 py-3 space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Comprador</span>
                  <span className="font-medium text-foreground">{emitTarget.comprador_nombre ?? "—"}</span>
                </div>
                {emitTarget.comprador_email ? (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Email</span>
                    <span className="font-medium text-foreground">{emitTarget.comprador_email}</span>
                  </div>
                ) : null}
                {emitTarget.evento_nombre ? (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Evento</span>
                    <span className="font-medium text-foreground text-right">{emitTarget.evento_nombre}</span>
                  </div>
                ) : null}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Monto pagado</span>
                  <span className="font-mono font-bold text-foreground">{formatMoney(emitTarget.amount_total)}</span>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">
                  Motivo (queda en audit log, mínimo 5 caracteres):
                </Label>
                <Input
                  type="text"
                  className="h-11 bg-background"
                  placeholder="Ej: pago aprobado fuera de plazo, emisión manual aprobada"
                  value={emitReason}
                  onChange={(e) => setEmitReason(e.target.value)}
                  disabled={emitSubmitting}
                  autoFocus
                />
              </div>

              <label className="flex items-start gap-3 rounded-panel border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 rounded border-border"
                  checked={emitForceWithoutStock}
                  onChange={(e) => setEmitForceWithoutStock(e.target.checked)}
                  disabled={emitSubmitting}
                />
                <div className="text-sm">
                  <p className="font-medium text-amber-900 dark:text-amber-300">Forzar sin stock</p>
                  <p className="mt-0.5 text-xs text-amber-800/80 dark:text-amber-400/80">
                    Emite la entrada incluso si la categoría está agotada. La categoría queda en stock negativo —
                    sobreventa consciente. Usá solo para eventos de pie / sin asiento numerado.
                  </p>
                </div>
              </label>

              {emitError ? (
                <div className="rounded-panel border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-800 dark:text-red-300">
                  {emitError}
                </div>
              ) : null}
            </div>
          ) : null}
          <DialogFooter className="sm:justify-between">
            <Button type="button" variant="outline" onClick={closeEmit} disabled={emitSubmitting}>
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={() => void submitEmit()}
              disabled={emitSubmitting || !emitReason || emitReason.trim().length < 5}
              className="gap-2"
            >
              {emitSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {emitSubmitting ? "Emitiendo..." : emitForceWithoutStock ? "Emitir (forzar)" : "Emitir entrada"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <section className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        {/* Toolbar de la lista: búsqueda + orden + tamaño de página + paginación */}
        <div className="border-b border-border bg-muted/30 px-4 py-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between md:px-5">
          <div className="relative flex-1 xl:max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9 h-10 bg-background"
              placeholder="Buscar por nombre o email..."
              value={busquedaInput}
              onChange={(e) => setBusquedaInput(e.target.value)}
            />
          </div>
          <div className="flex flex-col sm:flex-row gap-3 xl:items-center xl:justify-end shrink-0">
            <Select
              value={SORT_OPTIONS.some((o) => o.value === sortValue) ? sortValue : "created_at:desc"}
              onValueChange={(v) => {
                const [nextSortBy, nextSortDir] = v.split(":")
                updateQuery({ sortBy: nextSortBy, sortDir: nextSortDir, page: 1 })
              }}
            >
              <SelectTrigger className="h-10 bg-background w-full sm:w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SORT_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={String(pageSize)} onValueChange={(v) => updateQuery({ pageSize: Number(v), page: 1 })}>
              <SelectTrigger className="h-10 bg-background w-full sm:w-24">
                <SelectValue placeholder="25" />
              </SelectTrigger>
              <SelectContent>
                {[10, 25, 50, 100].map((size) => (
                  <SelectItem key={size} value={String(size)}>{size} / pág.</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2 text-sm text-muted-foreground whitespace-nowrap">
              <span className="tabular-nums">{rangeStart}–{rangeEnd} de {pagination.total}</span>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" onClick={() => updateQuery({ page: 1 })} disabled={pagination.page <= 1} className="h-10 w-10 p-0">
                <ChevronsLeft className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => updateQuery({ page: pagination.page - 1 })} disabled={pagination.page <= 1} className="h-10 w-10 p-0">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => updateQuery({ page: pagination.page + 1 })} disabled={pagination.page >= pagination.totalPages} className="h-10 w-10 p-0">
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => updateQuery({ page: pagination.totalPages })} disabled={pagination.page >= pagination.totalPages} className="h-10 w-10 p-0">
                <ChevronsRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        {data.casos.length === 0 ? (
          <div className="p-12 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-muted">
              <Wallet className="h-6 w-6 text-muted-foreground/50" />
            </div>
            <p className="mt-4 text-sm font-medium text-foreground">No hay casos con los filtros actuales</p>
            <p className="mt-1 text-sm text-muted-foreground">Probá ampliar el rango de fechas o cambiar el estado.</p>
          </div>
        ) : (
          <div className="space-y-6 p-4 md:p-5">
            {grupos.map((grupo) => {
              const meta = SEVERITY_META[grupo.sev]
              return (
                <div key={grupo.sev} className="space-y-2.5">
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${meta.rail}`} aria-hidden />
                    <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      {meta.label}
                    </h3>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold tabular-nums text-muted-foreground">
                      {grupo.casos.length}
                    </span>
                  </div>

                  <div className="space-y-2.5">
                    {grupo.casos.map((c) => {
                      const motivo = deriveMotivo(c)
                      const isOpen = expandedId === c.id
                      const SevIcon = meta.icon
                      return (
                        <article
                          key={c.id}
                          className="overflow-hidden rounded-card border border-border bg-card shadow-sm transition-colors hover:border-primary/30"
                        >
                          <div className="flex items-stretch">
                            <span className={`w-1 shrink-0 ${meta.rail}`} aria-hidden />
                            <button
                              type="button"
                              onClick={() => setExpandedId(isOpen ? null : c.id)}
                              aria-expanded={isOpen}
                              className="flex flex-1 items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/30 sm:gap-4 sm:px-4"
                            >
                              <div className={`hidden h-9 w-9 shrink-0 items-center justify-center rounded-xl sm:flex ${meta.iconWrap}`}>
                                <SevIcon className="h-4 w-4" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                  <span className="truncate font-semibold text-foreground">
                                    {c.comprador_nombre ?? "Comprador sin nombre"}
                                  </span>
                                  <Badge variant="outline" className={`shrink-0 text-[10px] ${meta.chip}`}>
                                    {motivo.label}
                                  </Badge>
                                </div>
                                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                                  <span className="truncate">{c.comprador_email ?? "sin email"}</span>
                                  <span aria-hidden>·</span>
                                  <span className="truncate">{c.evento_nombre ?? "Evento desconocido"}</span>
                                  <span aria-hidden className="hidden sm:inline">·</span>
                                  <span className="hidden whitespace-nowrap sm:inline">{formatDateTime(c.created_at)}</span>
                                </div>
                              </div>
                              <div className="shrink-0 text-right">
                                <div className="font-mono text-sm font-bold tabular-nums text-foreground sm:text-base">
                                  {formatMoney(c.amount_total)}
                                </div>
                                {c.refund_status === "completed" ? (
                                  <div className="mt-0.5 text-[10px] font-medium text-success">
                                    Reembolsado
                                  </div>
                                ) : null}
                              </div>
                              <ChevronDown
                                className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${
                                  isOpen ? "rotate-180" : ""
                                }`}
                              />
                            </button>
                          </div>

                          {isOpen ? (
                            <div className="border-t border-border bg-muted/20 px-4 py-4 sm:px-5">
                              <div className="grid gap-5 md:grid-cols-2">
                                <dl className="space-y-2 text-sm">
                                  <div className="flex justify-between gap-3">
                                    <dt className="text-muted-foreground">ID sesión</dt>
                                    <dd className="truncate font-mono text-xs text-foreground" title={c.id}>{c.id}</dd>
                                  </div>
                                  <div className="flex justify-between gap-3">
                                    <dt className="text-muted-foreground">Creada</dt>
                                    <dd className="font-medium text-foreground">{formatDateTime(c.created_at)}</dd>
                                  </div>
                                  {c.expires_at ? (
                                    <div className="flex justify-between gap-3">
                                      <dt className="text-muted-foreground">Expiró</dt>
                                      <dd className="font-medium text-foreground">{formatDateTime(c.expires_at)}</dd>
                                    </div>
                                  ) : null}
                                  <div className="flex justify-between gap-3">
                                    <dt className="text-muted-foreground">Evento</dt>
                                    <dd className="text-right font-medium text-foreground">{c.evento_nombre ?? "—"}</dd>
                                  </div>
                                  {c.comprador_dni ? (
                                    <div className="flex justify-between gap-3">
                                      <dt className="text-muted-foreground">DNI</dt>
                                      <dd className="font-mono tabular-nums font-medium text-foreground">{c.comprador_dni}</dd>
                                    </div>
                                  ) : null}
                                  {c.payment_id ? (
                                    <div className="flex justify-between gap-3">
                                      <dt className="text-muted-foreground">MP payment_id</dt>
                                      <dd className="truncate font-mono text-xs text-foreground" title={c.payment_id}>{c.payment_id}</dd>
                                    </div>
                                  ) : null}
                                </dl>

                                <div className="space-y-3 text-sm">
                                  <div>
                                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Notificación</p>
                                    <p className="mt-1 text-xs">{renderDeliveryLine(c)}</p>
                                  </div>
                                  <div>
                                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Reembolso</p>
                                    <div className="mt-1 flex flex-wrap items-center gap-2">
                                      {renderRefundBadge(c)}
                                      {c.refund_completed_at ? (
                                        <span className="text-[11px] text-muted-foreground">{formatDateTime(c.refund_completed_at)}</span>
                                      ) : null}
                                    </div>
                                    {c.refund_status === "failed" && c.refund_error ? (
                                      <p className="mt-1.5 text-[11px] text-amber-700 dark:text-amber-400">{c.refund_error}</p>
                                    ) : null}
                                  </div>
                                </div>
                              </div>

                              <div className="mt-4 border-t border-border pt-4">
                                {puedeGestionarReembolsos ? (
                                  renderCaseActions(c)
                                ) : (
                                  <p className="text-xs text-muted-foreground">No tenés permiso para gestionar este caso.</p>
                                )}
                              </div>
                            </div>
                          ) : null}
                        </article>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Footer de paginación */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Badge variant="outline">Página {pagination.page} de {pagination.totalPages}</Badge>
            <span className="tabular-nums">{pagination.total} {pagination.total === 1 ? "caso" : "casos"}</span>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => updateQuery({ page: pagination.page - 1 })} disabled={pagination.page <= 1}>
              Anterior
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => updateQuery({ page: pagination.page + 1 })} disabled={pagination.page >= pagination.totalPages}>
              Siguiente
            </Button>
          </div>
        </div>
      </section>
    </div>
  )
}
