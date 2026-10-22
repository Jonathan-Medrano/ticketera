import assert from "node:assert/strict"
import test from "node:test"

import {
  buildEntradasQueryString,
  buildVentasTabHref,
  buildScopedQueryKey,
  buildConsumiblesVentasQueryString,
  readVentasTab,
  readConsumiblesVentasQuery,
  readEntradasQuery,
  writeVentasTab,
  writeConsumiblesVentasQuery,
  writeEntradasQuery,
} from "@/lib/dashboard-query-scope"

test("legacy scope keeps entradas keys without prefixes", () => {
  const parsed = readEntradasQuery({
    page: "2",
    pageSize: "50",
    busqueda: "juan",
    estado: "usada",
    desde: "2026-05-01",
    hasta: "2026-05-31",
    sortBy: "comprador",
    sortDir: "asc",
  })

  assert.deepEqual(parsed, {
    page: "2",
    pageSize: "50",
    busqueda: "juan",
    estado: "usada",
    desde: "2026-05-01",
    hasta: "2026-05-31",
    sortBy: "comprador",
    sortDir: "asc",
  })
  assert.equal(buildScopedQueryKey("", "pageSize"), "pageSize")
})

test("cv scope reads prefixed consumibles keys and keeps naming stable", () => {
  const parsed = readConsumiblesVentasQuery(
    {
      cvPage: "3",
      cvPageSize: "10",
      cvBusqueda: "gin",
      cvEventoId: "evento-2",
      cvEstado: "pendiente",
      cvDesde: "2026-05-01",
      cvHasta: "2026-05-31",
      cvSortBy: "total",
      cvSortDir: "asc",
    },
    "cv"
  )

  assert.deepEqual(parsed, {
      page: "3",
      pageSize: "10",
      busqueda: "gin",
      evento_id: "evento-2",
      estado: "pendiente",
      desde: "2026-05-01",
      hasta: "2026-05-31",
      sortBy: "total",
    sortDir: "asc",
  })
  assert.equal(buildScopedQueryKey("cv", "evento_id"), "cvEventoId")
})

test("canonical ventas scopes keep entradas and consumibles isolated under explicit tab prefixes", () => {
  const entradas = readEntradasQuery(
    {
      vePage: "2",
      veBusqueda: "ana",
      veEstado: "valida",
      veDesde: "2026-05-01",
      veHasta: "2026-05-31",
      vcPage: "7",
    },
    "entradas"
  )

  const consumibles = readConsumiblesVentasQuery(
    {
      vcPage: "7",
      vcBusqueda: "fernet",
      vcEventoId: "evento-2",
      vcEstado: "pendiente",
      vcDesde: "2026-05-01",
      vcHasta: "2026-05-31",
      vePage: "2",
    },
    "consumibles"
  )

  assert.deepEqual(entradas, {
    page: "2",
    busqueda: "ana",
    estado: "valida",
    desde: "2026-05-01",
    hasta: "2026-05-31",
  })
  assert.deepEqual(consumibles, {
      page: "7",
      busqueda: "fernet",
      evento_id: "evento-2",
      estado: "pendiente",
      desde: "2026-05-01",
      hasta: "2026-05-31",
    })
  assert.equal(buildEntradasQueryString(entradas, "entradas"), "vePage=2&veBusqueda=ana&veEstado=valida&veDesde=2026-05-01&veHasta=2026-05-31")
  assert.equal(buildConsumiblesVentasQueryString(consumibles, "consumibles"), "vcPage=7&vcBusqueda=fernet&vcEventoId=evento-2&vcEstado=pendiente&vcDesde=2026-05-01&vcHasta=2026-05-31")
})

