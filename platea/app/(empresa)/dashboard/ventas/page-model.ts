import type { Permisos } from "@/lib/permisos"
import {
  buildConsumiblesVentasQueryString,
  buildEntradasQueryString,
  buildVentasTabHref,
  readConsumiblesVentasQuery,
  readEntradasQuery,
  readVentasTab,
  type DashboardVentasTab,
  type EntradasDashboardQueryScope,
  type EntradasDashboardQuery,
  type ConsumiblesVentasDashboardQuery,
  type ConsumiblesVentasQueryScope,
} from "@/lib/dashboard-query-scope"
import { buildDashboardVentasPath, getDashboardFirstAccessiblePath, getVisibleVentasTabs } from "@/lib/dashboard-ventas"

type FetchBackend = <T>(path: string) => Promise<T>

export type EntradasResponse = {
  data: {
    entradas: Array<{
      id: string
      checkout_session_id?: string | null
      qr_code?: string | null
      clave_corta?: string | null
      estado: "valida" | "usada" | "cancelada"
      precio_pagado: number
      comision?: number | null
      neto_empresa_amount?: number | null
      created_at: string
      evento_nombre: string
      categoria_nombre?: string | null
      comprador_nombre?: string | null
      comprador_email?: string | null
      comprador_dni?: string | null
      funcion_fecha?: string | null
    }>
    eventos: Array<{
      id: string
      nombre: string
    }>
    stats: {
      total_entradas: number
      total_neto_acreditado: number | null
      total_bruto: number | null
      total_validas: number
      total_usadas: number
      total_canceladas: number
    }
  }
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

export type VentasConsumiblesResponse = {
  data: {
    ventas: Array<{
      id: string
      clave_corta: string
      estado: "pendiente" | "canjeado" | "cancelado" | "resuelto_parcial"
      total: number | null
      neto_empresa_amount?: number | null
      delivered_amount?: number | null
      refunded_amount?: number | null
      barra_id?: string | null
      evento_id?: string | null
      checkout_session_id?: string | null
      origen?: string | null
      barra_nombre?: string | null
      evento_nombre?: string | null
      created_at: string
      items?: Array<{
        id: string
        consumible_id?: string
        consumible_nombre: string
        cantidad: number
        precio_unitario: number
        subtotal: number
      }>
    }>
    stats: {
      total_tickets: number
      total_neto_acreditado: number | null
      total_bruto: number | null
      total_pendientes: number
      total_canjeados: number
      total_cancelados: number
    }
    ingresos_por_evento: Array<{
      evento_id: string
      evento_nombre: string
      total_tickets: number
      total_neto_acreditado: number | null
      total_bruto: number | null
      total_cancelados: number
    }>
  }
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

export type EventosVentasResponse = Array<{
  id: string
  nombre: string
}>

export type VentasPageSearchParams = Record<string, string | string[] | undefined>

export type EntradasTabData = {
  entradas: EntradasResponse["data"]["entradas"]
  eventos: EntradasResponse["data"]["eventos"]
  stats: EntradasResponse["data"]["stats"]
  pagination: EntradasResponse["pagination"]
}

export type ConsumiblesTabData =
  | {
      status: "ready"
      ventas: VentasConsumiblesResponse["data"]["ventas"]
      eventos: EventosVentasResponse
      stats: VentasConsumiblesResponse["data"]["stats"]
      ingresosPorEvento: VentasConsumiblesResponse["data"]["ingresos_por_evento"]
      pagination: VentasConsumiblesResponse["pagination"]
    }
  | {
      status: "error"
      message: string
    }

export async function loadEntradasDashboardData({
  searchParams,
  fetchBackendFromServer,
  scope = "",
}: {
  searchParams: VentasPageSearchParams
  fetchBackendFromServer: FetchBackend
  scope?: EntradasDashboardQueryScope
}): Promise<EntradasTabData> {
  const query = readEntradasQuery(searchParams, scope)
  const queryString = buildEntradasQueryString(query, "")
  const response = await fetchBackendFromServer<EntradasResponse>(
    `/api/entradas${queryString ? `?${queryString}` : ""}`
  )

  return {
    entradas: response.data.entradas,
    eventos: response.data.eventos,
    stats: response.data.stats,
    pagination: response.pagination,
  }
}

export function buildEntradasExportPath(
  searchParams: VentasPageSearchParams,
  scope: EntradasDashboardQueryScope = ""
) {
  const query = readEntradasQuery(searchParams, scope)
  const exportQuery = buildEntradasQueryString({
    busqueda: query.busqueda,
    evento: query.evento,
    estado: query.estado,
    desde: query.desde,
    hasta: query.hasta,
    sortBy: query.sortBy,
    sortDir: query.sortDir,
  }, "")

  return `/api/entradas/export${exportQuery ? `?${exportQuery}` : ""}`
}

export function buildConsumiblesExportPath(
  searchParams: VentasPageSearchParams,
  scope: ConsumiblesVentasQueryScope = ""
) {
  const query = readConsumiblesVentasQuery(searchParams, scope)
  const exportQuery = buildConsumiblesVentasQueryString({
    busqueda: query.busqueda,
    evento_id: query.evento_id,
    estado: query.estado,
    desde: query.desde,
    hasta: query.hasta,
    sortBy: query.sortBy,
    sortDir: query.sortDir,
  }, "")

  return `/api/consumibles/ventas/export${exportQuery ? `?${exportQuery}` : ""}`
}

export async function loadConsumiblesVentasDashboardData({
  searchParams,
  fetchBackendFromServer,
  scope = "",
}: {
  searchParams: VentasPageSearchParams
  fetchBackendFromServer: FetchBackend
  scope?: ConsumiblesVentasQueryScope
}): Promise<ConsumiblesTabData> {
  const query = readConsumiblesVentasQuery(searchParams, scope)
  const queryString = buildConsumiblesVentasQueryString(query, "")

  return Promise.all([
    fetchBackendFromServer<VentasConsumiblesResponse>(
      `/api/consumibles/ventas${queryString ? `?${queryString}` : ""}`
    ),
    fetchBackendFromServer<EventosVentasResponse>("/api/consumibles/ventas/eventos"),
  ])
    .then(([ventasResponse, eventos]): ConsumiblesTabData => ({
      status: "ready",
      ventas: ventasResponse.data.ventas,
      eventos,
      stats: ventasResponse.data.stats,
      ingresosPorEvento: ventasResponse.data.ingresos_por_evento,
      pagination: ventasResponse.pagination,
    }))
    .catch((): ConsumiblesTabData => ({
      status: "error",
      message: "No pudimos cargar las ventas de consumibles. Reintentá actualizando la página.",
    }))
}

export function resolveVentasRequest({
  searchParams,
  esEmpleado,
  permisos,
}: {
  searchParams: VentasPageSearchParams
  esEmpleado: boolean
  permisos?: Permisos
}) {
  const allowedTabs = getVisibleVentasTabs({ esEmpleado, permisos })
  if (allowedTabs.length === 0) {
    return {
      allowedTabs,
      activeTab: null,
      redirectTo: getDashboardFirstAccessiblePath({ esEmpleado, permisos }),
    }
  }

  const requestedTab = readVentasTab(searchParams)
  const activeTab = requestedTab && allowedTabs.includes(requestedTab) ? requestedTab : allowedTabs[0]
  const canonicalHref = buildVentasTabHref(buildDashboardVentasPath(), searchParams, activeTab)

  if (!requestedTab || requestedTab !== activeTab) {
    return {
      allowedTabs,
      activeTab,
      redirectTo: canonicalHref,
    }
  }

  return {
    allowedTabs,
    activeTab,
    redirectTo: null,
  }
}

function buildLegacyVentasRedirect({
  tab,
  entradasQuery,
  consumiblesQuery,
}: {
  tab: DashboardVentasTab
  entradasQuery?: EntradasDashboardQuery
  consumiblesQuery?: ConsumiblesVentasDashboardQuery
}) {
  const params = new URLSearchParams()
  params.set("tab", tab)

  const entradasQueryString = entradasQuery ? buildEntradasQueryString(entradasQuery, "entradas") : ""
  const consumiblesQueryString = consumiblesQuery ? buildConsumiblesVentasQueryString(consumiblesQuery, "consumibles") : ""

  for (const chunk of [entradasQueryString, consumiblesQueryString]) {
    if (!chunk) continue
    for (const [key, value] of new URLSearchParams(chunk).entries()) {
      params.set(key, value)
    }
  }

  return `/dashboard/ventas?${params.toString()}`
}

export function buildLegacyEntradasRedirect(searchParams: VentasPageSearchParams) {
  return buildLegacyVentasRedirect({
    tab: "entradas",
    entradasQuery: readEntradasQuery(searchParams),
  })
}

export function buildLegacyConsumiblesRedirect(searchParams: VentasPageSearchParams) {
  return buildLegacyVentasRedirect({
    tab: "consumibles",
    consumiblesQuery: readConsumiblesVentasQuery(searchParams),
  })
}
