import assert from "node:assert/strict"
import test from "node:test"
import type { BuyerSessionUser } from "@/lib/buyer-session/types"
import { buildActorHeaders, resolveRequestActorContext } from "@/lib/request-actor"

const internalUser = { id: "emp-1", userType: "empresa", slug: "empresa-demo" }
const acmeBuyer: BuyerSessionUser = { id: "cmp-acme", email: "acme@example.com", name: "Acme Buyer", userType: "comprador", empresa_id: "emp-acme", empresa_slug: "acme", passwordVersion: 123 }

test("tenant forwarding uses the tenant buyer actor", () => {
  const actor = resolveRequestActorContext({ path: "/api/tenant/acme/mis-tickets", internalUser, buyerUser: acmeBuyer })
  assert.equal(actor.actorKind, "buyer")
  assert.equal(actor.user?.id, "cmp-acme")
})

test("tenant forwarding does not leak internal actors when buyer session is absent", () => {
  const actor = resolveRequestActorContext({ path: "/api/tenant/acme/mis-tickets", internalUser, buyerUser: null })
  assert.equal(actor.actorKind, "anonymous")
  assert.equal(actor.user, null)
})

test("actor headers include actor kind and tenant slug", () => {
  const headers = buildActorHeaders(resolveRequestActorContext({ path: "/api/tenant/acme/mis-tickets", buyerUser: acmeBuyer }))
  assert.equal(headers["x-actor-kind"], "buyer")
  assert.equal(headers["x-tenant-slug"], "acme")
})
