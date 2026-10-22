"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  ArrowLeft,
  ChevronRight,
  CalendarDays,
  MapPin,
  Ticket,
  TrendingUp,
  Plus,
  Pause,
  Play,
  DollarSign,
  CheckCircle2,
  XCircle,
  MoreVertical,
  Trash2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { IconAction } from "@/components/ui/icon-action"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import Link from "next/link"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useLoading } from "../loading-provider"
import Image from "next/image"
import { puedeHacer, type Permisos } from "@/lib/permisos"
import { formatMoney, formatInt, formatDate, formatTime } from "@/lib/format"
import { getPublicationStatusLabel } from "@/lib/publication-status"
import EventoAddonsSection, { type EventoAddonRow } from "./evento-addons-section"

type EventoDetalle = {
  id: string
  nombre: string
  descripcion?: string | null
  lugar?: string | null
  imagen_url?: string | null
  modo_fecha: "unica" | "multiple" | "pase"
  activo: number
  tipo_mapa?: string | null
  venta_consumibles_habilitada: number
  buyer_event_refunds_enabled?: number
  publication_status: "hidden" | "listed" | "live"
  publication_reason: "manual_inactive" | "scheduled_hidden" | "scheduled_listed" | "scheduled_detail_visible" | "live"
  publication: {
    mode: "immediate" | "scheduled"
    pre_publish_visibility: "hidden" | "listado_solo" | "detail_visible"
    publish_at_utc: string | null
    publish_timezone: string | null
    published_live_at: string | null
    publish_date_local?: string
    publish_time_local?: string
  }
}

type EventoCategoria = {
  id: string
  nombre: string
  descripcion?: string | null
  precio: number | null
  stock: number
  stock_disponible: number
  activa: number
  tanda_id?: string | null
}

type EventoTanda = {
  id: string
  nombre: string
  descripcion?: string | null
  imagen_url?: string | null
  estado: "activa" | "proxima" | "inactiva" | "agotada"
  orden: number
  activa_desde?: string | null
}

type EventoFecha = {
  id: string
  fecha: string
}

type EventoVenta = {
  id: string
  precio_pagado: number | null
  neto_empresa_amount?: number | null
  estado: "valida" | "usada" | "cancelada"
  created_at: string
  comprador_nombre: string
  comprador_email: string | null
  categoria_nombre: string | null
}

type EventoMetricas = {
  total_vendidas: number
  total_neto_acreditado: number | null
  total_bruto: number | null
  total_usadas: number
  total_canceladas: number
}

interface Props {
  evento: EventoDetalle
  tandas: EventoTanda[]
  categorias: EventoCategoria[]
  fechas: EventoFecha[]
  ventas: EventoVenta[]
  metricas: EventoMetricas
  addons?: EventoAddonRow[]
  permisos?: Permisos
  esEmpleado?: boolean
}

// Badges de estado de venta — tokenizados, vía Badge variant="outline".
const ventaEstadoConfig = {
  valida: {
    label: "Válida",
    class: "border-success/30 bg-success/10 text-success",
  },
  usada: { label: "Usada", class: "border-border bg-muted text-muted-foreground" },
  cancelada: {
    label: "Reembolsada",
    class: "border-destructive/30 bg-destructive/10 text-destructive",
  },
} as const

// Badges de estado de tanda — semánticos y prolijos.
const tandaEstadoConfig: Record<EventoTanda["estado"], { label: string; class: string }> = {
  activa: {
    label: "Activa",
    class: "border-success/30 bg-success/10 text-success",
  },
  proxima: {
    label: "Próxima",
    class: "border-primary/30 bg-primary/10 text-primary",
  },
  agotada: {
    label: "Agotada",
    class: "border-destructive/30 bg-destructive/10 text-destructive",
  },
  inactiva: {
    label: "Inactiva",
    class: "border-border bg-muted text-muted-foreground",
  },
}

function CategoriaEstadoBadge({ activa }: { activa: number }) {
  return (
    <Badge
      variant="outline"
      className={
        activa
          ? "border-success/30 bg-success/10 text-success"
          : "border-border bg-muted text-muted-foreground"
      }
    >
      {activa ? "Activa" : "Pausada"}
    </Badge>
  )
}

