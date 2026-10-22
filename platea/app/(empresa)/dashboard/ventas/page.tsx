import { redirect } from "next/navigation"
import dynamic from "next/dynamic"

import { EntradasExportAction } from "@/components/dashboard/entradas-content"
import { ConsumiblesExportAction } from "@/components/dashboard/consumibles-ventas-content"

const EntradasContent = dynamic(
  () => import("@/components/dashboard/entradas-content"),
  { loading: () => <div className="h-96 animate-pulse rounded-lg bg-muted" /> },
)
const ConsumiblesVentasContent = dynamic(
  () => import("@/components/dashboard/consumibles-ventas-content"),
  { loading: () => <div className="h-96 animate-pulse rounded-lg bg-muted" /> },
)
import VentasTabsShell from "@/components/dashboard/ventas-tabs-shell"
import { requireDashboardSession } from "@/lib/dashboard-auth"
import { readEntradasQuery } from "@/lib/dashboard-query-scope"
import { readConsumiblesVentasQuery } from "@/lib/dashboard-query-scope"
import { fetchBackendFromServer } from "@/lib/server-backend"
import { puedeHacer, type Permisos } from "@/lib/permisos"

import {
  buildConsumiblesExportPath,
  buildEntradasExportPath,
  loadConsumiblesVentasDashboardData,
  loadEntradasDashboardData,
  resolveVentasRequest,
  type VentasPageSearchParams,
} from "./page-model"

export type EntradasPeriodo = {
  vendidas: number
  brutos: number
  neto: number
  canceladas: number
  ticket_promedio_neto: number | null
}

export type EntradasPeriodo30d = EntradasPeriodo & {
  tasa_cancelacion_pct: number | null
}

export type EntradasSummary = {
  data: {
    periodo: {
      hoy: EntradasPeriodo
      ultimos_7d: EntradasPeriodo
      ultimos_30d: EntradasPeriodo30d
    }
    ventas_por_dia: Array<{ fecha: string; vendidas: number; neto: number }>
  }
}

export type ConsumiblesPeriodo = {
  vendidos: number
  brutos: number
  neto: number
  cancelados: number
  ticket_promedio_neto: number | null
}

export type ConsumiblesPeriodo30d = ConsumiblesPeriodo & {
  tasa_cancelacion_pct: number | null
}

export type ConsumiblesSummary = {
  data: {
    periodo: {
      hoy: ConsumiblesPeriodo
      ultimos_7d: ConsumiblesPeriodo
      ultimos_30d: ConsumiblesPeriodo30d
    }
    ventas_por_dia: Array<{ fecha: string; vendidos: number; neto: number }>
  }
}

async function fetchEntradasSummary(): Promise<EntradasSummary | null> {
  try {
    return await fetchBackendFromServer<EntradasSummary>("/api/entradas/summary")
  } catch {
    return null
  }
}

async function fetchConsumiblesSummary(): Promise<ConsumiblesSummary | null> {
  try {
    return await fetchBackendFromServer<ConsumiblesSummary>("/api/consumibles/ventas/summary")
  } catch {
    return null
  }
}

