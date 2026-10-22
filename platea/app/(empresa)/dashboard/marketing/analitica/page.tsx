import { auth } from "@/auth"
import { redirect } from "next/navigation"
import type { Permisos } from "@/lib/permisos"
import { fetchBackendFromServer } from "@/lib/server-backend"
import AnaliticaContent from "@/components/dashboard/marketing/analitica-content"

export default async function AnaliticaPage() {
  const session = await auth()
  if (!session) redirect("/login")

  const permisos = session.user.permisos as Permisos | undefined
  const esEmpleado = session.user.userType === "empleado"

  if (esEmpleado && !permisos?.ver_marketing) redirect("/sin-acceso")

  const trackingRes = await fetchBackendFromServer<{
    data: {
      ga4_measurement_id: string | null
      meta_pixel_id: string | null
      gtm_container_id: string | null
    }
  }>("/api/marketing/analitica/tracking").catch(() => null)

  const initialTracking = trackingRes?.data ?? {
    ga4_measurement_id: null,
    meta_pixel_id: null,
    gtm_container_id: null,
  }

  return <AnaliticaContent initialTracking={initialTracking} />
}
