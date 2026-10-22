import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { fetchBackendFromServer } from "@/lib/server-backend"
import MarketingOverview from "@/components/dashboard/marketing/marketing-overview"
import type { Permisos } from "@/lib/permisos"

interface PromocionesStats {
  data: { activos: number }
}

interface SegmentosData {
  data: { automaticos: unknown[]; manuales: unknown[] }
}

interface TrackingData {
  data: {
    ga4_measurement_id?: string | null
    meta_pixel_id?: string | null
    gtm_container_id?: string | null
  }
}

export default async function MarketingPage() {
  const session = await auth()
  if (!session) redirect("/login")

  const permisos = session.user.permisos as Permisos | undefined
  const esEmpleado = session.user.userType === "empleado"

  if (esEmpleado && !permisos?.ver_marketing) redirect("/sin-acceso")

  const [promoRes, segmentosRes, trackingRes] = await Promise.allSettled([
    fetchBackendFromServer<PromocionesStats>("/api/marketing/promociones/stats"),
    fetchBackendFromServer<SegmentosData>("/api/marketing/segmentos"),
    fetchBackendFromServer<TrackingData>("/api/marketing/analitica/tracking"),
  ])

  const codigosActivos =
    promoRes.status === "fulfilled" ? (promoRes.value.data?.activos ?? 0) : 0

  const segmentos =
    segmentosRes.status === "fulfilled"
      ? (segmentosRes.value.data?.automaticos?.length ?? 0) +
        (segmentosRes.value.data?.manuales?.length ?? 0)
      : 0

  const trackingConfigurado =
    trackingRes.status === "fulfilled"
      ? [
          trackingRes.value.data?.ga4_measurement_id,
          trackingRes.value.data?.meta_pixel_id,
          trackingRes.value.data?.gtm_container_id,
        ].filter((v) => v != null && v !== "").length
      : 0

  return (
    <MarketingOverview
      kpis={{ codigosActivos, segmentos, trackingConfigurado }}
    />
  )
}
