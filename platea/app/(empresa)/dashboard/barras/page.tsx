import { auth } from "@/auth"
import { redirect } from "next/navigation"
import ConsumiblesBarrasContent from "@/components/dashboard/consumibles-barras-content"
import type { Permisos } from "@/lib/permisos"
import { fetchBackendFromServer } from "@/lib/server-backend"

type EventosBasicosResponse = {
  data: Array<{
    id: string
    nombre: string
  }>
}

export default async function BarrasPage() {
  const session = await auth()
  if (!session) redirect("/login")

  const permisos = session.user.permisos as Permisos | undefined
  const esEmpleado = session.user.userType === "empleado"

  if (esEmpleado && !permisos?.ver_consumibles) redirect("/sin-acceso")

  const eventos = await fetchBackendFromServer<EventosBasicosResponse>(
    "/api/eventos?basic=1&solo_activos=1"
  )

  return <ConsumiblesBarrasContent eventos={eventos.data} permisos={permisos} esEmpleado={esEmpleado} />
}
