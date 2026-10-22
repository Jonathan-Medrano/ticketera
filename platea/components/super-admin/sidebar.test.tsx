import assert from "node:assert/strict"
import { test } from "node:test"
import { superAdminNavItems } from "@/components/super-admin/sidebar"

test("superadmin sidebar keeps canonical navigation contract", () => {
  assert.deepEqual(
    superAdminNavItems.map(({ href }) => href),
    [
      "/super-admin/dashboard",
      "/super-admin/empresas",
      "/super-admin/configuracion",
      "/super-admin/usuarios",
    ]
  )

  assert.equal(superAdminNavItems[0]?.label, "Dashboard")
  assert.equal(superAdminNavItems[1]?.description.includes("gestión por empresa"), true)
  assert.equal(superAdminNavItems[1]?.capability, "platform.companies.read")
  assert.equal(superAdminNavItems[2]?.capability, "platform.settings.read")
  assert.equal(superAdminNavItems[2]?.description.includes("Defaults globales"), true)
  assert.equal(superAdminNavItems[3]?.description.includes("Jerarquía"), true)
})
