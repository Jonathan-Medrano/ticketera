import { auth } from "@/auth"
import { redirect } from "next/navigation"
import RolFormContent from "@/components/dashboard/rol-form-content"
import type { Permisos } from "@/lib/permisos"

export default async function NuevoRolPage() {
  const session = await auth()
  if (!session) redirect("/login")

  const permisos = session.user.permisos as Permisos | undefined
  const esEmpleado = session.user.userType === "empleado"

  if (esEmpleado && !permisos?.crear_roles) redirect("/sin-acceso")

  return <RolFormContent modo="crear" />
}
