// app/(empresa)/dashboard/equipo/page.tsx
import { auth } from "@/auth"
import { redirect } from "next/navigation"
import EquipoContent from "@/components/dashboard/equipo-content"
import type { Permisos } from "@/lib/permisos"
import { fetchBackendFromServer } from "@/lib/server-backend"

type EquipoResponse = {
  data: {
    roles: Array<{
      slug: string
      nombre: string
      es_predefinido: number
    }>
    usuarios: Array<{
      id: string
      nombre: string
      apellido?: string | null
      email: string
      rol: string
      activo: number
      porcentaje_comision?: number | null
      created_at: string
      permisos?: string | null
    }>
    stats: Array<{
      id: string
      total_ventas: number
      total_generado: number
    }>
  }
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

export default async function EquipoPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; pageSize?: string; busqueda?: string; sortBy?: string; sortDir?: string }>
}) {
  const session = await auth()
  if (!session) redirect("/login")

  const permisos = session.user.permisos as Permisos | undefined
  const esEmpleado = session.user.userType === "empleado"

  if (esEmpleado && !permisos?.ver_equipo) redirect("/sin-acceso")

  const params = await searchParams
  const qs = new URLSearchParams()
  if (params.page) qs.set("page", params.page)
  if (params.pageSize) qs.set("pageSize", params.pageSize)
  if (params.busqueda) qs.set("busqueda", params.busqueda)
  if (params.sortBy) qs.set("sortBy", params.sortBy)
  if (params.sortDir) qs.set("sortDir", params.sortDir)

  const response = await fetchBackendFromServer<EquipoResponse>(
    `/api/equipo${qs.toString() ? `?${qs.toString()}` : ""}`
  )

  return (
    <EquipoContent
      usuarios={response.data.usuarios}
      stats={response.data.stats}
      pagination={response.pagination}
      permisos={permisos}
      esEmpleado={esEmpleado}
      roles={response.data.roles}
    />
  )
}
