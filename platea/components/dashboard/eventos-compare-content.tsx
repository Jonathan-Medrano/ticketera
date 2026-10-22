"use client"

import Link from "next/link"
import Image from "next/image"
import { ArrowLeft, AlertTriangle, CalendarDays, ChevronRight } from "lucide-react"
import {
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import { formatMoney, formatInt } from "@/lib/format"
import type { Permisos } from "@/lib/permisos"

// ─── Types ───────────────────────────────────────────────────────────────────

type CategoryMixItem = {
  categoria_id: string
  nombre: string
  vendidas: number
  total: number
  pct: number | null
}

type EventoCompareItem = {
  id: string
  nombre: string
  imagen_url: string | null
  modo_fecha: "unica" | "multiple" | "pase"
  activo: number
  capacidad_total: number
  entradas_vendidas: number
  ingresos_bruto: number | null
  ingresos_neto: number | null
  ticket_promedio_bruto: number | null
  ticket_promedio_neto: number | null
  ventas_7d: number | null
  category_mix: CategoryMixItem[]
}

interface Props {
  events: EventoCompareItem[]
  excludedIds: string[]
  permisos?: Permisos
  esEmpleado?: boolean
}

// ─── Constants ────────────────────────────────────────────────────────────────

const EVENT_COLORS = ["#0052cc", "#9333ea", "#ea580c", "#16a34a"] as const

// Static map — Tailwind JIT cannot purge dynamic `grid-cols-N` template literals
const GRID_COLS_MAP: Record<number, string> = {
  2: "grid-cols-1 md:grid-cols-2",
  3: "grid-cols-1 md:grid-cols-3",
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtTicket(bruto: number | null, neto: number | null): string {
  if (bruto == null || neto == null) return "—"
  return `${formatMoney(bruto)} / ${formatMoney(neto)}`
}

function KpiRow({
  label,
  value,
  numeric = false,
}: {
  label: string
  value: string
  numeric?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "text-sm font-medium text-foreground",
          numeric && "font-mono tabular-nums"
        )}
      >
        {value}
      </dd>
    </div>
  )
}

// ─── ResumenGrid (2–3 events: side-by-side cards) ────────────────────────────

function ResumenGrid({ events }: { events: EventoCompareItem[] }) {
  const colsClass = GRID_COLS_MAP[events.length] ?? "grid-cols-1 md:grid-cols-3"

  return (
    <div className={cn("grid gap-4", colsClass)}>
      {events.map((evt) => {
        const occupancy =
          evt.capacidad_total > 0
            ? Math.round((evt.entradas_vendidas / evt.capacidad_total) * 100)
            : 0

        return (
          <article
            key={evt.id}
            className="space-y-4 rounded-2xl border border-border bg-card p-4 shadow-sm transition-colors hover:border-primary/40"
          >
            <div className="flex items-center gap-3">
              <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-card-sm border border-border bg-muted">
                {evt.imagen_url ? (
                  <Image src={evt.imagen_url} alt={evt.nombre} fill className="object-cover" unoptimized />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                    <CalendarDays className="h-5 w-5" />
                  </div>
                )}
              </div>
              <div className="min-w-0">
                <Link
                  href={`/dashboard/eventos/${evt.id}`}
                  className="block truncate font-semibold text-foreground hover:text-primary hover:underline"
                >
                  {evt.nombre}
                </Link>
                <span
                  className={cn(
                    "mt-1 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
                    evt.activo
                      ? "bg-primary/10 text-primary"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      evt.activo ? "bg-primary" : "bg-muted-foreground/60"
                    )}
                  />
                  {evt.activo ? "Activo" : "Inactivo"}
                </span>
              </div>
            </div>

            <dl className="space-y-2 border-t border-border pt-3">
              <KpiRow
                label="Capacidad"
                numeric
                value={`${formatInt(evt.entradas_vendidas)} / ${formatInt(evt.capacidad_total)}`}
              />
              <KpiRow label="Ocupación" numeric value={`${occupancy}%`} />
              <KpiRow
                label="Ingresos brutos"
                numeric
                value={formatMoney(evt.ingresos_bruto)}
              />
              <KpiRow
                label="Ingresos netos"
                numeric
                value={formatMoney(evt.ingresos_neto)}
              />
              <KpiRow
                label="Ticket prom."
                numeric
                value={fmtTicket(evt.ticket_promedio_bruto, evt.ticket_promedio_neto)}
              />
              <KpiRow
                label="Ventas 7d"
                numeric
                value={evt.ventas_7d != null ? formatInt(evt.ventas_7d) : "—"}
              />
            </dl>
          </article>
        )
      })}
    </div>
  )
}