export default async function VentasPage({
  searchParams,
}: {
  searchParams: Promise<VentasPageSearchParams>
}) {
  const { permisos, esEmpleado } = await requireDashboardSession()
  const resolvedSearchParams = await searchParams
  const request = resolveVentasRequest({
    searchParams: resolvedSearchParams,
    esEmpleado,
    permisos,
  })

  if (request.redirectTo) redirect(request.redirectTo)
  if (!request.activeTab) redirect("/sin-acceso")

  const puede = (permiso: keyof Permisos) => puedeHacer(permiso, esEmpleado, permisos)
  const puedeVerRecaudacion = puede("ver_recaudacion")

  const tabs = request.allowedTabs.map((tab) => ({
    id: tab,
    label: tab === "entradas" ? "Entradas" : "Consumibles",
  }))
  const [entradasContent, consumiblesContent, entradasSummary, consumiblesSummary] = await Promise.all([
    request.activeTab === "entradas"
      ? loadEntradasDashboardData({ searchParams: resolvedSearchParams, fetchBackendFromServer, scope: "entradas" })
      : Promise.resolve(null),
    request.activeTab === "consumibles"
      ? loadConsumiblesVentasDashboardData({ searchParams: resolvedSearchParams, fetchBackendFromServer, scope: "consumibles" })
      : Promise.resolve(null),
    request.activeTab === "entradas" && puedeVerRecaudacion
      ? fetchEntradasSummary()
      : Promise.resolve(null),
    request.activeTab === "consumibles" && puedeVerRecaudacion
      ? fetchConsumiblesSummary()
      : Promise.resolve(null),
  ])

  const entradasQuery = readEntradasQuery(resolvedSearchParams, "entradas")
  const consumiblesQuery = readConsumiblesVentasQuery(resolvedSearchParams, "consumibles")

  return (
    <VentasTabsShell
      tabs={tabs}
      activeTab={request.activeTab}
      headerAction={request.activeTab === "entradas" ? (
        <EntradasExportAction
          exportPath={buildEntradasExportPath(resolvedSearchParams, "entradas")}
          eventos={entradasContent?.eventos ?? []}
          defaultEvento={entradasQuery.evento ?? "todos"}
          defaultEstado={entradasQuery.estado ?? "todos"}
        />
      ) : request.activeTab === "consumibles" && request.allowedTabs.includes("consumibles") ? (
        <ConsumiblesExportAction
          exportPath={buildConsumiblesExportPath(resolvedSearchParams, "consumibles")}
          eventos={consumiblesContent?.status === "ready" ? consumiblesContent.eventos : []}
          defaultEventoId={consumiblesQuery.evento_id ?? "todos"}
          defaultEstado={consumiblesQuery.estado ?? "todos"}
        />
      ) : null}
    >
      {request.activeTab === "entradas" ? (
        <EntradasTabContent
          content={entradasContent!}
          permisos={permisos}
          esEmpleado={esEmpleado}
          summary={entradasSummary}
        />
      ) : (
        <ConsumiblesTabContent
          content={consumiblesContent!}
          permisos={permisos}
          esEmpleado={esEmpleado}
          summary={consumiblesSummary}
        />
      )}
    </VentasTabsShell>
  )
}

async function EntradasTabContent({
  content,
  permisos,
  esEmpleado,
  summary,
}: {
  content: Awaited<ReturnType<typeof loadEntradasDashboardData>>
  permisos: Awaited<ReturnType<typeof requireDashboardSession>>["permisos"]
  esEmpleado: boolean
  summary: EntradasSummary | null
}) {
  return (
    <EntradasContent
      entradas={content.entradas}
      eventos={content.eventos}
      stats={content.stats}
      pagination={content.pagination}
      mode="tab"
      queryScope="entradas"
      permisos={permisos}
      esEmpleado={esEmpleado}
      summary={summary}
    />
  )
}

async function ConsumiblesTabContent({
  content,
  permisos,
  esEmpleado,
  summary,
}: {
  content: Awaited<ReturnType<typeof loadConsumiblesVentasDashboardData>>
  permisos: Awaited<ReturnType<typeof requireDashboardSession>>["permisos"]
  esEmpleado: boolean
  summary: ConsumiblesSummary | null
}) {
  if (content.status === "ready") {
    return (
      <ConsumiblesVentasContent
        ventas={content.ventas}
        eventos={content.eventos}
        stats={content.stats}
        ingresosPorEvento={content.ingresosPorEvento}
        pagination={content.pagination}
        mode="tab"
        queryScope="consumibles"
        permisos={permisos}
        esEmpleado={esEmpleado}
        summary={summary}
      />
    )
  }

  return (
    <ConsumiblesVentasContent
      ventas={[]}
      eventos={[]}
      stats={{
        total_tickets: 0,
        total_neto_acreditado: 0,
        total_bruto: 0,
        total_pendientes: 0,
        total_canjeados: 0,
        total_cancelados: 0,
      }}
      ingresosPorEvento={[]}
      pagination={{ page: 1, pageSize: 25, total: 0, totalPages: 1 }}
      mode="tab"
      queryScope="consumibles"
      recoverableError={content.message}
      permisos={permisos}
      esEmpleado={esEmpleado}
      summary={null}
    />
  )
}
