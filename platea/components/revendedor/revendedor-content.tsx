"use client"

import { useState } from "react"
import Image from "next/image"
import { Copy, Check, Ticket, TrendingUp, ShoppingBag, BarChart2 } from "lucide-react"
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer } from "recharts"
import type { Permisos } from "@/lib/permisos"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { formatMoney, formatDate } from "@/lib/format"
import { buildTenantPublicUrl } from "@/lib/tenant-routes"

type RevendedorMe = {
  id: string
  nombre: string
  apellido?: string | null
  email: string
  porcentaje_comision?: number | null
}

type RevendedorVenta = {
  id: string
  precio_pagado: number
  created_at: string
  estado: string
  evento_nombre: string
  evento_id: string
  imagen_url?: string | null
  categoria_nombre?: string | null
}

type RevendedorEvento = {
  id: string
  nombre: string
  imagen_url?: string | null
  stock_disponible: number
  vendidas: number
  stock_total: number
}

interface Props {
  revendedor: RevendedorMe
  ventas: RevendedorVenta[]
  eventos: RevendedorEvento[]
  stats: {
    totalVendidas: number
    totalGenerado: number
    comision: number
    ganancia: number
  }
  empresaSlug: string
  ventasPorDia: { dia: string; ventas: number }[]
  permisos?: Permisos
}

const tooltipStyle = {
  background: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: "12px",
  fontSize: "12px",
  color: "var(--foreground)",
}

