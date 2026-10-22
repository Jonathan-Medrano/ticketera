import assert from "node:assert/strict"
import test from "node:test"
import { buildTenantInfoMenuSections } from "./tenant-info-menu"

test("tenant info menu shows buyer account section even without info pages", () => {
  const sections = buildTenantInfoMenuSections({
    tenantSlug: "club-demo",
    enabledPages: [],
    isBuyerAuthenticated: true,
  })

  assert.equal(sections.length, 1)
  assert.equal(sections[0]?.title, "Cuenta")
  assert.equal(sections[0]?.items[0]?.href, "/t/club-demo/configuracion")
})

test("tenant info menu preserves information links when pages exist", () => {
  const sections = buildTenantInfoMenuSections({
    tenantSlug: "club-demo",
    enabledPages: [{ key: "terminos", title: "Términos" }],
    isBuyerAuthenticated: true,
  })

  assert.equal(sections.length, 2)
  assert.equal(sections[1]?.title, "Información")
  assert.equal(sections[1]?.items[0]?.href, "/t/club-demo/informacion/terminos")
})
