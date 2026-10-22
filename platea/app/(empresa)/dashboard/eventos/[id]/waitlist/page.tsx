import { auth } from "@/auth"
import { redirect } from "next/navigation"
import type { Permisos } from "@/lib/permisos"
import { fetchBackendFromServer } from "@/lib/server-backend"
import WaitlistAdminSection from "@/components/dashboard/waitlist-admin-section"

type EventoResponse = { evento: { id: string; nombre: string } | null }

export default async function WaitlistAdminPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session) redirect("/login")

  const permisos = session.user.permisos as Permisos | undefined
  const esEmpleado = session.user.userType === "empleado"
  if (esEmpleado && !permisos?.ver_eventos) redirect("/sin-acceso")

  const { id } = await params
  const detalle = await fetchBackendFromServer<EventoResponse>(`/api/eventos/${id}`)

  return (
    <WaitlistAdminSection
      eventoId={id}
      eventoNombre={detalle.evento?.nombre ?? "Evento"}
    />
  )
}
