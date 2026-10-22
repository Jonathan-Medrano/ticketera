import { auth } from "@/auth"
import { redirect } from "next/navigation"
import EventosContent from "@/components/dashboard/eventos-content"
import type { Permisos } from "@/lib/permisos"
import { fetchBackendFromServer } from "@/lib/server-backend"

type EventosListResponse = {
  data: Array<{
    id: string
    nombre: string
    imagen_url: string | null
    modo_fecha: "unica" | "multiple" | "pase"
    activo: number
    cantidad_fechas: number
    cantidad_categorias: number
    entradas_vendidas: number
    capacidad_total: number
    ingresos_bruto: number | null
    ingresos_neto: number | null
    ticket_promedio_bruto: number | null
    ticket_promedio_neto: number | null
    ventas_7d: number | null
    proxima_fecha: string | null
    publication_status: "hidden" | "listed" | "live"
    publication_reason: "manual_inactive" | "scheduled_hidden" | "scheduled_listed" | "scheduled_detail_visible" | "live"
  }>
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

type PerformerIngresosCard = {
  id: string
  nombre: string
  imagen_url: string | null
  ingresos_neto: number
} | null

type PerformerOcupacionCard = {
  id: string
  nombre: string
  imagen_url: string | null
  ocupacion_pct: number
} | null

type EventosSummaryResponse = {
  data: {
    totales: {
      eventos_count: number
      eventos_activos: number
      total_bruto: number
      total_neto: number
      total_vendidas: number
      total_capacidad: number
      ocupacion_promedio: number | null
      ticket_promedio_bruto: number | null
      ticket_promedio_neto: number | null
    }
    performers: {
      top_por_ingresos: PerformerIngresosCard
      bottom_por_ingresos: PerformerIngresosCard
      top_por_ocupacion: PerformerOcupacionCard
      bottom_por_ocupacion: PerformerOcupacionCard
    }
  }
}

export default async function EventosPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; pageSize?: string; busqueda?: string; sortBy?: string; sortDir?: string; publication_status?: string }>
}) {
  const session = await auth()
  if (!session) redirect("/login")

  const permisos = session.user.permisos as Permisos | undefined
  const esEmpleado = session.user.userType === "empleado"

  if (esEmpleado && !permisos?.ver_eventos) redirect("/sin-acceso")

  const params = await searchParams
  const qs = new URLSearchParams()
  if (params.page) qs.set("page", params.page)
  if (params.pageSize) qs.set("pageSize", params.pageSize)
  if (params.busqueda) qs.set("busqueda", params.busqueda)
  if (params.sortBy) qs.set("sortBy", params.sortBy)
  if (params.sortDir) qs.set("sortDir", params.sortDir)
  if (params.publication_status) qs.set("publication_status", params.publication_status)

  const puedeVerRecaudacion = !esEmpleado || permisos?.ver_recaudacion

  const [eventos, summaryRes] = await Promise.all([
    fetchBackendFromServer<EventosListResponse>(
      `/api/eventos${qs.toString() ? `?${qs.toString()}` : ""}`
    ),
    puedeVerRecaudacion
      ? fetchBackendFromServer<EventosSummaryResponse>(
          `/api/eventos/summary${qs.toString() ? `?${qs.toString()}` : ""}`
        ).catch(() => null)
      : Promise.resolve(null),
  ])

  return (
    <EventosContent
      eventos={eventos.data}
      pagination={eventos.pagination}
      summary={summaryRes?.data ?? null}
      permisos={permisos}
      esEmpleado={esEmpleado}
    />
  )
}
