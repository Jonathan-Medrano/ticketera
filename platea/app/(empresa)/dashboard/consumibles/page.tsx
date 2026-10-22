import { auth } from "@/auth"
import { redirect } from "next/navigation"
import ConsumiblesContent from "@/components/dashboard/consumibles-content"
import type { Permisos } from "@/lib/permisos"
import { fetchBackendFromServer } from "@/lib/server-backend"

type ConsumiblesResponse = {
  data: Array<{
    id: string
    nombre: string
    descripcion?: string | null
    precio: number
    imagen_url?: string | null
    activo: number
  }>
  pagination?: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

export default async function ConsumiblesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; pageSize?: string; busqueda?: string; estado?: string; sortBy?: string; sortDir?: string }>
}) {
  const session = await auth()
  if (!session) redirect("/login")

  const permisos = session.user.permisos as Permisos | undefined
  const esEmpleado = session.user.userType === "empleado"

  if (esEmpleado && !permisos?.ver_consumibles) redirect("/sin-acceso")

  const params = await searchParams
  const qs = new URLSearchParams()
  qs.set("incluir_inactivos", "1")
  if (params.page) qs.set("page", params.page)
  if (params.pageSize) qs.set("pageSize", params.pageSize)
  if (params.busqueda) qs.set("busqueda", params.busqueda)
  if (params.estado) qs.set("estado", params.estado)
  if (params.sortBy) qs.set("sortBy", params.sortBy)
  if (params.sortDir) qs.set("sortDir", params.sortDir)

  const consumibles = await fetchBackendFromServer<ConsumiblesResponse>(
    `/api/consumibles?${qs.toString()}`
  )

  return (
    <ConsumiblesContent
      consumibles={consumibles.data}
      pagination={consumibles.pagination ?? { page: 1, pageSize: consumibles.data.length || 25, total: consumibles.data.length, totalPages: 1 }}
      permisos={permisos}
      esEmpleado={esEmpleado}
    />
  )
}
