import { auth } from "@/auth"
import { redirect } from "next/navigation"
import RolDetalleContent from "@/components/dashboard/rol-detalle-content"
import type { Permisos } from "@/lib/permisos"
import { fetchBackendFromServer } from "@/lib/server-backend"

type RoleDetailResponse = {
  id: string
  nombre: string
  slug: string
  es_predefinido: number
  permisos: string
  usuarios: Array<{
    id: string
    nombre: string
    apellido?: string | null
    email: string
    activo: number
  }>
}

export default async function RolDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session) redirect("/login")

  const permisos = session.user.permisos as Permisos | undefined
  const esEmpleado = session.user.userType === "empleado"

  if (esEmpleado && !permisos?.ver_roles) redirect("/sin-acceso")

  const { id } = await params
  const rol = await fetchBackendFromServer<RoleDetailResponse>(`/api/roles/${id}`)

  return (
    <RolDetalleContent rol={rol} permisos={permisos} esEmpleado={esEmpleado} />
  )
}
