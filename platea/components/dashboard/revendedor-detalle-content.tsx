"use client"

import { useState, useMemo, useEffect } from "react"
import Image from "next/image"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ArrowLeft, ChevronRight, ShoppingBag, TrendingUp, Percent, Save, Calendar, Filter, KeyRound, Ticket, ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import PasswordInput from "@/components/password-input"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts"
import { useLoading } from "@/components/loading-provider"
import { formatMoney, formatDate } from "@/lib/format"

interface Props {
  revendedor: {
    id: string
    nombre: string
    apellido?: string | null
    email: string
    activo: number
    porcentaje_comision?: number | null
    total_ventas: number
    total_generado: number
    // Suma real de comision_revendedor congelada por venta (server-side) —
    // el monto real a pagar, independiente del % que esté tipeado en el input.
    total_comision: number
  }
  ventasPorEvento: Array<{
    id: string
    nombre: string
    imagen_url?: string | null
    total_ventas: number
    total_generado: number
  }>
  ventasPorDia: { dia: string; ventas: number }[]
  ultimasVentas: Array<{
    id: string
    precio_pagado: number
    estado: string
    created_at: string
    evento_id: string
    evento_nombre: string
    categoria_nombre?: string | null
    comprador_nombre?: string | null
  }>
}

export default function RevendedorDetalleContent({
  revendedor,
  ventasPorEvento,
  ventasPorDia,
  ultimasVentas,
}: Props) {
  const router = useRouter()
  const { withLoading } = useLoading()
  const [comision, setComision] = useState(revendedor.porcentaje_comision?.toString() ?? "0")
  const [activo, setActivo] = useState(revendedor.activo)
  const [confirmToggle, setConfirmToggle] = useState(false)

  // Re-sincroniza el estado local cuando cambia el revendedor (navegación detalle→detalle),
  // evitando editar la comisión del revendedor equivocado. Dependencia SOLO en el id.
  useEffect(() => {
    setComision(revendedor.porcentaje_comision?.toString() ?? "0")
    setActivo(revendedor.activo)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revendedor.id])

  // Filtros
  const [eventoFiltro, setEventoFiltro] = useState("todos")
  const [fechaDesde, setFechaDesde] = useState("")
  const [fechaHasta, setFechaHasta] = useState("")

  // Reset password modal state
  const [passwordModalOpen, setPasswordModalOpen] = useState(false)
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [passwordError, setPasswordError] = useState("")

  // Eventos únicos para el select
  const eventosUnicos = useMemo(() => {
    const map = new Map<string, string>()
    ultimasVentas.forEach((v) => {
      if (v.evento_id && v.evento_nombre) map.set(v.evento_id, v.evento_nombre)
    })
    return Array.from(map.entries()).map(([id, nombre]) => ({ id, nombre }))
  }, [ultimasVentas])

  // Ventas filtradas
  const ventasFiltradas = useMemo(() => {
    return ultimasVentas.filter((v) => {
      const matchEvento = eventoFiltro === "todos" || v.evento_id === eventoFiltro
      const fecha = new Date(v.created_at)
      const matchDesde = !fechaDesde || fecha >= new Date(fechaDesde + "T00:00:00-03:00")
      const matchHasta = !fechaHasta || fecha <= new Date(fechaHasta + "T23:59:59.999-03:00")
      return matchEvento && matchDesde && matchHasta
    })
  }, [ultimasVentas, eventoFiltro, fechaDesde, fechaHasta])

  // Stats filtradas
  const totalFiltrado = ventasFiltradas
    .filter((v) => v.estado !== "cancelada")
    .reduce((acc, v) => acc + Number(v.precio_pagado), 0)
  // Estimación con el % tipeado en el input (puede no estar guardado todavía).
  // El backend no manda la comisión congelada por venta en este listado, así que
  // para un rango filtrado no podemos calcular el monto REAL adeudado — solo una
  // aproximación. Por eso el label aclara "estimado" y no "a pagar".
  const gananciaFiltradaEstimada = (totalFiltrado * Number(comision)) / 100
  const hayFiltros = eventoFiltro !== "todos" || fechaDesde || fechaHasta

  const totalGenerado = Number(revendedor.total_generado)
  // Monto real: suma de comision_revendedor congelada por venta, calculada
  // server-side (revendedores.ts). NO se recalcula con el % del input — si la
  // comisión cambió alguna vez, este es el número que hay que pagar.
  const gananciaTotal = Number(revendedor.total_comision)

  async function guardarComision() {
    const val = Number(comision)
    if (isNaN(val) || val < 0 || val > 100) {
      toast.error("La comisión debe ser un número entre 0 y 100")
      return
    }
    await withLoading(async () => {
      const res = await fetch(`/api/equipo/${revendedor.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ porcentaje_comision: val }),
      })
      if (!res.ok) {
        const data = await res.json()
        toast.error(data.error ?? "No se pudo guardar la comisión")
        return
      }
      toast.success("Comisión actualizada")
      router.refresh()
    })
  }

  async function handleResetPassword() {
    setPasswordError("")
    if (!newPassword) {
      setPasswordError("La nueva contraseña es obligatoria")
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("Las contraseñas no coinciden")
      return
    }
    // No validamos la policy acá: la empresa puede setear cualquier contraseña
    // como reset. El revendedor la rota en su próximo login con la policy enforced.
    await withLoading(async () => {
      const res = await fetch(`/api/equipo/${revendedor.id}/password`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setPasswordError(data.error ?? "No se pudo cambiar la contraseña")
        return
      }
      toast.success("Contraseña actualizada. El revendedor deberá cambiarla en su próximo login.")
      setPasswordModalOpen(false)
      setNewPassword("")
      setConfirmPassword("")
    })
  }

  async function toggleActivo() {
    await withLoading(async () => {
      const res = await fetch(`/api/equipo/${revendedor.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activo: activo ? 0 : 1 }),
      })
      if (!res.ok) {
        const data = await res.json()
        toast.error(data.error ?? "No se pudo actualizar el estado")
        return
      }
      setActivo((prev: number) => (prev ? 0 : 1))
      router.refresh()
    })
  }

  const tooltipStyle = {
    borderRadius: "12px",
    border: "1px solid var(--border)",
    background: "var(--card)",
    color: "var(--foreground)",
    fontSize: "13px",
    boxShadow: "none",
  }

  return (
    <div className="space-y-5 pb-8">
      {/* Header */}
      <div className="space-y-3">
        <nav aria-label="Navegación" className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Link href="/dashboard/revendedores" className="hover:text-foreground transition-colors">Revendedores</Link>
          <ChevronRight className="h-3.5 w-3.5 opacity-50" />
          <span className="text-foreground font-medium truncate max-w-xs">{revendedor.nombre} {revendedor.apellido ?? ""}</span>
        </nav>
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <h1 className="text-xl md:text-2xl font-bold text-foreground">
              {revendedor.nombre} {revendedor.apellido ?? ""}
            </h1>
            <p className="text-sm text-muted-foreground">{revendedor.email}</p>
            <Link
              href={`/dashboard/equipo/${revendedor.id}`}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mt-1"
            >
              <ExternalLink className="h-3 w-3" /> Ver en Equipo
            </Link>
          </div>
          <Button
            variant={activo ? "destructive" : "default"}
            onClick={() => setConfirmToggle(true)}
            className="shrink-0 h-9 px-4"
          >
            {activo ? "Desactivar" : "Activar"}
          </Button>
        </div>
      </div>

      {/* Confirmación activar/desactivar */}
      <Dialog open={confirmToggle} onOpenChange={setConfirmToggle}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {activo ? "Desactivar revendedor" : "Activar revendedor"}
            </DialogTitle>
            <DialogDescription className="sr-only">Confirmación para cambiar el estado de acceso del revendedor.</DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {activo
              ? `¿Seguro que querés desactivar a ${revendedor.nombre} ${revendedor.apellido ?? ""}? No podrá vender entradas hasta que lo reactives.`
              : `¿Seguro que querés activar a ${revendedor.nombre} ${revendedor.apellido ?? ""}? Volverá a poder vender entradas.`}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmToggle(false)}>
              Cancelar
            </Button>
            <Button
              variant={activo ? "destructive" : "default"}
              onClick={() => {
                toggleActivo()
                setConfirmToggle(false)
              }}
            >
              {activo ? "Desactivar" : "Activar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Stats globales */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        {[
          {
            label: "Entradas vendidas",
            value: revendedor.total_ventas,
            icon: ShoppingBag,
            color: "text-primary",
            bg: "bg-primary/10",
          },
          {
            label: "Venta bruta generada",
            value: formatMoney(totalGenerado),
            mono: true,
            icon: TrendingUp,
            color: "text-green-600 dark:text-green-400",
            bg: "bg-success/10",
          },
          {
            label: "Ganancias a pagar",
            value: formatMoney(gananciaTotal),
            mono: true,
            icon: TrendingUp,
            color: "text-amber-600 dark:text-amber-400",
            bg: "bg-amber-500/10",
          },
        ].map(({ label, value, mono, icon: Icon, color, bg }) => (
          <div key={label} className="bg-card rounded-2xl border border-border p-4">
            <div className={`h-8 w-8 rounded-lg ${bg} flex items-center justify-center mb-3`}>
              <Icon className={`h-4 w-4 ${color}`} />
            </div>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className={`text-lg md:text-xl font-bold text-foreground${mono ? " font-mono tabular-nums" : ""}`}>{value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Comisión */}
        <div className="bg-card rounded-2xl border border-border p-5">
          <h2 className="font-semibold text-foreground mb-4 flex items-center gap-2">
            <Percent className="h-4 w-4" /> Comisión
          </h2>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="comision-input" className="text-xs text-muted-foreground">Porcentaje actual</Label>
              <div className="relative">
                <Input
                  id="comision-input"
                  className="h-10 pr-8"
                  type="number"
                  min="0"
                  max="100"
                  value={comision}
                  onChange={(e) => setComision(e.target.value)}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                  %
                </span>
              </div>
            </div>
            <div className="bg-muted/40 rounded-xl p-3">
              <p className="text-xs text-muted-foreground">Ganancias reales adeudadas</p>
              <p className="text-lg font-bold text-foreground font-mono tabular-nums">
                {formatMoney(gananciaTotal)}
              </p>
              <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
                Suma de la comisión congelada en cada venta pagada. No cambia hasta que guardes un nuevo % — editar el campo de arriba no la modifica.
              </p>
            </div>
            <Button className="w-full h-9 gap-2" onClick={guardarComision}>
              <Save className="h-3.5 w-3.5" /> Guardar comisión
            </Button>
          </div>
        </div>

        {/* Ventas por evento */}
        <div className="lg:col-span-2 bg-card rounded-2xl border border-border p-5">
          <h2 className="font-semibold text-foreground mb-4">Ventas brutas por evento</h2>
          {ventasPorEvento.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin ventas registradas</p>
          ) : (
            <div className="space-y-3">
              {ventasPorEvento.map((ev) => (
                <div
                  key={ev.id}
                  className="flex items-center gap-3 bg-muted/40 rounded-xl px-4 py-3"
                >
                  <div className="relative h-10 w-10 rounded-lg bg-muted shrink-0 overflow-hidden">
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
                        <Ticket className="h-4 w-4 text-muted-foreground" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{ev.nombre}</p>
                    <p className="text-xs text-muted-foreground">{ev.total_ventas} entradas</p>
                  </div>
                <p className="text-sm font-bold text-foreground shrink-0 font-mono tabular-nums">
                  {formatMoney(Number(ev.total_generado))}
                </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Seguridad */}
      <div className="bg-card rounded-2xl border border-border p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-muted p-2 shrink-0">
              <KeyRound className="h-5 w-5 text-foreground" />
            </div>
            <div>
              <h2 className="font-semibold text-foreground">Seguridad de la cuenta</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Resetear la contraseña obliga al revendedor a elegir una nueva en su próximo login.
              </p>
            </div>
          </div>
          <Button variant="outline" className="h-9 gap-2" onClick={() => setPasswordModalOpen(true)}>
            <KeyRound className="h-4 w-4" /> Cambiar contraseña
          </Button>
        </div>
      </div>

      <Dialog open={passwordModalOpen} onOpenChange={(open) => {
        if (!open) {
          setPasswordModalOpen(false)
          setNewPassword("")
          setConfirmPassword("")
          setPasswordError("")
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cambiar contraseña del revendedor</DialogTitle>
            <DialogDescription className="sr-only">Ingresá una nueva contraseña temporal para el revendedor.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Ingresá una nueva contraseña para <span className="font-medium text-foreground">{revendedor.nombre} {revendedor.apellido ?? ""}</span>.
              El revendedor deberá cambiarla por una propia al loguearse.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="reset-nueva-password" className="text-xs text-muted-foreground">Nueva contraseña</Label>
              <PasswordInput
                id="reset-nueva-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
              />
              <p className="text-xs text-muted-foreground">
                Cualquier contraseña sirve — el revendedor la rotará a una segura en su próximo login.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reset-confirmar-password" className="text-xs text-muted-foreground">Confirmar contraseña</Label>
              <PasswordInput
                id="reset-confirmar-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            {passwordError && <p className="text-xs text-destructive">{passwordError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPasswordModalOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleResetPassword}>
              Guardar contraseña
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Gráfico */}
      {ventasPorDia.length > 0 && (
        <div className="bg-card rounded-2xl border border-border p-5">
          <h2 className="font-semibold text-foreground mb-4">Ventas últimos 30 días</h2>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={ventasPorDia}>
              <defs>
                <linearGradient id="colorVentas" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="var(--primary)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis
                dataKey="dia"
                tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip contentStyle={tooltipStyle} />
              <Area
                type="monotone"
                dataKey="ventas"
                stroke="var(--primary)"
                strokeWidth={2}
                fill="url(#colorVentas)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Ventas con filtros */}
      {ultimasVentas.length > 0 && (
        <div className="bg-card rounded-2xl border border-border p-5">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <h2 className="font-semibold text-foreground">
              Historial de ventas
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                ({ventasFiltradas.filter((v) => v.estado !== "cancelada").length}
                {hayFiltros
                  ? ` de ${ultimasVentas.filter((v) => v.estado !== "cancelada").length}`
                  : ""})
              </span>
            </h2>
          </div>

          {/* Filtros */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4 p-4 bg-muted/30 rounded-xl border border-border">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Filter className="h-3 w-3" /> Evento
              </Label>
              <Select value={eventoFiltro} onValueChange={setEventoFiltro}>
                <SelectTrigger className="h-9 bg-card text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="px-1 py-1">
                  <SelectItem value="todos">Todos los eventos</SelectItem>
                  {eventosUnicos.map((ev) => (
                    <SelectItem key={ev.id} value={ev.id}>
                      {ev.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Calendar className="h-3 w-3" /> Desde
              </Label>
              <Input
                type="date"
                className="h-9 bg-card text-sm"
                value={fechaDesde}
                onChange={(e) => setFechaDesde(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Calendar className="h-3 w-3" /> Hasta
              </Label>
              <Input
                type="date"
                className="h-9 bg-card text-sm"
                value={fechaHasta}
                onChange={(e) => setFechaHasta(e.target.value)}
              />
            </div>
          </div>

          {/* Resumen filtrado */}
          {hayFiltros && (
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="bg-muted/40 rounded-xl p-3">
                <p className="text-xs text-muted-foreground">Venta bruta en período</p>
                <p className="text-lg font-bold text-foreground font-mono tabular-nums">
                  {formatMoney(totalFiltrado)}
                </p>
              </div>
              <div className="bg-muted/40 rounded-xl p-3">
                <p className="text-xs text-muted-foreground">Estimado con {comision}% actual</p>
                <p className="text-lg font-bold text-amber-600 dark:text-amber-400 font-mono tabular-nums">
                  {formatMoney(gananciaFiltradaEstimada)}
                </p>
                <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
                  Aproximado — puede diferir de lo real si la comisión cambió en el período.
                </p>
              </div>
            </div>
          )}

          {/* Lista ventas */}
          {ventasFiltradas.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-sm text-muted-foreground">No hay ventas con esos filtros</p>
              <button
                onClick={() => { setEventoFiltro("todos"); setFechaDesde(""); setFechaHasta("") }}
                className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
              >
                Limpiar filtros
              </button>
            </div>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
              {ventasFiltradas.map((v) => (
                <div
                  key={v.id}
                  className="flex items-center justify-between bg-muted/40 rounded-xl px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {v.evento_nombre}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {v.categoria_nombre ?? "—"} · {v.comprador_nombre ?? "—"} ·{" "}
                      {formatDate(v.created_at)}
                    </p>
                  </div>
                  <div className="text-right shrink-0 ml-3">
                    <p className="text-sm font-bold text-foreground font-mono tabular-nums">
                      {formatMoney(Number(v.precio_pagado))}
                    </p>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        v.estado === "valida"
                          ? "bg-success/10 text-success"
                          : v.estado === "usada"
                            ? "bg-muted text-muted-foreground"
                            : "bg-destructive/10 text-destructive"
                      }`}
                    >
                      {v.estado}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Limpiar filtros */}
          {hayFiltros && (
            <button
              onClick={() => { setEventoFiltro("todos"); setFechaDesde(""); setFechaHasta("") }}
              className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
            >
              Limpiar filtros
            </button>
          )}
        </div>
      )}
    </div>
  )
}