function getPublicationReasonCopy(evento: EventoDetalle) {
  switch (evento.publication_reason) {
    case "manual_inactive":
      return "El evento está pausado manualmente. Esto SIEMPRE prevalece sobre cualquier programación."
    case "scheduled_hidden":
      return "Todavía no llegó la publicación y elegiste mantenerlo oculto hasta ese momento."
    case "scheduled_listed":
      return "Ya aparece en el listado público, pero detalle y checkout siguen bloqueados hasta la hora programada."
    case "scheduled_detail_visible":
      return "El detalle ya es visible antes de publicar, pero el checkout sigue bloqueado hasta la hora programada."
    case "live":
    default:
      return evento.publication.mode === "scheduled"
        ? "La publicación programada ya está en vivo y el tenant puede mostrar detalle y checkout."
        : "Se publica de forma inmediata mientras el evento siga operativo."
  }
}

export default function EventoDetalleContent({
  evento,
  tandas,
  categorias,
  fechas,
  ventas,
  metricas,
  addons = [],
  permisos,
  esEmpleado,
}: Props) {
  const { withLoading } = useLoading()
  const router = useRouter()
  const [eventoActivo, setEventoActivo] = useState(evento.activo)
  const [ventaConsumiblesActiva, setVentaConsumiblesActiva] = useState(evento.venta_consumibles_habilitada)
  const [cats, setCats] = useState(categorias)
  const [tandasState, setTandasState] = useState(tandas)
  const [modalStock, setModalStock] = useState<EventoCategoria | null>(null)
  const [modalPrecio, setModalPrecio] = useState<EventoCategoria | null>(null)
  const [stockInput, setStockInput] = useState("")
  const [precioInput, setPrecioInput] = useState("")
  const [confirm, setConfirm] = useState<{
    title: string
    description: string
    confirmLabel: string
    destructive: boolean
    onConfirm: () => void
  } | null>(null)

  const puede = (permiso: keyof Permisos) => puedeHacer(permiso, esEmpleado ?? false, permisos)

  function runConfirm() {
    const fn = confirm?.onConfirm
    setConfirm(null)
    fn?.()
  }

  // Desactivar pausa la operación pública → confirmación. Activar es seguro y aplica directo.
  function handleToggleActivo() {
    if (!eventoActivo) {
      void toggleActivo()
      return
    }
    setConfirm({
      title: "Desactivar evento",
      description:
        "Vas a pausar la operación de este evento. Se bloquean las compras públicas hasta que lo reactives. ¿Confirmás?",
      confirmLabel: "Desactivar",
      destructive: true,
      onConfirm: () => void toggleActivo(),
    })
  }

  // Borrado definitivo, solo posible si el evento no tiene ventas (el backend
  // rechaza si tiene entradas/addons/consumibles/tickets físicos asociados).
  function handleEliminarEvento() {
    setConfirm({
      title: "Borrar evento",
      description:
        "El evento se va a borrar definitivamente, junto con sus fechas, tandas y categorías. Esta acción no se puede deshacer.",
      confirmLabel: "Borrar",
      destructive: true,
      onConfirm: () => void eliminarEvento(),
    })
  }

  async function eliminarEvento() {
    await withLoading(async () => {
      const res = await fetch(`/api/eventos/${evento.id}`, { method: "DELETE" })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        toast.error(data?.error ?? "No se pudo borrar el evento")
        return
      }
      toast.success("Evento borrado")
      router.push("/dashboard/eventos")
      router.refresh()
    })
  }

  // Desactivar la venta pública de consumibles bloquea compras nuevas → confirmación.
  function handleToggleVentaConsumibles() {
    if (!ventaConsumiblesActiva) {
      void toggleVentaConsumibles()
      return
    }
    setConfirm({
      title: "Desactivar venta de consumibles",
      description:
        "Se bloquean las compras nuevas de consumibles en el tenant. El canje operativo se mantiene. ¿Confirmás?",
      confirmLabel: "Desactivar",
      destructive: true,
      onConfirm: () => void toggleVentaConsumibles(),
    })
  }

  // Inactivar una tanda la saca de circulación → confirmación. Activar aplica directo.
  function handleCambiarEstadoTanda(tanda: EventoTanda) {
    if (tanda.estado !== "activa") {
      void cambiarEstadoTanda(tanda.id, "activar")
      return
    }
    setConfirm({
      title: `Inactivar “${tanda.nombre}”`,
      description:
        "La tanda dejará de estar disponible y sus categorías no se podrán comprar mientras esté inactiva. ¿Confirmás?",
      confirmLabel: "Inactivar tanda",
      destructive: true,
      onConfirm: () => void cambiarEstadoTanda(tanda.id, "inactivar"),
    })
  }

  // Pausar una categoría detiene su venta → confirmación. Reactivar aplica directo.
  function handleToggleCategoria(cat: EventoCategoria) {
    if (!cat.activa) {
      void toggleCategoria(cat.id)
      return
    }
    setConfirm({
      title: `Pausar “${cat.nombre}”`,
      description:
        "La categoría dejará de venderse hasta que la reactives. Las entradas ya emitidas no se ven afectadas. ¿Confirmás?",
      confirmLabel: "Pausar categoría",
      destructive: true,
      onConfirm: () => void toggleCategoria(cat.id),
    })
  }

  async function toggleActivo() {
    await withLoading(async () => {
      const res = await fetch(`/api/eventos/${evento.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion: "toggle_activo" }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        toast.error(data?.error ?? "No se pudo actualizar el evento")
        return
      }
      setEventoActivo((prev: number) => (prev ? 0 : 1))
      router.refresh()
    })
  }

  async function toggleCategoria(catId: string) {
    await withLoading(async () => {
      const res = await fetch(`/api/eventos/${evento.id}/categorias/${catId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion: "toggle_activa" }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        toast.error(data?.error ?? "No se pudo actualizar la categoría")
        return
      }
      setCats(cats.map((c) => (c.id === catId ? { ...c, activa: c.activa ? 0 : 1 } : c)))
    })
  }

  async function toggleVentaConsumibles() {
    await withLoading(async () => {
      const res = await fetch(`/api/eventos/${evento.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion: "toggle_venta_consumibles_habilitada" }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => null)
        toast.error(data?.error ?? "No se pudo actualizar la venta pública de consumibles")
        return
      }

      setVentaConsumiblesActiva((prev: number) => (prev ? 0 : 1))
      toast.success(ventaConsumiblesActiva ? "Venta pública de consumibles desactivada" : "Venta pública de consumibles activada")
      router.refresh()
    })
  }

  async function cambiarEstadoTanda(tandaId: string, accion: "activar" | "inactivar") {
    await withLoading(async () => {
      const res = await fetch(`/api/eventos/${evento.id}/tandas/${tandaId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => null)
        toast.error(data?.error ?? "No se pudo actualizar la tanda")
        return
      }

      setTandasState((prev) =>
        prev.map((tanda) => {
          if (accion === "activar") {
            if (tanda.id === tandaId) return { ...tanda, estado: "activa" }
            if (tanda.estado === "agotada") return tanda
            return { ...tanda, estado: "proxima" }
          }

          if (tanda.id === tandaId) return { ...tanda, estado: "inactiva" }
          return tanda
        })
      )

      router.refresh()
    })
  }

  async function agregarStock() {
    const cantidad = Number(stockInput)
    if (!Number.isInteger(cantidad) || cantidad <= 0) {
      toast.error("Ingresá una cantidad entera mayor a 0")
      return
    }
    await withLoading(async () => {
      const res = await fetch(`/api/eventos/${evento.id}/categorias/${modalStock!.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion: "agregar_stock", cantidad }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        toast.error(data?.error ?? "No se pudo agregar stock")
        return
      }
      toast.success("Stock agregado correctamente")
      setCats(
        cats.map((c) =>
          c.id === modalStock!.id
            ? { ...c, stock: c.stock + cantidad, stock_disponible: c.stock_disponible + cantidad }
            : c
        )
      )
      setModalStock(null)
      setStockInput("")
    })
  }

  async function cambiarPrecio() {
    const precio = Number(precioInput)
    if (!precio || precio <= 0) {
      toast.error("Ingresá un precio válido")
      return
    }
    await withLoading(async () => {
      const res = await fetch(`/api/eventos/${evento.id}/categorias/${modalPrecio!.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion: "cambiar_precio", precio }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        toast.error(data?.error ?? "No se pudo actualizar el precio")
        return
      }
      toast.success("Precio actualizado correctamente")
      setCats(cats.map((c) => (c.id === modalPrecio!.id ? { ...c, precio } : c)))
      setModalPrecio(null)
      setPrecioInput("")
    })
  }

  const capacidadTotal = cats.reduce((a, c) => a + c.stock, 0)
  const porcentaje =
    capacidadTotal > 0 ? Math.round((Number(metricas.total_vendidas) / capacidadTotal) * 100) : 0

  const metricasCards = [
    {
      label: "Entradas vendidas",
      value: formatInt(metricas.total_vendidas),
      mono: true,
      icon: Ticket,
      tone: "text-primary",
      surface: "bg-primary/10",
      oculto: false,
    },
    {
      label: "Neto acreditado",
      value: metricas.total_neto_acreditado !== null ? formatMoney(metricas.total_neto_acreditado) : "Monto oculto",
      mono: metricas.total_neto_acreditado !== null,
      icon: TrendingUp,
      tone: "text-success",
      surface: "bg-success/10",
      oculto: !puede("ver_recaudacion"),
      sub: metricas.total_bruto !== null ? `Bruto total: ${formatMoney(metricas.total_bruto)}` : undefined,
    },
    {
      label: "Escaneadas",
      value: formatInt(metricas.total_usadas),
      mono: true,
      icon: CheckCircle2,
      tone: "text-purple-600",
      surface: "bg-purple-500/10",
      oculto: false,
    },
    {
      label: "Reembolsadas",
      value: formatInt(metricas.total_canceladas),
      mono: true,
      icon: XCircle,
      tone: "text-destructive",
      surface: "bg-destructive/10",
      oculto: false,
    },
  ]

  // Hero: consolida título + estado operativo + estado público + nota de programación
  // en un solo bloque visual, en vez de 3 cards separadas repitiendo la misma info.
  const heroImagenUrl = evento.imagen_url ?? null
  const hasHeroImage = Boolean(heroImagenUrl)
  const heroTitleClass = hasHeroImage ? "text-white" : "text-foreground"
  const heroMutedClass = hasHeroImage ? "text-white/75" : "text-muted-foreground"
  const heroNeutralBadgeClass = hasHeroImage
    ? "border-white/25 bg-white/10 text-white backdrop-blur-sm"
    : "border-border bg-muted text-foreground"
  const heroActivoBadgeClass = hasHeroImage
    ? eventoActivo
      ? "border-white/25 bg-white/15 text-white"
      : "border-white/25 bg-black/30 text-white/80"
    : eventoActivo
    ? "border-success/30 bg-success/10 text-success"
    : "border-border bg-muted text-muted-foreground"

  const heroBody = (
    <>
      <h1 className={`text-xl md:text-3xl font-bold tracking-tight truncate ${heroTitleClass}`}>
        {evento.nombre}
      </h1>
      <div className={`mt-1.5 flex flex-wrap items-center gap-3 text-sm ${heroMutedClass}`}>
        {evento.lugar && (
          <span className="inline-flex items-center gap-1">
            <MapPin className="h-3.5 w-3.5" /> {evento.lugar}
          </span>
        )}
        {fechas[0] && (
          <span className="inline-flex items-center gap-1 tabular-nums">
            <CalendarDays className="h-3.5 w-3.5" /> {formatDate(fechas[0].fecha)}
          </span>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${heroActivoBadgeClass}`}>
          {eventoActivo ? "Activo" : "Inactivo manual"}
        </span>
        <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${heroNeutralBadgeClass}`}>
          {getPublicationStatusLabel(evento.publication_status)}
        </span>
        <span className={`rounded-full border px-2.5 py-1 text-xs ${heroNeutralBadgeClass}`}>
          {evento.publication.mode === "scheduled" ? "Programado" : "Inmediato"}
        </span>
      </div>
      <p className={`mt-2 max-w-2xl text-xs ${heroMutedClass}`}>
        {getPublicationReasonCopy(evento)}
        {evento.publication.mode === "scheduled" &&
        evento.publication.publish_date_local &&
        evento.publication.publish_time_local
          ? ` Sale en vivo el ${evento.publication.publish_date_local} a las ${evento.publication.publish_time_local}${
              evento.publication.publish_timezone ? ` (${evento.publication.publish_timezone})` : ""
            }.`
          : ""}
      </p>
    </>
  )

  // Fila compacta de categoría — reemplaza el card-dentro-de-card por una fila de lista,
  // reutilizada en los 3 lugares donde se listan categorías (con tanda, sin tanda, sin tandas).
  function renderCategoriaRow(cat: EventoCategoria) {
    return (
      <div key={cat.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium text-foreground truncate">{cat.nombre}</p>
            <CategoriaEstadoBadge activa={cat.activa} />
          </div>
          {cat.descripcion && (
            <p className="text-xs text-muted-foreground mt-0.5 truncate">{cat.descripcion}</p>
          )}
          <div className="mt-1 flex items-center gap-4 text-xs">
            <span className="font-mono tabular-nums font-semibold text-foreground">
              {cat.precio !== null ? formatMoney(cat.precio) : "Monto oculto"}
            </span>
            <span className="font-mono tabular-nums text-muted-foreground">
              {formatInt(cat.stock_disponible)} / {formatInt(cat.stock)} stock
            </span>
          </div>
        </div>
        <div className="flex gap-1.5 shrink-0">
          {puede("editar_eventos") && (
            <Button
              variant="outline"
              size="icon"
              className="h-9 w-9"
              onClick={() => {
                setModalStock(cat)
                setStockInput("")
              }}
              aria-label={`Agregar stock a ${cat.nombre}`}
            >
              <Plus className="h-4 w-4" />
            </Button>
          )}
          {puede("editar_eventos") && (
            <Button
              variant="outline"
              size="icon"
              className="h-9 w-9"
              onClick={() => {
                setModalPrecio(cat)
                setPrecioInput(cat.precio?.toString() ?? "")
              }}
              aria-label={`Cambiar precio de ${cat.nombre}`}
            >
              <DollarSign className="h-4 w-4" />
            </Button>
          )}
          {puede("activar_eventos") && (
            <Button
              variant="outline"
              size="icon"
              className={`h-9 w-9 ${cat.activa ? "text-amber-700 dark:text-amber-400" : "text-success"}`}
              onClick={() => handleToggleCategoria(cat)}
              aria-label={cat.activa ? `Pausar ${cat.nombre}` : `Activar ${cat.nombre}`}
            >
              {cat.activa ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </Button>
          )}
        </div>
      </div>
    )
  }

  const tandaAccentClass: Record<EventoTanda["estado"], string> = {
    activa: "border-l-success",
    proxima: "border-l-primary",
    agotada: "border-l-destructive",
    inactiva: "border-l-border",
  }

  return (
    <div className="space-y-4 md:space-y-6 pb-8">
      {/* Navegación + acciones */}
      <div className="flex items-center justify-between gap-3">
        <nav aria-label="Navegación" className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
          <Link href="/dashboard/eventos" className="inline-flex shrink-0 items-center gap-1 hover:text-foreground transition-colors">
            <ArrowLeft className="h-3.5 w-3.5" /> Eventos
          </Link>
          <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-50" />
          <span className="truncate">{evento.nombre}</span>
        </nav>

        <div className="flex shrink-0 items-center gap-2">
          {/* Botones desktop */}
          <div className="hidden sm:flex items-center gap-2">
            {puede("editar_eventos") && (
              <Button variant="outline" size="default" className="px-4 h-8" asChild>
                <Link href={`/dashboard/eventos/${evento.id}/editar?from=detail`}>Editar</Link>
              </Button>
            )}
            {puede("activar_eventos") && (
              <Button
                size="default"
                className="px-4 h-8"
                variant={eventoActivo ? "destructive" : "default"}
                onClick={handleToggleActivo}
              >
                {eventoActivo ? "Desactivar" : "Activar"}
              </Button>
            )}
            {puede("eliminar_eventos") && metricas.total_vendidas === 0 && (
              <Button
                size="default"
                variant="outline"
                className="px-4 h-8 text-destructive hover:text-destructive"
                onClick={handleEliminarEvento}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Borrar
              </Button>
            )}
          </div>

          {/* Dropdown mobile */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="sm:hidden h-9 w-9 flex items-center justify-center rounded-xl bg-muted text-muted-foreground hover:text-foreground transition-colors shrink-0">
                <MoreVertical className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {puede("editar_eventos") && (
                <DropdownMenuItem asChild>
                  <Link href={`/dashboard/eventos/${evento.id}/editar?from=detail`}>Editar</Link>
                </DropdownMenuItem>
              )}
              {puede("activar_eventos") && (
                <DropdownMenuItem
                  onClick={handleToggleActivo}
                  className={eventoActivo ? "text-destructive focus:text-destructive" : ""}
                >
                  {eventoActivo ? "Desactivar" : "Activar"}
                </DropdownMenuItem>
              )}
              {puede("eliminar_eventos") && metricas.total_vendidas === 0 && (
                <DropdownMenuItem onClick={handleEliminarEvento} className="text-destructive focus:text-destructive">
                  Borrar
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Hero — imagen del evento + título + estado consolidado (reemplaza 3 cards redundantes) */}
      <div className="relative overflow-hidden rounded-2xl border border-border">
        {hasHeroImage ? (
          <div className="relative h-44 w-full md:h-60">
            <Image src={heroImagenUrl!} alt={evento.nombre} fill className="object-cover" unoptimized />
            <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-black/5" />
            <div className="absolute inset-x-0 bottom-0 p-4 md:p-6">{heroBody}</div>
          </div>
        ) : (
          <div className="bg-gradient-to-br from-primary/10 via-card to-card p-4 md:p-6">{heroBody}</div>
        )}
      </div>

      <Tabs defaultValue="resumen">
        <TabsList>
          <TabsTrigger value="resumen">Resumen</TabsTrigger>
          <TabsTrigger value="productos">Categorías y productos</TabsTrigger>
          <TabsTrigger value="ventas">Ventas ({ventas.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="resumen" className="mt-4 space-y-4 md:space-y-6">
          {/* Métricas */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 md:gap-4">
            {metricasCards
              .filter((m) => !m.oculto)
              .map(({ label, value, mono, icon: Icon, tone, surface, sub }) => (
                <article key={label} className="rounded-card border border-border bg-card p-4 shadow-sm md:p-5">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-2xl ${surface}`}>
                    <Icon className={`h-4 w-4 ${tone}`} />
                  </div>
                  <p className="mt-4 text-xs font-medium text-muted-foreground">{label}</p>
                  <p className={`mt-2 text-xl font-bold tracking-[-0.04em] text-foreground md:text-2xl ${mono ? "font-mono tabular-nums" : ""}`}>
                    {value}
                  </p>
                  {sub ? <p className="mt-2 text-xs leading-6 text-muted-foreground font-mono tabular-nums">{sub}</p> : null}
                </article>
              ))}
          </div>

          {/* Capacidad */}
          <div className="bg-card rounded-2xl border border-border p-4 md:p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-foreground">Capacidad total</p>
              <p className="text-sm text-muted-foreground font-mono tabular-nums">
                {formatInt(metricas.total_vendidas)} / {formatInt(capacidadTotal)} vendidas
              </p>
            </div>
            <div
              className="h-2 w-full bg-muted rounded-full overflow-hidden"
              role="progressbar"
              aria-valuenow={porcentaje}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="h-full bg-primary rounded-full transition-all"
                style={{ width: `${porcentaje}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1.5">
              <span className="font-mono tabular-nums">{porcentaje}%</span> de capacidad vendida
            </p>
          </div>

          {puede("editar_eventos") && (
            <div className="bg-card rounded-2xl border border-border p-4 md:p-5">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-sm font-semibold text-foreground">Venta pública de consumibles</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Si se desactiva, se bloquean compras nuevas en el tenant pero se mantiene el canje operativo.
                  </p>
                </div>
                <label className="flex items-center gap-3 rounded-xl border border-border bg-muted/30 px-3 py-2 text-sm text-foreground cursor-pointer">
                  <Checkbox
                    checked={Boolean(ventaConsumiblesActiva)}
                    onCheckedChange={() => handleToggleVentaConsumibles()}
                  />
                  <span className="font-medium">{ventaConsumiblesActiva ? "Venta habilitada" : "Venta deshabilitada"}</span>
                </label>
              </div>
            </div>
          )}

          {/* Fechas */}
          <div className="bg-card rounded-2xl border border-border p-4 md:p-5">
            <h2 className="font-semibold text-foreground mb-4">Fechas</h2>
            {fechas.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {evento.modo_fecha === "pase"
                  ? "Pase general — sin fechas específicas"
                  : "Sin fechas cargadas"}
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {fechas.map((f, i) => (
                  <div
                    key={f.id}
                    className="flex items-center gap-3 bg-muted/40 rounded-xl px-4 py-3"
                  >
                    <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                      {i + 1}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground tabular-nums">
                        {formatDate(f.fecha)}
                      </p>
                      <p className="text-xs text-muted-foreground tabular-nums">
                        {formatTime(f.fecha)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="productos" className="mt-4 space-y-4 md:space-y-6">
          {/* Tandas / Categorías */}
          <div className="bg-card rounded-2xl border border-border p-4 md:p-5">
            <h2 className="font-semibold text-foreground mb-4">Tandas y categorías</h2>
            <div className="space-y-4">
              {tandasState.length > 0 ? <>
                {tandasState.map((tanda) => {
                const categoriasTanda = cats.filter((cat) => cat.tanda_id === tanda.id)
                return (
                  <div key={tanda.id} className={`border border-l-4 border-border rounded-xl p-4 space-y-3 ${tandaAccentClass[tanda.estado]}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-foreground">{tanda.nombre}</p>
                        {tanda.descripcion && <p className="text-xs text-muted-foreground mt-0.5">{tanda.descripcion}</p>}
                      </div>
                      <Badge
                        variant="outline"
                        className={`shrink-0 ${tandaEstadoConfig[tanda.estado].class}`}
                      >
                        {tandaEstadoConfig[tanda.estado].label}
                      </Badge>
                    </div>

                    {tanda.imagen_url && (
                      <div className="relative h-28 w-full rounded-xl overflow-hidden bg-muted">
                        <Image src={tanda.imagen_url} alt={tanda.nombre} fill className="object-cover" unoptimized />
                      </div>
                    )}

                    {puede("activar_eventos") && tanda.estado !== "agotada" && (
                      <div className="flex gap-2 flex-wrap">
                        {tanda.estado !== "activa" ? (
                          <button
                            onClick={() => handleCambiarEstadoTanda(tanda)}
                            className="flex items-center gap-1.5 h-9 px-3.5 rounded-lg text-xs font-medium bg-success/10 text-success hover:bg-success/20"
                          >
                            <Play className="h-3.5 w-3.5" /> Activar tanda
                          </button>
                        ) : (
                          <button
                            onClick={() => handleCambiarEstadoTanda(tanda)}
                            className="flex items-center gap-1.5 h-9 px-3.5 rounded-lg text-xs font-medium bg-amber-500/10 text-amber-700 dark:text-amber-400 hover:bg-amber-500/20"
                          >
                            <Pause className="h-3.5 w-3.5" /> Inactivar tanda
                          </button>
                        )}
                      </div>
                    )}

                    <div className="divide-y divide-border/60">
                      {categoriasTanda.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-2">Sin categorías asociadas</p>
                      ) : (
                        categoriasTanda.map(renderCategoriaRow)
                      )}
                    </div>
                  </div>
                )
                })}
                {cats.some((cat) => !cat.tanda_id) && (
                  <div className="border border-border rounded-xl p-4 space-y-1">
                    <div>
                      <p className="font-semibold text-foreground">Categorías sin tanda</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Todavía no fueron asociadas a una tanda explícita</p>
                    </div>
                    <div className="divide-y divide-border/60">
                      {cats.filter((cat) => !cat.tanda_id).map(renderCategoriaRow)}
                    </div>
                  </div>
                )}
              </> : (
                <div className="divide-y divide-border/60">
                  {cats.map(renderCategoriaRow)}
                </div>
              )}
            </div>
          </div>

          {/* Adicionales del evento — parking, meet&greet, merch */}
          <EventoAddonsSection eventoId={evento.id} initialAddons={addons} permisos={permisos} esEmpleado={esEmpleado} />
        </TabsContent>

        <TabsContent value="ventas" className="mt-4">
          {/* Últimas ventas */}
          <div className="bg-card rounded-2xl border border-border p-4 md:p-5">
            {ventas.length === 0 ? (
              <div className="text-center py-10">
                <Ticket className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground text-sm">Todavía no hay ventas para este evento</p>
              </div>
            ) : (
              <>
                <div className="hidden sm:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left pb-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                          Comprador
                        </th>
                        <th className="text-left pb-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                          Categoría
                        </th>
                        {puede("ver_recaudacion") && (
                          <th className="text-right pb-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                            Neto acreditado
                          </th>
                        )}
                        <th className="text-left pb-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                          Estado
                        </th>
                        <th className="text-left pb-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                          Fecha
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {ventas.map((v) => {
                        const estado = ventaEstadoConfig[v.estado as keyof typeof ventaEstadoConfig]
                        return (
                          <tr key={v.id}>
                            <td className="py-3">
                              <p className="font-medium text-foreground">{v.comprador_nombre}</p>
                              <p className="text-xs text-muted-foreground">{v.comprador_email ?? "Email oculto"}</p>
                            </td>
                            <td className="py-3 text-muted-foreground">{v.categoria_nombre}</td>
                            {puede("ver_recaudacion") && (
                              <td className="py-3 text-right font-medium text-foreground font-mono tabular-nums">
                                {v.neto_empresa_amount !== null && v.neto_empresa_amount !== undefined ? formatMoney(v.neto_empresa_amount) : "Monto oculto"}
                              </td>
                            )}
                            <td className="py-3">
                              <Badge
                                variant="outline"
                                className={estado.class}
                              >
                                {estado.label}
                              </Badge>
                            </td>
                            <td className="py-3 text-muted-foreground text-xs tabular-nums">
                              {formatDate(v.created_at)}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="sm:hidden space-y-3">
                  {ventas.map((v) => {
                    const estado = ventaEstadoConfig[v.estado as keyof typeof ventaEstadoConfig]
                    return (
                      <div key={v.id} className="flex items-start gap-3">
                        <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-bold shrink-0">
                          {v.comprador_nombre?.[0]?.toUpperCase() ?? "?"}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">
                            {v.comprador_nombre}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">{v.categoria_nombre}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge variant="outline" className={estado.class}>
                              {estado.label}
                            </Badge>
                            <span className="text-xs text-muted-foreground tabular-nums">
                              {formatDate(v.created_at)}
                            </span>
                          </div>
                        </div>
                        {puede("ver_recaudacion") && (
                          <p className="text-sm font-bold text-foreground shrink-0 font-mono tabular-nums">
                            {v.neto_empresa_amount !== null && v.neto_empresa_amount !== undefined ? formatMoney(v.neto_empresa_amount) : "Monto oculto"}
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* Modal stock */}
      <Dialog
        open={!!modalStock}
        onOpenChange={() => {
          setModalStock(null)
        }}
      >
        <DialogContent className="bg-card sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-foreground">
              Agregar stock — {modalStock?.nombre}
            </DialogTitle>
            <DialogDescription className="sr-only">Ingresá la cantidad de stock a agregar para esta categoría.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">
                Stock actual: <span className="font-mono tabular-nums">{formatInt(modalStock?.stock_disponible)} / {formatInt(modalStock?.stock)}</span>
              </p>
              <Input
                className="h-10"
                type="number"
                min="1"
                placeholder="Cantidad a agregar"
                value={stockInput}
                onChange={(e) => setStockInput(e.target.value)}
                autoFocus
              />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 h-10" onClick={() => setModalStock(null)}>
                Cancelar
              </Button>
              <Button className="flex-1 h-10" onClick={agregarStock}>
                Agregar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal precio */}
      <Dialog
        open={!!modalPrecio}
        onOpenChange={() => {
          setModalPrecio(null)
        }}
      >
        <DialogContent className="bg-card sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-foreground">
              Cambiar precio — {modalPrecio?.nombre}
            </DialogTitle>
            <DialogDescription className="sr-only">Ingresá el nuevo precio para esta categoría de entrada.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">
                Precio actual: <span className="font-mono tabular-nums">{modalPrecio?.precio !== null && modalPrecio?.precio !== undefined ? formatMoney(modalPrecio.precio) : "Monto oculto"}</span>
              </p>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                  $
                </span>
                <Input
                  className="h-10 pl-7"
                  type="number"
                  min="0"
                  placeholder="Nuevo precio"
                  value={precioInput}
                  onChange={(e) => setPrecioInput(e.target.value)}
                  autoFocus
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1 h-10"
                onClick={() => setModalPrecio(null)}
              >
                Cancelar
              </Button>
              <Button className="flex-1 h-10" onClick={cambiarPrecio}>
                Guardar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirmación de acciones destructivas/sensibles (Dialog shadcn, nunca window.confirm) */}
      <Dialog open={!!confirm} onOpenChange={(open) => { if (!open) setConfirm(null) }}>
        <DialogContent className="bg-card sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-foreground">{confirm?.title}</DialogTitle>
            <DialogDescription>{confirm?.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" className="flex-1 h-10" onClick={() => setConfirm(null)}>
              Cancelar
            </Button>
            <Button
              variant={confirm?.destructive ? "destructive" : "default"}
              className="flex-1 h-10"
              onClick={runConfirm}
            >
              {confirm?.confirmLabel ?? "Confirmar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
