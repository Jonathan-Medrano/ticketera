import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { fetchBackendFromServer } from "@/lib/server-backend"
import dynamic from "next/dynamic"
import type { Permisos } from "@/lib/permisos"

const EventosCompareContent = dynamic(
  () => import("@/components/dashboard/eventos-compare-content"),
  { loading: () => <div className="h-96 animate-pulse rounded-lg bg-muted" /> },
)

type CategoryMixItem = {
  categoria_id: string
  nombre: string
  vendidas: number
  total: number
  pct: number | null
}

type EventoCompareItem = {
  id: string
  nombre: string
  imagen_url: string | null
  modo_fecha: "unica" | "multiple" | "pase"
  activo: number
  capacidad_total: number
  entradas_vendidas: number
  ingresos_bruto: number | null
  ingresos_neto: number | null
  ticket_promedio_bruto: number | null
  ticket_promedio_neto: number | null
  ventas_7d: number | null
  category_mix: CategoryMixItem[]
}

type CompareResponse = {
  data: {
    events: EventoCompareItem[]
    excluded_ids: string[]
  }
}

export default async function CompararPage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string }>
}) {
  const session = await auth()
  if (!session) redirect("/login")

  const permisos = session.user.permisos as Permisos | undefined
  const esEmpleado = session.user.userType === "empleado"
  if (esEmpleado && !permisos?.ver_eventos) redirect("/sin-acceso")

  const params = await searchParams
  const rawIds = (params.ids ?? "").trim()

  // Dedupe + basic filter — backend is canonical validator
  const ids = Array.from(
    new Set(rawIds.split(",").map((s) => s.trim()).filter(Boolean))
  )

  if (ids.length < 2) {
    redirect("/dashboard/eventos")
  }

  // Cap at 4 — take first 4 silently (backend 400s on 5+)
  const cappedIds = ids.slice(0, 4)

  const response = await fetchBackendFromServer<CompareResponse>(
    `/api/eventos/comparar?ids=${cappedIds.join(",")}`
  ).catch(() => null)

  // Backend error or all ids cross-tenant → safe fallback
  if (!response || response.data.events.length === 0) {
    redirect("/dashboard/eventos")
  }

  return (
    <EventosCompareContent
      events={response.data.events}
      excludedIds={response.data.excluded_ids}
      permisos={permisos}
      esEmpleado={esEmpleado}
    />
  )
}
