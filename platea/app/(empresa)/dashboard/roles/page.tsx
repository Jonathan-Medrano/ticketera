import { auth } from "@/auth"
import { redirect } from "next/navigation"
import RolesContent from "@/components/dashboard/roles-content"
import type { Permisos } from "@/lib/permisos"
import { fetchBackendFromServer } from "@/lib/server-backend"

type RolesListResponse = {
  data: Array<{
    id: string
    nombre: string
    slug: string
    es_predefinido: number
    cantidad_usuarios: number
    cantidad_permisos: number
  }>
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

export default async function RolesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; pageSize?: string; busqueda?: string; sortBy?: string; sortDir?: string }>
}) {
  const session = await auth()
  if (!session) redirect("/login")

  const permisos = session.user.permisos as Permisos | undefined
  const esEmpleado = session.user.userType === "empleado"

  if (esEmpleado && !permisos?.ver_roles) redirect("/sin-acceso")

  const params = await searchParams
  const qs = new URLSearchParams()
  if (params.page) qs.set("page", params.page)
  if (params.pageSize) qs.set("pageSize", params.pageSize)
  if (params.busqueda) qs.set("busqueda", params.busqueda)
  if (params.sortBy) qs.set("sortBy", params.sortBy)
  if (params.sortDir) qs.set("sortDir", params.sortDir)

  const roles = await fetchBackendFromServer<RolesListResponse>(`/api/roles${qs.toString() ? `?${qs.toString()}` : ""}`)

  return <RolesContent roles={roles.data} pagination={roles.pagination} permisos={permisos} esEmpleado={esEmpleado} />
}
