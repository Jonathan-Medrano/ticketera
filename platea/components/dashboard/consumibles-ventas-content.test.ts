import assert from "node:assert/strict"
import test from "node:test"

import type { Permisos } from "@/lib/permisos"

import { getConsumiblesTicketActions } from "./consumibles-ventas-helpers"
import { resolveConsumiblesExportErrorMessage } from "./consumibles-ventas-content"

test("pending consumibles tickets keep detail action but hide cancellation without gestionar_consumibles", () => {
  const actions = getConsumiblesTicketActions(
    "pendiente",
    {
      ver_consumibles: true,
      gestionar_consumibles: false,
    } as Permisos,
    true
  )

  assert.equal(actions.canViewDetail, true)
  assert.equal(actions.canCancel, false)
})

test("pending consumibles tickets allow cancellation for managing employees and company actors", () => {
  const employeeActions = getConsumiblesTicketActions(
    "pendiente",
    {
      ver_consumibles: true,
      gestionar_consumibles: true,
    } as Permisos,
    true
  )

  const companyActions = getConsumiblesTicketActions("pendiente", undefined, false)

  assert.equal(employeeActions.canCancel, true)
  assert.equal(companyActions.canCancel, true)
  assert.equal(getConsumiblesTicketActions("canjeado", undefined, false).canCancel, false)
})

test("partially resolved consumibles tickets keep detail access but never allow cancellation", () => {
  const actions = getConsumiblesTicketActions("resuelto_parcial", undefined, false)

  assert.equal(actions.canViewDetail, true)
  assert.equal(actions.canCancel, false)
})

test("consumibles export maps json backend errors and generic failures into operator guidance", () => {
  assert.equal(
    resolveConsumiblesExportErrorMessage({ error: "Refiná los filtros" }),
    "Refiná los filtros"
  )
  assert.equal(
    resolveConsumiblesExportErrorMessage(null),
    "No pudimos exportar las ventas de consumibles. Refiná los filtros e intentá de nuevo."
  )
})
