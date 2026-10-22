import assert from "node:assert/strict"
import { createHmac } from "node:crypto"
import test from "node:test"
import { getBuyerSessionForTenant, parseBuyerSessionRegistry, removeBuyerSession, serializeBuyerSessionRegistry, upsertBuyerSession } from "@/lib/buyer-session/registry"

const acmeBuyer = { id: "cmp-acme", email: "acme@example.com", name: "Acme Buyer", userType: "comprador" as const, empresa_id: "emp-acme", empresa_slug: "acme", passwordVersion: 111 }
const bravoBuyer = { id: "cmp-bravo", email: "bravo@example.com", name: "Bravo Buyer", userType: "comprador" as const, empresa_id: "emp-bravo", empresa_slug: "bravo", passwordVersion: 222 }

test("buyer sessions coexist across tenants", () => {
  const cookie = serializeBuyerSessionRegistry(upsertBuyerSession(upsertBuyerSession({}, "acme", acmeBuyer), "bravo", bravoBuyer))
  const registry = parseBuyerSessionRegistry(cookie)
  assert.equal(getBuyerSessionForTenant(registry, "acme")?.id, "cmp-acme")
  assert.equal(getBuyerSessionForTenant(registry, "bravo")?.id, "cmp-bravo")
})

test("buyer session refresh only replaces its own tenant slot", () => {
  const registry = upsertBuyerSession(upsertBuyerSession({}, "acme", acmeBuyer), "bravo", bravoBuyer)
  const nextRegistry = upsertBuyerSession(registry, "acme", { ...acmeBuyer, id: "cmp-acme-2" })
  assert.equal(getBuyerSessionForTenant(nextRegistry, "acme")?.id, "cmp-acme-2")
  assert.equal(getBuyerSessionForTenant(nextRegistry, "bravo")?.id, "cmp-bravo")
})

test("buyer logout removes only the current tenant session", () => {
  const registry = upsertBuyerSession(upsertBuyerSession({}, "acme", acmeBuyer), "bravo", bravoBuyer)
  const nextRegistry = removeBuyerSession(registry, "acme")
  assert.equal(getBuyerSessionForTenant(nextRegistry, "acme"), null)
  assert.equal(getBuyerSessionForTenant(nextRegistry, "bravo")?.id, "cmp-bravo")
})

test("legacy buyer session cookies are normalized with null passwordVersion", () => {
  const legacyPayload = Buffer.from(JSON.stringify({
    acme: {
      id: "cmp-legacy",
      email: "legacy@example.com",
      name: "Legacy Buyer",
      userType: "comprador",
      empresa_id: "emp-legacy",
      empresa_slug: "legacy",
    },
  }), "utf8").toString("base64url")
  const signature = createHmac("sha256", "platea-buyer-session-dev-secret").update(legacyPayload).digest("base64url")

  const registry = parseBuyerSessionRegistry(`${legacyPayload}.${signature}`)
  assert.equal(registry.acme?.passwordVersion, null)
})
