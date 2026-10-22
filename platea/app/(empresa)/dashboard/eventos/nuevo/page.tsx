// app/(empresa)/dashboard/eventos/nuevo/page.tsx
import { auth } from "@/auth"
import { redirect } from "next/navigation"
import EventoFormContent from "@/components/dashboard/evento-form-content"
import type { Permisos } from "@/lib/permisos"

export default async function NuevoEventoPage() {
  const session = await auth()
  if (!session) redirect("/login")

  const permisos = session.user.permisos as Permisos | undefined
  const esEmpleado = session.user.userType === "empleado"

  if (esEmpleado && !permisos?.crear_eventos) redirect("/sin-acceso")

  return <EventoFormContent modo="crear" />
}
