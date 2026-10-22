import { auth } from "@/auth"
import { redirect } from "next/navigation"
import type { Permisos } from "@/lib/permisos"
import { fetchBackendFromServer } from "@/lib/server-backend"
import PromocionesContent from "@/components/dashboard/marketing/promociones-content"

type PromocionesResponse = {
  data: {
    codigos: Array<{
      id: number
      codigo: string
      tipo: "porcentaje" | "monto_fijo"
      valor: number
      aplica_a: "todos" | "entradas" | "consumibles"
      usos_maximos: number | null
      usos_actuales: number
      monto_minimo: number | null
      valido_desde: string | null
      valido_hasta: string | null
      evento_id: number | null
      evento_nombre: string | null
      activo: number
      created_at: string
    }>
    totals: { total: number }
  }
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

type StatsResponse = {
  data: {
    total: number
    activos: number
    usos_totales: number
    con_limite: number
  }
}

type EventosResponse = {
  data: Array<{ id: string; nombre: string }>
}

export default async function PromocionesPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string
    pageSize?: string
    busqueda?: string
    estado?: string
  }>
}) {
  const session = await auth()
  if (!session) redirect("/login")

  const permisos = session.user.permisos as Permisos | undefined
  const esEmpleado = session.user.userType === "empleado"

  if (esEmpleado && !permisos?.ver_marketing) redirect("/sin-acceso")

  const params = await searchParams
  const qs = new URLSearchParams()
  if (params.page) qs.set("page", params.page)
  if (params.pageSize) qs.set("pageSize", params.pageSize)
  if (params.busqueda) qs.set("busqueda", params.busqueda)
  if (params.estado) qs.set("estado", params.estado)

  const [response, eventosResponse] = await Promise.all([
    fetchBackendFromServer<PromocionesResponse>(
      `/api/marketing/promociones${qs.toString() ? `?${qs.toString()}` : ""}`
    ),
    fetchBackendFromServer<EventosResponse>("/api/eventos?basic=1&solo_activos=1").catch(() => ({ data: [] })),
  ])

  const statsDefault = { total: 0, activos: 0, usos_totales: 0, con_limite: 0 }
  const [statsResult] = await Promise.allSettled([
    fetchBackendFromServer<StatsResponse>("/api/marketing/promociones/stats"),
  ])
  const stats =
    statsResult.status === "fulfilled" ? statsResult.value.data : statsDefault

  return (
    <PromocionesContent
      codigos={response.data.codigos}
      eventos={eventosResponse.data ?? []}
      pagination={response.pagination}
      stats={stats}
      permisos={permisos}
      esEmpleado={esEmpleado}
    />
  )
}