export default function RevendedorContent({
  revendedor,
  ventas,
  eventos,
  stats,
  empresaSlug,
  ventasPorDia,
  permisos,
}: Props) {
  const [copiadoEvento, setCopiadoEvento] = useState<string | null>(null)

  const verComision = !permisos || permisos.ver_comision_propia
  const verGanancia = !permisos || permisos.ver_ganancia_propia

  // buildTenantPublicUrl() (lib/tenant-routes.ts) lee NEXT_PUBLIC_ROOT_DOMAIN, una
  // env var pública que Next inyecta como literal en build time — el mismo string
  // en el HTML de SSR y en el bundle que hidrata en cliente. No es `window.location`
  // (que sí diverge entre server y cliente): no reintroduce el hydration mismatch
  // que el comentario original evitaba.
  function getLinkReferido(eventoId?: string) {
    const path = eventoId ? `/evento/${eventoId}` : ""
    return `${buildTenantPublicUrl(empresaSlug)}${path}?ref=${revendedor.id}`
  }

  function copiarLink(eventoId: string) {
    navigator.clipboard.writeText(getLinkReferido(eventoId))
    setCopiadoEvento(eventoId)
    setTimeout(() => setCopiadoEvento(null), 2000)
  }

  const cards = [
    {
      label: "Entradas vendidas",
      value: stats.totalVendidas,
      mono: false,
      icon: ShoppingBag,
      color: "text-primary",
      bg: "bg-primary/10",
      mostrar: true,
    },
    {
      label: "Comisión",
      value: `${stats.comision}%`,
      mono: false,
      icon: BarChart2,
      color: "text-purple-600 dark:text-purple-400",
      bg: "bg-purple-100 dark:bg-purple-900/30",
      mostrar: verComision,
    },
    {
      label: "Total generado",
      value: formatMoney(stats.totalGenerado),
      mono: true,
      icon: TrendingUp,
      color: "text-emerald-600 dark:text-emerald-400",
      bg: "bg-emerald-100 dark:bg-emerald-900/30",
      mostrar: verGanancia,
    },
    {
      label: "Tus ganancias",
      value: formatMoney(stats.ganancia),
      mono: true,
      icon: TrendingUp,
      color: "text-amber-600 dark:text-amber-400",
      bg: "bg-amber-500/10",
      mostrar: verGanancia && verComision,
    },
  ].filter((c) => c.mostrar)

  return (
    <div className="space-y-6 pb-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Hola, {revendedor.nombre} 👋</h1>
        <p className="text-muted-foreground text-sm mt-1">Este es tu panel de revendedor</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 md:gap-4">
        {cards.map(({ label, value, icon: Icon, color, bg, mono }) => (
          <div key={label} className="bg-card rounded-2xl border border-border p-4 md:p-5">
            <div className={`h-9 w-9 rounded-xl ${bg} flex items-center justify-center mb-3`}>
              <Icon className={`h-4 w-4 ${color}`} />
            </div>
            <p className="text-xs text-muted-foreground mb-1">{label}</p>
            <p
              className={`text-xl md:text-2xl font-bold text-foreground${
                mono ? " font-mono tabular-nums" : ""
              }`}
            >
              {value}
            </p>
          </div>
        ))}
      </div>

      {/* Gráfico ventas últimos 30 días */}
      {ventasPorDia.length > 0 && (
        <div className="bg-card rounded-2xl border border-border p-5">
          <h2 className="font-semibold text-foreground mb-4">Mis ventas — últimos 30 días</h2>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={ventasPorDia}>
              <defs>
                <linearGradient id="colorVentasRev" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--marketing-accent)" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="var(--marketing-accent)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="dia" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} allowDecimals={false} />
              <RechartsTooltip contentStyle={tooltipStyle} />
              <Area type="monotone" dataKey="ventas" stroke="var(--marketing-accent)" strokeWidth={2} fill="url(#colorVentasRev)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Eventos con links */}
      <div className="bg-card rounded-2xl border border-border p-5">
        <h2 className="font-semibold text-foreground mb-4">Tus links de referido</h2>
        {eventos.length === 0 ? (
          <div className="text-center py-10">
            <Ticket className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground text-sm">No hay eventos activos</p>
          </div>
        ) : (
          <div className="space-y-3">
            {eventos.map((ev) => {
              const porcentaje =
                ev.stock_total > 0 ? Math.round((ev.vendidas / ev.stock_total) * 100) : 0

              return (
                <div
                  key={ev.id}
                  className="flex gap-3 md:gap-4 items-start bg-muted/30 rounded-2xl p-4"
                >
                  {/* Imagen */}
                  <div className="relative h-14 w-14 rounded-xl bg-muted shrink-0 overflow-hidden">
                    {ev.imagen_url ? (
                      <Image
                        src={ev.imagen_url}
                        alt={ev.nombre}
                        fill
                        className="object-cover"
                        unoptimized
                      />
                    ) : (
                      <div className="h-full w-full flex items-center justify-center">
                        <Ticket className="h-6 w-6 text-muted-foreground" />
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-foreground truncate">{ev.nombre}</p>
                    <div className="flex items-center gap-3 mt-1 flex-wrap text-xs text-muted-foreground">
                      <span>{ev.vendidas} vendidas</span>
                      <span>{ev.stock_disponible} disponibles</span>
                    </div>

                    {/* Barra progreso */}
                    {ev.stock_total > 0 && (
                      <div className="mt-2">
                        <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-1.5 bg-primary rounded-full transition-all"
                            style={{ width: `${porcentaje}%` }}
                          />
                        </div>
                      </div>
                    )}

                    {/* Link */}
                    <TooltipProvider>
                    <div className="mt-2 flex items-center gap-2">
                      <code className="text-xs bg-muted px-2 py-1 rounded-lg text-muted-foreground truncate max-w-50 md:max-w-xs">
                        {getLinkReferido(ev.id)}
                      </code>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={() => copiarLink(ev.id)}
                            className="h-7 w-7 rounded-lg bg-muted hover:bg-primary/10 flex items-center justify-center text-muted-foreground hover:text-primary transition-colors shrink-0"
                            aria-label="Copiar link referido"
                          >
                            {copiadoEvento === ev.id ? (
                              <Check className="h-3.5 w-3.5 text-green-500" />
                            ) : (
                              <Copy className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>{copiadoEvento === ev.id ? "Link copiado" : "Copiar link referido"}</TooltipContent>
                      </Tooltip>
                    </div>
                    </TooltipProvider>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Últimas ventas */}
      <div className="bg-card rounded-2xl border border-border p-5">
        <h2 className="font-semibold text-foreground mb-4">
          Mis ventas
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            ({ventas.filter((v) => v.estado !== "cancelada").length})
          </span>
        </h2>
        {ventas.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Todavía no registraste ventas. Compartí tu link de referido para empezar.
          </p>
        ) : (
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {ventas.map((v) => (
              <div
                key={v.id}
                className="flex items-center justify-between bg-muted/40 rounded-xl px-4 py-3"
              >
                <div>
                  <p className="text-sm font-medium text-foreground">{v.evento_nombre}</p>
                  <p className="text-xs text-muted-foreground">
                    {v.categoria_nombre} · {formatDate(v.created_at)}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  {verGanancia && (
                    <p className="text-sm font-bold text-foreground font-mono tabular-nums">
                      {formatMoney(v.precio_pagado)}
                    </p>
                  )}
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      v.estado === "valida"
                        ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                        : v.estado === "usada"
                          ? "bg-muted text-muted-foreground"
                          : "bg-destructive/10 text-destructive"
                    }`}
                  >
                    {v.estado === "valida" ? "Válida" : v.estado === "usada" ? "Usada" : "Cancelada"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
