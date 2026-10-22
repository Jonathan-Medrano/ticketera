import assert from "node:assert/strict"
import test from "node:test"

import { buildDashboardVentasPath, getDashboardFirstAccessiblePath, getDefaultVentasTab, getVisibleVentasTabs } from "@/lib/dashboard-ventas"
import { PERMISOS_VACIOS } from "@/lib/permisos"

test("ventas visibility returns both tabs for company actors and dual-access employees", () => {
  assert.deepEqual(getVisibleVentasTabs({ esEmpleado: false }), ["entradas", "consumibles"])
  assert.deepEqual(
    getVisibleVentasTabs({
      esEmpleado: true,
      permisos: { ...PERMISOS_VACIOS, ver_entradas: true, ver_consumibles: true },
    }),
    ["entradas", "consumibles"]
  )
})

test("ventas default tab follows the first allowed domain", () => {
  assert.equal(
    getDefaultVentasTab({
      esEmpleado: true,
      permisos: { ...PERMISOS_VACIOS, ver_consumibles: true },
    }),
    "consumibles"
  )
  assert.equal(buildDashboardVentasPath("consumibles"), "/dashboard/ventas?tab=consumibles")
})

test("dashboard fallback routes ventas-capable employees to canonical ventas surface", () => {
  assert.equal(
    getDashboardFirstAccessiblePath({
      esEmpleado: true,
      permisos: { ...PERMISOS_VACIOS, ver_entradas: true },
    }),
    "/dashboard/ventas?tab=entradas"
  )
  assert.equal(
    getDashboardFirstAccessiblePath({
      esEmpleado: true,
      permisos: { ...PERMISOS_VACIOS, ver_compradores: true },
    }),
    "/dashboard/compradores"
  )
})
