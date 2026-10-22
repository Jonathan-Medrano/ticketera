// app/(empresa)/dashboard/eventos/[id]/page.tsx
import { auth } from "@/auth"
import { redirect, notFound } from "next/navigation"
import EventoDetalleContent from "@/components/dashboard/evento-detalle-content"
import type { Permisos } from "@/lib/permisos"
import { fetchBackendFromServer } from "@/lib/server-backend"

type EventoDetalleResponse = {
  evento: {
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
  tandas: Array<{
    id: string
    nombre: string
    descripcion?: string | null
    imagen_url?: string | null
    estado: "activa" | "proxima" | "inactiva" | "agotada"
    orden: number
    activa_desde?: string | null
  }>
  categorias: Array<{
    id: string
    nombre: string
    descripcion?: string | null
    precio: number
    stock: number
    stock_disponible: number
    activa: number
    tanda_id?: string | null
  }>
  fechas: Array<{
    id: string
    fecha: string
  }>
  ventas: Array<{
    id: string
    precio_pagado: number | null
    neto_empresa_amount?: number | null
    estado: "valida" | "usada" | "cancelada"
    created_at: string
    comprador_nombre: string
    comprador_email: string | null
    categoria_nombre: string | null
  }>
  metricas: {
    total_vendidas: number
    total_neto_acreditado: number | null
    total_bruto: number | null
    total_usadas: number
    total_canceladas: number
  }
}

type AddonRow = {
  id: string
  nombre: string
  descripcion: string | null
  precio: number
  stock: number
  stock_disponible: number
  max_por_compra: number
  activo: boolean
  orden_visual: number
}

export default async function EventoDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session) redirect("/login")

  const permisos = session.user.permisos as Permisos | undefined
  const esEmpleado = session.user.userType === "empleado"

  if (esEmpleado && !permisos?.ver_eventos) redirect("/sin-acceso")

  const { id } = await params

  // Trae detalle + addons en paralelo (independientes) — ahorra un round-trip vs el patrón
  // anterior donde EventoAddonsSection fetcheaba al mount desde el cliente.
  const [detalle, addonsResponse] = await Promise.all([
    fetchBackendFromServer<EventoDetalleResponse>(`/api/eventos/${id}`),
    fetchBackendFromServer<{ data: { addons: AddonRow[] } }>(
      `/api/dashboard/addons?evento_id=${id}`
    ).catch(() => ({ data: { addons: [] as AddonRow[] } })),
  ])

  if (!detalle.evento) notFound()

  return (
    <EventoDetalleContent
      evento={detalle.evento}
      tandas={detalle.tandas}
      categorias={detalle.categorias}
      fechas={detalle.fechas}
      ventas={detalle.ventas}
      metricas={detalle.metricas}
      addons={addonsResponse.data.addons}
      permisos={permisos}
      esEmpleado={esEmpleado}
    />
  )
}
