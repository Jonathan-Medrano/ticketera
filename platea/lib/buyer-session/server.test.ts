import assert from "node:assert/strict"
import test from "node:test"
import type { BuyerSessionUser } from "@/lib/buyer-session/types"
import { requireBuyerSessionForTenant, resolveBuyerSessionRedirectPath, validateBuyerSessionFreshness } from "./server"

const acmeBuyer: BuyerSessionUser = {
  id: "cmp-acme",
  email: "acme@example.com",
  name: "Acme Buyer",
  userType: "comprador",
  empresa_id: "emp-acme",
  empresa_slug: "acme",
  passwordVersion: 123,
}

test("buyer-only tenant guard redirects anonymous access to tenant auth", async () => {
  let redirectedTo: string | null = null

  const result = await requireBuyerSessionForTenant("acme", "consumibles/checkout", {
    getBuyerSessionForTenantSlug: async () => null,
    redirect: (location) => {
      redirectedTo = location
      throw new Error("redirected")
    },
  }).catch((error: Error) => error.message)

  assert.equal(result, "redirected")
  assert.equal(redirectedTo, resolveBuyerSessionRedirectPath("acme", "consumibles/checkout"))
})

test("buyer-only tenant guard allows the resolved tenant buyer session", async () => {
  const result = await requireBuyerSessionForTenant("acme", "consumibles/checkout", {
    getBuyerSessionForTenantSlug: async () => acmeBuyer,
  })

  assert.ok(result)
  assert.equal(result.id, "cmp-acme")
})

test("buyer tenant session becomes stale when password version changed", async () => {
  const result = await validateBuyerSessionFreshness(acmeBuyer, {
    getBuyerPasswordVersion: async () => 999,
  })

  assert.equal(result, null)
})

test("legacy buyer tenant session without password version stays valid until refresh", async () => {
  const result = await validateBuyerSessionFreshness({
    ...acmeBuyer,
    passwordVersion: null,
  }, {
    getBuyerPasswordVersion: async () => 999,
  })

  assert.ok(result)
  assert.equal(result?.id, "cmp-acme")
})
