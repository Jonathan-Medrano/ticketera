import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { fetchBackendFromServer } from "@/lib/server-backend"
import dynamic from "next/dynamic"
import type { Permisos } from "@/lib/permisos"

const EventosVelocityContent = dynamic(
  () => import("@/components/dashboard/eventos-velocity-content"),
  { loading: () => <div className="h-96 animate-pulse rounded-lg bg-muted" /> },
)

type EligibleEvent = {
  id: string
  nombre: string
  imagen_url: string | null
  modo_fecha: "unica" | "multiple" | "pase"
}

type VelocitySeriesPoint = {
  days_before_event: number
  fecha_snapshot: string
  vendidas_acumuladas: number
  capacidad_total_snapshot: number
  ingresos_neto_acumulado: number
  ocupacion_pct: number
}

type VelocityEvent = {
  id: string
  nombre: string
  imagen_url: string | null
  modo_fecha: string
  anchor_date: string
  series: VelocitySeriesPoint[]
}

type VelocityData = {
  events: VelocityEvent[]
  excluded_ids: string[]
  no_anchor_ids: string[]
}

type EventosListResponse = {
  data: EligibleEvent[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

export default async function VelocityPage() {
  const session = await auth()
  if (!session?.user) redirect("/login")

  const esEmpleado = session.user.userType === "empleado"
  const permisos = session.user.permisos as Permisos | undefined

  // Permission gate — redirect before any fetches
  if (esEmpleado && (!permisos?.ver_eventos || !permisos?.ver_kpis_eventos)) {
    redirect("/sin-acceso")
  }

  // Parallel: eligible events list + top-5 by ingresos (for default selection)
  // fetchBackendFromServer uses getCachedSession() internally — no session arg needed
  const [listRes, topRes] = await Promise.all([
    fetchBackendFromServer<EventosListResponse>(
      "/api/eventos?pageSize=200&sortBy=nombre&sortDir=asc"
    ).catch(() => null),
    fetchBackendFromServer<EventosListResponse>(
      "/api/eventos?pageSize=5&sortBy=ingresos&sortDir=desc"
    ).catch(() => null),
  ])

  // Filter out pase events for the selector
  const eligibleEvents: EligibleEvent[] = (listRes?.data ?? []).filter(
    (e) => e.modo_fecha !== "pase"
  )

  // Top-5 default IDs (non-pase only, already sorted by ingresos desc)
  // Strategy: sortBy=ingresos on the list endpoint — gated by ver_kpis_eventos which
  // is already enforced by the permission guard above, so this sort is always safe here.
  const defaultIds: string[] = (topRes?.data ?? [])
    .filter((e) => e.modo_fecha !== "pase")
    .slice(0, 5)
    .map((e) => String(e.id))

  // Initial velocity data — only if we have IDs to request
  const velocityRes =
    defaultIds.length > 0
      ? await fetchBackendFromServer<{ data: VelocityData }>(
          `/api/eventos/velocity?evento_ids=${defaultIds.join(",")}`
        ).catch(() => null)
      : null

  return (
    <EventosVelocityContent
      eligibleEvents={eligibleEvents}
      initialSelectedIds={defaultIds}
      initialVelocityData={velocityRes?.data ?? null}
      permisos={permisos}
      esEmpleado={esEmpleado}
    />
  )
}
