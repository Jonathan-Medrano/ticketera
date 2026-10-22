import { auth } from "@/auth"
import { redirect } from "next/navigation"
import RevendedoresContent from "@/components/dashboard/revendedores-content"
import type { Permisos } from "@/lib/permisos"
import { fetchBackendFromServer } from "@/lib/server-backend"

type RevendedoresResponse = {
  data: {
    revendedores: Array<{
      id: string
      nombre: string
      apellido?: string | null
      email: string
      activo: number
      porcentaje_comision?: number | null
      created_at: string
      total_ventas: number
      total_generado: number
      total_comision: number
    }>
    comision_default: number
    eventos: Array<{
      id: string
      nombre: string
      total_ventas: number
    }>
    stats: {
      totalRevendedores: number
      totalActivos: number
      totalInactivos: number
      totalGenerado: number
      totalComision: number
    }
  }
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

export default async function RevendedoresPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string
    pageSize?: string
    busqueda?: string
    evento?: string
    desde?: string
    hasta?: string
    estado?: string
    mostrarInactivos?: string
    sortBy?: string
    sortDir?: string
  }>
}) {
  const session = await auth()
  if (!session) redirect("/login")

  const permisos = session.user.permisos as Permisos | undefined
  const esEmpleado = session.user.userType === "empleado"

  if (esEmpleado && !permisos?.gestionar_revendedores) redirect("/sin-acceso")

  const params = await searchParams
  const qs = new URLSearchParams()
  if (params.page) qs.set("page", params.page)
  if (params.pageSize) qs.set("pageSize", params.pageSize)
  if (params.busqueda) qs.set("busqueda", params.busqueda)
  if (params.evento) qs.set("evento", params.evento)
  if (params.desde) qs.set("desde", params.desde)
  if (params.hasta) qs.set("hasta", params.hasta)
  if (params.estado) qs.set("estado", params.estado)
  if (params.mostrarInactivos) qs.set("mostrarInactivos", params.mostrarInactivos)
  if (params.sortBy) qs.set("sortBy", params.sortBy)
  if (params.sortDir) qs.set("sortDir", params.sortDir)

  const response = await fetchBackendFromServer<RevendedoresResponse>(
    `/api/revendedores${qs.toString() ? `?${qs.toString()}` : ""}`
  )

  return (
    <RevendedoresContent
      revendedores={response.data.revendedores}
      comisionDefault={response.data.comision_default}
      eventos={response.data.eventos ?? []}
      stats={response.data.stats}
      pagination={response.pagination}
      exportPath={`/api/revendedores/export${qs.toString() ? `?${qs.toString()}` : ""}`}
      permisos={permisos}
      esEmpleado={esEmpleado}
    />
  )
}
