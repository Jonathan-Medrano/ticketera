"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { CheckCircle2, Filter, Loader2, RefreshCw, Search, Ticket } from "lucide-react"
import { formatMoney } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

type TicketRow = {
  id: string
  lote_id: string
  evento_id: string
  evento_nombre: string
  categoria_id: string
  categoria_nombre: string
  numero_secuencia: number
  clave_corta: string
  estado: "disponible" | "vendido" | "usada" | "anulada"
  precio_sugerido: number | null
  precio_vendido: number | null
  comprador_nombre: string | null
  comprador_dni: string | null
  vendido_at: string | null
  asignado_at: string | null
}

type SellFormState = {
  open: boolean
  ticket: TicketRow | null
  compradorNombre: string
  compradorDni: string
  precio: string
  saving: boolean
  err: string | null
}

const INITIAL_FORM: SellFormState = {
  open: false,
  ticket: null,
  compradorNombre: "",
  compradorDni: "",
  precio: "",
  saving: false,
  err: null,
}

function formatPrecio(p: number | null): string {
  if (p === null || p === undefined) return "—"
  return formatMoney(p)
}

export default function RevendedorTicketsFisicosContent() {
  const [tickets, setTickets] = useState<TicketRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [eventoFilter, setEventoFilter] = useState<string>("all")
  const [estadoFilter, setEstadoFilter] = useState<"all" | "disponible" | "vendido" | "usada">("disponible")
  const [search, setSearch] = useState("")
  const [form, setForm] = useState<SellFormState>(INITIAL_FORM)

  const fetchTickets = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/revendedor/me/tickets-fisicos", { cache: "no-store" })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as { data: { tickets: TicketRow[] } }
      setTickets(json.data.tickets)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error cargando tickets")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchTickets()
  }, [fetchTickets])

  const eventosUnicos = useMemo(() => {
    const map = new Map<string, string>()
    for (const t of tickets) if (!map.has(t.evento_id)) map.set(t.evento_id, t.evento_nombre)
    return Array.from(map.entries()).map(([id, nombre]) => ({ id, nombre }))
  }, [tickets])

  const ticketsFiltrados = useMemo(() => {
    const q = search.trim().toLowerCase()
    return tickets.filter((t) => {
      if (eventoFilter !== "all" && t.evento_id !== eventoFilter) return false
      if (estadoFilter !== "all" && t.estado !== estadoFilter) return false
      if (q) {
        const haystack = `${t.numero_secuencia} ${t.clave_corta} ${t.comprador_nombre ?? ""} ${t.comprador_dni ?? ""}`.toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })
  }, [eventoFilter, estadoFilter, search, tickets])

  const stats = useMemo(() => {
    let asignados = 0
    let vendidos = 0
    let usados = 0
    let totalCobrado = 0
    for (const t of tickets) {
      asignados += 1
      if (t.estado === "vendido") {
        vendidos += 1
        totalCobrado += t.precio_vendido ?? 0
      } else if (t.estado === "usada") {
        vendidos += 1
        usados += 1
        totalCobrado += t.precio_vendido ?? 0
      }
    }
    return { asignados, vendidos, usados, totalCobrado, disponibles: asignados - vendidos }
  }, [tickets])

  const openSellForm = useCallback((ticket: TicketRow) => {
    setForm({
      open: true,
      ticket,
      compradorNombre: "",
      compradorDni: "",
      precio: String(ticket.precio_sugerido ?? ""),
      saving: false,
      err: null,
    })
  }, [])

  const submitVenta = useCallback(async () => {
    if (!form.ticket) return
    setForm((f) => ({ ...f, saving: true, err: null }))
    try {
      const body: Record<string, unknown> = {
        comprador_nombre: form.compradorNombre.trim(),
        comprador_dni: form.compradorDni.trim() || null,
      }
      const precioNum = Number(form.precio)
      if (Number.isFinite(precioNum) && precioNum >= 0) body.precio_vendido = precioNum

      const res = await fetch(`/api/revendedor/me/tickets-fisicos/${form.ticket.id}/vender`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error ?? `HTTP ${res.status}`)
      }
      setForm(INITIAL_FORM)
      void fetchTickets()
    } catch (err) {
      setForm((f) => ({ ...f, saving: false, err: err instanceof Error ? err.message : "Error" }))
    }
  }, [fetchTickets, form])

  return (
    <div className="space-y-6 p-4 md:p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Tickets físicos asignados</h1>
        <p className="text-sm text-muted-foreground">
          Estos son los tickets físicos que la empresa te entregó para vender en mano. Marcalos como vendidos a medida que los entregás al
          comprador para tener trazabilidad y cobrar tu comisión.
        </p>
      </header>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Asignados" value={stats.asignados} />
        <StatCard label="Disponibles" value={stats.disponibles} accent="info" />
        <StatCard label="Vendidos" value={stats.vendidos} accent="ok" />
        <StatCard label="Cobrado" value={formatPrecio(stats.totalCobrado)} mono />
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">{error}</div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Buscar por nº, código o comprador…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-10 w-full pl-9"
          />
        </div>

        <Select value={eventoFilter} onValueChange={setEventoFilter}>
          <SelectTrigger className="h-10 w-full bg-background sm:w-56">
            <SelectValue placeholder="Todos los eventos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los eventos</SelectItem>
            {eventosUnicos.map((e) => (
              <SelectItem key={e.id} value={e.id}>
                {e.nombre}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={estadoFilter} onValueChange={(v) => setEstadoFilter(v as typeof estadoFilter)}>
          <SelectTrigger className="h-10 w-full bg-background sm:w-40">
            <SelectValue placeholder="Por vender" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="disponible">Por vender</SelectItem>
            <SelectItem value="vendido">Vendidos</SelectItem>
            <SelectItem value="usada">Usados</SelectItem>
            <SelectItem value="all">Todos</SelectItem>
          </SelectContent>
        </Select>

        <Button type="button" variant="outline" className="h-10 gap-1.5" onClick={() => void fetchTickets()}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refrescar
        </Button>
      </div>

      {/* Tickets table */}
      {loading ? (
        <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando…
        </div>
      ) : ticketsFiltrados.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/60 px-4 py-10 text-center">
          <Ticket className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">
            {tickets.length === 0
              ? "Todavía no te asignaron tickets físicos. Cuando la empresa te asigne un lote, los vas a ver acá."
              : "No hay tickets que coincidan con los filtros."}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border/60">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border/60 bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2.5 font-medium">Nº</th>
                <th className="px-3 py-2.5 font-medium">Evento · Categoría</th>
                <th className="px-3 py-2.5 font-medium">Código</th>
                <th className="px-3 py-2.5 font-medium">Estado</th>
                <th className="px-3 py-2.5 font-medium text-right">Precio</th>
                <th className="px-3 py-2.5 font-medium">Comprador</th>
                <th className="px-3 py-2.5 font-medium" />
              </tr>
            </thead>
            <tbody>
              {ticketsFiltrados.map((t) => (
                <tr key={t.id} className="border-b border-border/40 last:border-b-0">
                  <td className="px-3 py-3 font-mono text-xs">#{t.numero_secuencia.toString().padStart(4, "0")}</td>
                  <td className="px-3 py-3">
                    <div className="font-medium">{t.evento_nombre}</div>
                    <div className="text-xs text-muted-foreground">{t.categoria_nombre}</div>
                  </td>
                  <td className="px-3 py-3 font-mono text-xs">{t.clave_corta}</td>
                  <td className="px-3 py-3">
                    <EstadoBadge estado={t.estado} />
                  </td>
                  <td className="px-3 py-3 text-right font-mono tabular-nums">
                    {t.estado === "disponible" ? formatPrecio(t.precio_sugerido) : formatPrecio(t.precio_vendido)}
                  </td>
                  <td className="px-3 py-3 text-xs text-muted-foreground">
                    {t.comprador_nombre ? (
                      <>
                        <div>{t.comprador_nombre}</div>
                        {t.comprador_dni && <div className="font-mono text-[10px]">DNI {t.comprador_dni}</div>}
                      </>
                    ) : (
                      <span className="text-muted-foreground/50">—</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right">
                    {t.estado === "disponible" && (
                      <button
                        type="button"
                        onClick={() => openSellForm(t)}
                        className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Vender
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Sell modal */}
      <Dialog open={form.open} onOpenChange={(v) => { if (!v) setForm(INITIAL_FORM) }}>
        <DialogContent className="bg-card sm:max-w-md">
          {form.ticket && (
            <>
              <DialogHeader>
                <DialogTitle className="text-foreground">
                  Vender ticket #{form.ticket.numero_secuencia.toString().padStart(4, "0")}
                </DialogTitle>
                <DialogDescription>
                  {form.ticket.evento_nombre} · {form.ticket.categoria_nombre}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="ticket-comprador-nombre" className="text-xs text-muted-foreground">
                    Nombre del comprador *
                  </Label>
                  <Input
                    id="ticket-comprador-nombre"
                    type="text"
                    value={form.compradorNombre}
                    onChange={(e) => setForm((f) => ({ ...f, compradorNombre: e.target.value }))}
                    className="h-10"
                    autoFocus
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ticket-comprador-dni" className="text-xs text-muted-foreground">
                    DNI (opcional)
                  </Label>
                  <Input
                    id="ticket-comprador-dni"
                    type="text"
                    value={form.compradorDni}
                    onChange={(e) => setForm((f) => ({ ...f, compradorDni: e.target.value }))}
                    className="h-10"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ticket-precio" className="text-xs text-muted-foreground">
                    Precio cobrado
                  </Label>
                  <Input
                    id="ticket-precio"
                    type="number"
                    min={0}
                    step={100}
                    value={form.precio}
                    onChange={(e) => setForm((f) => ({ ...f, precio: e.target.value }))}
                    className="h-10"
                  />
                  <span className="text-xs text-muted-foreground">
                    Sugerido: <span className="font-mono tabular-nums">{formatPrecio(form.ticket.precio_sugerido)}</span>
                  </span>
                </div>
              </div>

              {form.err && (
                <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">
                  {form.err}
                </p>
              )}

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setForm(INITIAL_FORM)}>
                  Cancelar
                </Button>
                <Button
                  type="button"
                  onClick={() => void submitVenta()}
                  disabled={form.saving || !form.compradorNombre.trim()}
                  className="gap-1.5"
                >
                  {form.saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Marcar vendido
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <p className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
        <Filter className="h-3 w-3" />
        Filtros activos: {ticketsFiltrados.length} de {tickets.length} tickets totales
      </p>
    </div>
  )
}

function StatCard({
  label,
  value,
  accent,
  mono,
}: {
  label: string
  value: number | string
  accent?: "info" | "ok"
  mono?: boolean
}) {
  const accentClass =
    accent === "ok"
      ? "border-emerald-500/30 bg-emerald-500/5"
      : accent === "info"
        ? "border-cyan-500/30 bg-cyan-500/5"
        : "border-border/60"
  return (
    <div className={`rounded-xl border ${accentClass} p-3`}>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-0.5 text-lg font-bold tabular-nums ${mono ? "font-mono" : ""}`}>{value}</div>
    </div>
  )
}

function EstadoBadge({ estado }: { estado: TicketRow["estado"] }) {
  const map: Record<TicketRow["estado"], string> = {
    disponible: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300",
    vendido: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    usada: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    anulada: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  }
  const label: Record<TicketRow["estado"], string> = {
    disponible: "Por vender",
    vendido: "Vendido",
    usada: "Usado",
    anulada: "Anulado",
  }
  return <span className={`rounded-md ${map[estado]} px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider`}>{label[estado]}</span>
}
