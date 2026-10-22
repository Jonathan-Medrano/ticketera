import assert from "node:assert/strict"
import { mock, test } from "node:test"

type BuyerRow = {
  id: string
  nombre: string
  email: string
  empresa_slug: string
}

// The lib reads the singleton Prisma client from "@/lib/prisma"; mock it so the
// test exercises the real consumeBuyerLoginToken logic without a live DB.
// $executeRaw → number of affected rows; $queryRaw → SELECT result rows.
function mockPrisma(options: { affectedRows?: number; buyerRows?: BuyerRow[] }) {
  const calls: Array<"execute" | "query"> = []

  const prisma = {
    $executeRaw: async () => {
      calls.push("execute")
      return options.affectedRows ?? 0
    },
    $queryRaw: async () => {
      calls.push("query")
      return (options.buyerRows ?? []) as unknown
    },
  }

  mock.module("@/lib/prisma", { namedExports: { prisma } })

  return { calls }
}

test("buyer token auth consumes valid token and returns buyer identity", async () => {
  const { calls } = mockPrisma({
    affectedRows: 1,
    buyerRows: [
      {
        id: "cmp-1",
        nombre: "Comprador Demo",
        email: "comprador@example.com",
        empresa_slug: "tenant-demo",
      },
    ],
  })

  const { consumeBuyerLoginToken } = await import("@/lib/buyer-token-auth")
  const buyer = await consumeBuyerLoginToken("token-demo", "tenant-demo")

  assert.equal(buyer?.id, "cmp-1")
  assert.deepEqual(calls, ["execute", "query"])

  mock.restoreAll()
})

test("buyer token auth rejects invalid or already-used token", async () => {
  const { calls } = mockPrisma({ affectedRows: 0, buyerRows: [] })

  const { consumeBuyerLoginToken } = await import("@/lib/buyer-token-auth")
  const buyer = await consumeBuyerLoginToken("token-demo", "tenant-demo")

  assert.equal(buyer, null)
  assert.deepEqual(calls, ["execute"])

  mock.restoreAll()
})
