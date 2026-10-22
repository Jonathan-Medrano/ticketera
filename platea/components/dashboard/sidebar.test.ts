import assert from "node:assert/strict"
import test from "node:test"

import { dashboardNavSections } from "@/components/dashboard/sidebar"

test("dashboard sidebar exposes ventas as the canonical nav entry", () => {
  const ventaPublico = dashboardNavSections.find((section) => section.title === "Venta y público")
  const ventasItem = ventaPublico?.items.find((item) => item.label === "Ventas")

  assert.equal(ventasItem?.href, "/dashboard/ventas")
  assert.equal(ventaPublico?.items.some((item) => item.href === "/dashboard/entradas"), false)
})
