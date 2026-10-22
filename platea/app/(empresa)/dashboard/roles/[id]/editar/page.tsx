import { auth } from "@/auth"
import { redirect } from "next/navigation"
import RolFormContent from "@/components/dashboard/rol-form-content"
import type { Permisos } from "@/lib/permisos"
import { fetchBackendFromServer } from "@/lib/server-backend"

type RoleEditResponse = {
  id: string
  nombre: string
  permisos: string
}

export default async function EditarRolPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session) redirect("/login")

  const permisos = session.user.permisos as Permisos | undefined
  const esEmpleado = session.user.userType === "empleado"

  if (esEmpleado && !permisos?.editar_roles) redirect("/sin-acceso")

  const { id } = await params
  const rol = await fetchBackendFromServer<RoleEditResponse>(`/api/roles/${id}`)

  return (
    <RolFormContent modo="editar" rol={rol} />
  )
}
