import { auth } from "@/auth"
import { redirect } from "next/navigation"
import ConsumiblesVenderContent from "@/components/dashboard/consumibles-vender-content"
import type { Permisos } from "@/lib/permisos"
import { fetchBackendFromServer } from "@/lib/server-backend"

type EventosBasicosResponse = {
  data: Array<{
    id: string
    nombre: string
  }>
}

// El backend devuelve la lista anidada bajo `data` ({ data: { promociones }, pagination }).
// Leerla como `promociones.promociones` (shape plano) dejaba la prop en undefined y
// reventaba el POS al renderizar el paso 2 (promociones.length sobre undefined).
type PromocionesActivasResponse = {
  data: {
    promociones: Array<{
      id: string
      nombre: string
    }>
  }
}

export default async function ConsumiblesVenderPage() {
  const session = await auth()
  if (!session) redirect("/login")

  const permisos = session.user.permisos as Permisos | undefined
  const esEmpleado = session.user.userType === "empleado"

  if (esEmpleado && !permisos?.vender_consumibles) redirect("/sin-acceso")

  const [eventos, promociones] = await Promise.all([
    fetchBackendFromServer<EventosBasicosResponse>("/api/eventos?basic=1&solo_activos=1"),
    fetchBackendFromServer<PromocionesActivasResponse>("/api/consumibles/promociones?activa=1"),
  ])

  return (
    <ConsumiblesVenderContent
      eventos={eventos.data ?? []}
      promociones={promociones.data?.promociones ?? []}
      permisos={permisos}
      esEmpleado={esEmpleado}
    />
  )
}
