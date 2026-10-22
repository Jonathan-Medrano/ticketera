// app/(empresa)/dashboard/escanear/page.tsx
import { auth } from "@/auth"
import { redirect } from "next/navigation"
import EscanearContent from "@/components/dashboard/escanear-content"
import type { Permisos } from "@/lib/permisos"
import { fetchBackendFromServer } from "@/lib/server-backend"

type EventosBasicosResponse = {
  data: Array<{
    id: string
    nombre: string
  }>
}

export default async function EscanearPage() {
  const session = await auth()
  if (!session) redirect("/login")

  const permisos = session.user.permisos as Permisos | undefined
  const esEmpleado = session.user.userType === "empleado"

  const canScanEntries = !esEmpleado || Boolean(permisos?.escanear)
  const canRedeemConsumibles = !esEmpleado || Boolean(permisos?.canjear_consumibles)

  if (!canScanEntries && !canRedeemConsumibles) redirect("/sin-acceso")

  const eventos = await fetchBackendFromServer<EventosBasicosResponse>(
    "/api/eventos?basic=1&solo_activos=1"
  )

  return <EscanearContent eventos={eventos.data} canScanEntries={canScanEntries} canRedeemConsumibles={canRedeemConsumibles} />
}
