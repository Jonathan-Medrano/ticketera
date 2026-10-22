import assert from "node:assert/strict"
import test from "node:test"
import { resolveTenantSlugFromHost, resolveTenantSurface } from "@/lib/tenant-host"

test("tenant aliases resolve slug from subdomain host", () => {
  assert.equal(resolveTenantSlugFromHost("acme.ticketera.com", ["ticketera.com"]), "acme")
})

test("canonical tenant routes resolve tenant from path", () => {
  assert.deepEqual(resolveTenantSurface("/t/acme/checkout", "ticketera.com", ["ticketera.com"]), { surface: "tenant", tenantSlug: "acme", origin: "path" })
})

test("internal dashboard routes stay internal on tenant subdomains", () => {
  assert.deepEqual(resolveTenantSurface("/dashboard", "acme.ticketera.com", ["ticketera.com"]), { surface: "internal", tenantSlug: "acme", origin: "host" })
})