test("consumibles updates stay isolated from entradas filters sort and pagination", () => {
  const current = new URLSearchParams(
    "page=2&pageSize=25&busqueda=ana&evento=evento-1&estado=valida&sortBy=evento&sortDir=desc"
  )

  const next = writeConsumiblesVentasQuery(
    current,
    {
      page: 4,
      pageSize: "10",
      busqueda: "gin",
      evento_id: "evento-2",
      estado: "pendiente",
      sortBy: "total",
      sortDir: "asc",
    },
    "cv"
  )

  assert.equal(next.get("page"), "2")
  assert.equal(next.get("pageSize"), "25")
  assert.equal(next.get("busqueda"), "ana")
  assert.equal(next.get("evento"), "evento-1")
    assert.equal(next.get("sortBy"), "evento")
    assert.equal(next.get("cvPage"), "4")
    assert.equal(next.get("cvPageSize"), "10")
    assert.equal(next.get("cvBusqueda"), "gin")
    assert.equal(next.get("cvEventoId"), "evento-2")
    assert.equal(next.get("cvEstado"), "pendiente")
    assert.equal(next.get("cvSortBy"), "total")
  assert.equal(next.get("cvSortDir"), "asc")
})

test("scoped ventas search preserves raw spaces and removes whitespace-only input", () => {
  const entradas = writeEntradasQuery(new URLSearchParams(), { busqueda: " mesa  ", page: 1 }, "entradas")
  const consumibles = writeConsumiblesVentasQuery(
    new URLSearchParams("vcBusqueda=gin%20tonic%20&vcPage=3"),
    { busqueda: "   ", page: 1 },
    "consumibles"
  )

  assert.equal(entradas.get("veBusqueda"), " mesa  ")
  assert.equal(entradas.get("vePage"), "1")
  assert.equal(consumibles.get("vcBusqueda"), null)
  assert.equal(consumibles.get("vcPage"), "1")
})

test("scoped ventas page reset only touches the active tab namespace", () => {
  const current = new URLSearchParams(
    "vePage=7&veBusqueda=ana&vcPage=4&vcBusqueda=gin&vcEstado=pendiente"
  )

  const next = writeEntradasQuery(current, { busqueda: "maria ", page: 1 }, "entradas")

  assert.equal(next.get("veBusqueda"), "maria ")
  assert.equal(next.get("vePage"), "1")
  assert.equal(next.get("vcBusqueda"), "gin")
  assert.equal(next.get("vcPage"), "4")
  assert.equal(next.get("vcEstado"), "pendiente")
})

test("entradas updates preserve consumibles scoped state and drop default filters", () => {
  const current = new URLSearchParams(
    "cvPage=4&cvPageSize=10&cvEventoId=evento-2&cvEstado=pendiente&cvSortBy=total&cvSortDir=asc"
  )

  const next = writeEntradasQuery(current, {
    page: 1,
    pageSize: "50",
    busqueda: "maria",
    evento: "todos",
    estado: "todos",
    desde: "2026-05-01",
    hasta: "2026-05-31",
    sortBy: "comprador",
    sortDir: "desc",
  })

  assert.equal(next.get("page"), "1")
  assert.equal(next.get("pageSize"), "50")
  assert.equal(next.get("busqueda"), "maria")
  assert.equal(next.get("evento"), null)
  assert.equal(next.get("estado"), null)
  assert.equal(next.get("desde"), "2026-05-01")
  assert.equal(next.get("hasta"), "2026-05-31")
  assert.equal(next.get("sortBy"), "comprador")
  assert.equal(next.get("cvPage"), "4")
  assert.equal(next.get("cvEventoId"), "evento-2")
  assert.equal(next.get("cvEstado"), "pendiente")
})

test("switching ventas tabs preserves the query state of both domains", () => {
  const href = buildVentasTabHref(
    "/dashboard/ventas",
    new URLSearchParams("tab=entradas&vePage=2&veBusqueda=ana&vcPage=4&vcBusqueda=gin&vcEstado=pendiente"),
    "consumibles"
  )

  assert.equal(
    href,
    "/dashboard/ventas?tab=consumibles&vePage=2&veBusqueda=ana&vcPage=4&vcBusqueda=gin&vcEstado=pendiente"
  )

  const next = writeVentasTab(new URLSearchParams("vePage=3"), "entradas")
  assert.equal(next.get("tab"), "entradas")
  assert.equal(readVentasTab(next), "entradas")
})