// ─── ResumenTable (4 events: rows=KPIs, cols=events) ─────────────────────────

function ResumenTable({ events }: { events: EventoCompareItem[] }) {
  const rows: Array<{
    label: string
    numeric?: boolean
    render: (e: EventoCompareItem) => string
  }> = [
    {
      label: "Capacidad",
      numeric: true,
      render: (e) => `${formatInt(e.entradas_vendidas)} / ${formatInt(e.capacidad_total)}`,
    },
    {
      label: "Ocupación",
      numeric: true,
      render: (e) =>
        e.capacidad_total > 0
          ? `${Math.round((e.entradas_vendidas / e.capacidad_total) * 100)}%`
          : "—",
    },
    {
      label: "Ingresos brutos",
      numeric: true,
      render: (e) => formatMoney(e.ingresos_bruto),
    },
    {
      label: "Ingresos netos",
      numeric: true,
      render: (e) => formatMoney(e.ingresos_neto),
    },
    {
      label: "Ticket prom.",
      numeric: true,
      render: (e) => fmtTicket(e.ticket_promedio_bruto, e.ticket_promedio_neto),
    },
    {
      label: "Ventas 7d",
      numeric: true,
      render: (e) => (e.ventas_7d != null ? formatInt(e.ventas_7d) : "—"),
    },
  ]

  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40">
            <th className="w-32 px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Métrica
            </th>
            {events.map((e) => (
              <th
                key={e.id}
                className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground"
              >
                <Link
                  href={`/dashboard/eventos/${e.id}`}
                  className="text-foreground hover:text-primary hover:underline"
                >
                  {e.nombre}
                </Link>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.label}
              className="border-b border-border transition-colors last:border-b-0 hover:bg-muted/30"
            >
              <th
                scope="row"
                className="px-3 py-2.5 text-left font-medium text-muted-foreground"
              >
                {row.label}
              </th>
              {events.map((e) => (
                <td
                  key={e.id}
                  className={cn(
                    "px-3 py-2.5 text-foreground",
                    row.numeric && "font-mono tabular-nums"
                  )}
                >
                  {row.render(e)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── MixTable (rows=categories, cols=events) ──────────────────────────────────

function MixTable({ events }: { events: EventoCompareItem[] }) {
  const categoryNames = Array.from(
    new Set(events.flatMap((e) => e.category_mix.map((c) => c.nombre)))
  )

  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40">
            <th className="w-32 px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Categoría
            </th>
            {events.map((e) => (
              <th
                key={e.id}
                className="px-3 py-2.5 text-left text-xs font-semibold text-foreground"
              >
                {e.nombre}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {categoryNames.length === 0 ? (
            <tr>
              <td
                colSpan={1 + events.length}
                className="px-3 py-8 text-center text-muted-foreground"
              >
                Ninguno de los eventos seleccionados tiene categorías configuradas.
              </td>
            </tr>
          ) : (
            categoryNames.map((catName) => (
              <tr
                key={catName}
                className="border-b border-border transition-colors last:border-b-0 hover:bg-muted/30"
              >
                <th
                  scope="row"
                  className="px-3 py-2.5 text-left font-medium text-muted-foreground"
                >
                  {catName}
                </th>
                {events.map((e) => {
                  const c = e.category_mix.find((m) => m.nombre === catName)
                  if (!c) {
                    return (
                      <td
                        key={e.id}
                        className="px-3 py-2.5 font-mono tabular-nums text-muted-foreground"
                      >
                        —
                      </td>
                    )
                  }
                  return (
                    <td
                      key={e.id}
                      className="px-3 py-2.5 font-mono tabular-nums text-foreground"
                    >
                      {formatInt(c.vendidas)} / {formatInt(c.total)}
                      {c.pct != null ? (
                        <span className="text-muted-foreground"> ({c.pct}%)</span>
                      ) : (
                        ""
                      )}
                    </td>
                  )
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

// ─── MixChart (grouped BarChart via recharts) ─────────────────────────────────

function MixChart({ events }: { events: EventoCompareItem[] }) {
  const categoryNames = Array.from(
    new Set(events.flatMap((e) => e.category_mix.map((c) => c.nombre)))
  )

  if (categoryNames.length === 0) return null

  const chartData = categoryNames.map((catName) => {
    const row: Record<string, string | number> = { categoria: catName }
    for (const e of events) {
      const c = e.category_mix.find((m) => m.nombre === catName)
      row[e.id] = c?.vendidas ?? 0
    }
    return row
  })

  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-foreground">
        Vendidas por categoría
      </h3>
      <p className="mb-3 text-xs text-muted-foreground">
        Entradas vendidas por categoría en cada evento
      </p>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={chartData}>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--border)"
            vertical={false}
          />
          <XAxis
            dataKey="categoria"
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            contentStyle={{
              borderRadius: "12px",
              border: "1px solid var(--border)",
              background: "var(--card)",
              color: "var(--foreground)",
              fontSize: "12px",
              boxShadow: "0 12px 34px rgba(15, 23, 42, 0.08)",
            }}
            cursor={{ fill: "var(--muted)", opacity: 0.35 }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {events.map((e, i) => (
            <Bar
              key={e.id}
              dataKey={e.id}
              name={e.nombre}
              fill={EVENT_COLORS[i % EVENT_COLORS.length]}
              radius={[6, 6, 0, 0]}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

// ─── Root export ──────────────────────────────────────────────────────────────

export default function EventosCompareContent({
  events,
  excludedIds,
}: Props) {
  const useTableLayout = events.length === 4

  return (
    <div className="space-y-5 md:space-y-6">
      {/* Header */}
      <div className="space-y-1.5">
        <nav aria-label="Navegación" className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Link href="/dashboard/eventos" className="hover:text-foreground transition-colors">Eventos</Link>
          <ChevronRight className="h-3.5 w-3.5 opacity-50" />
          <span className="text-foreground font-medium">Comparar</span>
        </nav>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Comparando{" "}
          <span className="font-mono tabular-nums text-primary">
            {events.length}
          </span>{" "}
          evento{events.length !== 1 ? "s" : ""}
        </h1>
      </div>

      {/* Amber banner for excluded cross-tenant ids */}
      {excludedIds.length > 0 && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {excludedIds.length} evento
            {excludedIds.length !== 1 ? "s" : ""} no
            {excludedIds.length === 1 ? " está" : " están"} disponible
            {excludedIds.length !== 1 ? "s" : ""} para tu empresa y{" "}
            {excludedIds.length === 1 ? "fue omitido" : "fueron omitidos"} de
            la comparación.
          </span>
        </div>
      )}

      <Tabs defaultValue="resumen">
        <TabsList>
          <TabsTrigger value="resumen">Resumen</TabsTrigger>
          <TabsTrigger value="mix">Mix de categorías</TabsTrigger>
        </TabsList>

        <TabsContent value="resumen" className="mt-4">
          {useTableLayout ? (
            <ResumenTable events={events} />
          ) : (
            <ResumenGrid events={events} />
          )}
        </TabsContent>

        <TabsContent value="mix" className="mt-4 space-y-6">
          <MixTable events={events} />
          <MixChart events={events} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
