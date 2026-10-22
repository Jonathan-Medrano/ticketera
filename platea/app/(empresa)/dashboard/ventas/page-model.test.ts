import assert from "node:assert/strict"
import test from "node:test"

import {
  buildConsumiblesExportPath,
  buildEntradasExportPath,
  buildLegacyConsumiblesRedirect,
  buildLegacyEntradasRedirect,
  loadConsumiblesVentasDashboardData,
  resolveVentasRequest,
} from "./page-model"

test("ventas request redirects to default allowed tab when tab is missing", () => {
  const result = resolveVentasRequest({
    searchParams: { vePage: "2", vcPage: "4" },
    esEmpleado: true,
    permisos: { ver_entradas: true, ver_consumibles: true } as never,
  })

  assert.equal(result.activeTab, "entradas")
  assert.equal(result.redirectTo, "/dashboard/ventas?vePage=2&vcPage=4&tab=entradas")
})

test("ventas request falls back to the first allowed tab and preserves the other scoped query state", () => {
  const result = resolveVentasRequest({
    searchParams: { tab: "entradas", vcPage: "4", vcEstado: "pendiente" },
    esEmpleado: true,
    permisos: { ver_consumibles: true } as never,
  })

  assert.equal(result.activeTab, "consumibles")
  assert.equal(result.redirectTo, "/dashboard/ventas?tab=consumibles&vcPage=4&vcEstado=pendiente")
})

test("ventas request without access to any ventas tab uses the dashboard fallback instead of rendering the shell", () => {
  const result = resolveVentasRequest({
    searchParams: { tab: "entradas", vePage: "2", vcPage: "4" },
    esEmpleado: true,
    permisos: { ver_compradores: true } as never,
  })

  assert.deepEqual(result.allowedTabs, [])
  assert.equal(result.activeTab, null)
  assert.equal(result.redirectTo, "/dashboard/compradores")
})

test("legacy entradas route redirects into canonical ventas scoped params", () => {
  assert.equal(
    buildLegacyEntradasRedirect({ page: "2", busqueda: "ana", estado: "valida" }),
    "/dashboard/ventas?tab=entradas&vePage=2&veBusqueda=ana&veEstado=valida"
  )
})

test("legacy consumibles route redirects into canonical ventas scoped params", () => {
  assert.equal(
    buildLegacyConsumiblesRedirect({ page: "3", busqueda: "gin", evento_id: "evento-2", estado: "pendiente" }),
    "/dashboard/ventas?tab=consumibles&vcPage=3&vcBusqueda=gin&vcEventoId=evento-2&vcEstado=pendiente"
  )
})

test("ventas page forwards scoped consumibles search params to the backend list endpoint", async () => {
  const requests: string[] = []

  await loadConsumiblesVentasDashboardData({
    searchParams: { vcBusqueda: "gin", vcEventoId: "evento-2", vcEstado: "pendiente", vcPage: "2" },
    scope: "consumibles",
    fetchBackendFromServer: async <T,>(path: string) => {
      requests.push(path)

      if (path === "/api/consumibles/ventas/eventos") return [] as T

      return {
        data: {
          ventas: [],
          stats: {
            total_tickets: 0,
            total_neto_acreditado: 0,
            total_bruto: 0,
            total_pendientes: 0,
            total_canjeados: 0,
            total_cancelados: 0,
          },
          ingresos_por_evento: [],
        },
        pagination: { page: 1, pageSize: 25, total: 0, totalPages: 1 },
      } as T
    },
  })

  assert.deepEqual(requests, [
    "/api/consumibles/ventas?page=2&busqueda=gin&evento_id=evento-2&estado=pendiente",
    "/api/consumibles/ventas/eventos",
  ])
})

test("ventas page forwards scoped raw search text to the backend list endpoint", async () => {
  const requests: string[] = []

  await loadConsumiblesVentasDashboardData({
    searchParams: { vcBusqueda: "gin tonic ", vcPage: "2" },
    scope: "consumibles",
    fetchBackendFromServer: async <T,>(path: string) => {
      requests.push(path)

      if (path === "/api/consumibles/ventas/eventos") return [] as T

      return {
        data: {
          ventas: [],
          stats: {
            total_tickets: 0,
            total_neto_acreditado: 0,
            total_bruto: 0,
            total_pendientes: 0,
            total_canjeados: 0,
            total_cancelados: 0,
          },
          ingresos_por_evento: [],
        },
        pagination: { page: 1, pageSize: 25, total: 0, totalPages: 1 },
      } as T
    },
  })

  assert.deepEqual(requests, [
    "/api/consumibles/ventas?page=2&busqueda=gin+tonic+",
    "/api/consumibles/ventas/eventos",
  ])
})

test("ventas page degrades consumibles failures without breaking the canonical shell", async () => {
  const result = await loadConsumiblesVentasDashboardData({
    searchParams: { vcPage: "2" },
    scope: "consumibles",
    fetchBackendFromServer: async () => {
      throw new Error("timeout")
    },
  })

  assert.equal(result.status, "error")
  assert.match(result.status === "error" ? result.message : "", /No pudimos cargar/)
})

test("ventas export path keeps only active entradas filters and sort", () => {
  assert.equal(
    buildEntradasExportPath({
      tab: "entradas",
      veBusqueda: "ana maria",
      veEvento: "evento-2",
      veEstado: "valida",
      veSortBy: "evento",
      veSortDir: "asc",
      vePage: "4",
      vePageSize: "100",
      vcBusqueda: "gin",
      vcSortBy: "estado",
    }, "entradas"),
    "/api/entradas/export?busqueda=ana+maria&evento=evento-2&estado=valida&sortBy=evento&sortDir=asc"
  )
})

test("ventas export path ignores pagination and client-only column toggles", () => {
  assert.equal(
    buildEntradasExportPath({
      tab: "entradas",
      veBusqueda: "target",
      vePage: "3",
      vePageSize: "25",
      columnas: "precio,checkout",
    }, "entradas"),
    "/api/entradas/export?busqueda=target"
  )
})

test("consumibles export path keeps only active filters and sort", () => {
  assert.equal(
    buildConsumiblesExportPath({
      tab: "consumibles",
      vcBusqueda: "gin tonic",
      vcEventoId: "evento-2",
      vcEstado: "resuelto_parcial",
      vcSortBy: "clave",
      vcSortDir: "asc",
      vcPage: "4",
      vcPageSize: "100",
      columnas: "total,evento",
    }, "consumibles"),
    "/api/consumibles/ventas/export?busqueda=gin+tonic&evento_id=evento-2&estado=resuelto_parcial&sortBy=clave&sortDir=asc"
  )
})
