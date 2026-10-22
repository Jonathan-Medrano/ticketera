// app/(empresa)/dashboard/eventos/[id]/editar/page.tsx
import { auth } from "@/auth"
import { redirect, notFound } from "next/navigation"
import EventoFormContent from "@/components/dashboard/evento-form-content"
import type { Permisos } from "@/lib/permisos"
import { fetchBackendFromServer } from "@/lib/server-backend"

type EventoEditarResponse = {
  evento: {
    id: string
    nombre: string
    descripcion?: string | null
    lugar?: string | null
    ciudad?: string | null
    modo_fecha: "unica" | "multiple" | "pase"
    imagen_url?: string | null
    venta_consumibles_habilitada?: number | boolean
    buyer_event_refunds_enabled?: number | boolean
    publication?: {
      mode: "immediate" | "scheduled"
      pre_publish_visibility: "hidden" | "listado_solo" | "detail_visible"
      publish_at_utc: string | null
      publish_timezone: string | null
      publish_date_local?: string
      publish_time_local?: string
    }
    publication_status?: "hidden" | "listed" | "live"
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
    tanda_id?: string | null
  }>
  fechas: Array<{
    id: string
    fecha: string
  }>
}

export default async function EditarEventoPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ from?: string }>
}) {
  const session = await auth()
  if (!session) redirect("/login")

  const permisos = session.user.permisos as Permisos | undefined
  const esEmpleado = session.user.userType === "empleado"

  if (esEmpleado && !permisos?.editar_eventos) redirect("/sin-acceso")

  const { id } = await params
  const { from } = await searchParams
  const detalle = await fetchBackendFromServer<EventoEditarResponse>(`/api/eventos/${id}`)

  if (!detalle.evento) notFound()

  const returnHref = from === "detail" ? `/dashboard/eventos/${id}` : "/dashboard/eventos"

  return (
    <EventoFormContent
      modo="editar"
      evento={detalle.evento}
      tandasIniciales={detalle.tandas}
      categoriasIniciales={detalle.categorias}
      fechasIniciales={detalle.fechas}
      returnHref={returnHref}
    />
  )
}
