import { auth } from "@/auth"
import { redirect } from "next/navigation"
import ConsumiblesPromocionesContent from "@/components/dashboard/consumibles-promociones-content"
import type { Permisos } from "@/lib/permisos"
import { fetchBackendFromServer } from "@/lib/server-backend"

type PromocionesResponse = {
  data: {
    promociones: Array<{
      id: string
      nombre: string
      descripcion?: string | null
      tipo: "porcentaje" | "monto_fijo" | "precio_especial"
      valor: number
      consumible_ids: string[] | string
      cantidad_minima: number
      evento_id?: string | null
      activa: number | boolean
      fecha_inicio?: string | null
      fecha_fin?: string | null
    }>
  }
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

type ConsumiblesActivosResponse = {
  data: Array<{
    id: string
    nombre: string
  }>
}

type EventosBasicosResponse = {
  data: Array<{
    id: string
    nombre: string
  }>
}

export default async function ConsumiblesPromocionesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; pageSize?: string; busqueda?: string; evento_id?: string; activa?: string; sortBy?: string; sortDir?: string }>
}) {
  const session = await auth()
  if (!session) redirect("/login")

  const permisos = session.user.permisos as Permisos | undefined
  const esEmpleado = session.user.userType === "empleado"

  if (esEmpleado && !permisos?.ver_consumibles) redirect("/sin-acceso")

  const params = await searchParams
  const qs = new URLSearchParams()
  if (params.page) qs.set("page", params.page)
  if (params.pageSize) qs.set("pageSize", params.pageSize)
  if (params.busqueda) qs.set("busqueda", params.busqueda)
  if (params.evento_id) qs.set("evento_id", params.evento_id)
  if (params.activa) qs.set("activa", params.activa)
  if (params.sortBy) qs.set("sortBy", params.sortBy)
  if (params.sortDir) qs.set("sortDir", params.sortDir)

  const [promociones, consumibles, eventos] = await Promise.all([
    fetchBackendFromServer<PromocionesResponse>(
      `/api/consumibles/promociones${qs.toString() ? `?${qs.toString()}` : ""}`
    ),
    fetchBackendFromServer<ConsumiblesActivosResponse>("/api/consumibles"),
    fetchBackendFromServer<EventosBasicosResponse>("/api/eventos?basic=1&solo_activos=1"),
  ])

  return (
    <ConsumiblesPromocionesContent
      promociones={promociones.data.promociones}
      pagination={promociones.pagination}
      consumibles={consumibles.data}
      eventos={eventos.data}
      permisos={permisos}
      esEmpleado={esEmpleado}
    />
  )
}
