import assert from "node:assert/strict"
import test from "node:test"
import type { Session } from "next-auth"
import { NextRequest } from "next/server"
import { proxyToBackend } from "@/lib/backend-proxy"
import { fetchTenantBackendFromServer } from "@/lib/server-backend"
import type { BuyerSessionUser } from "@/lib/buyer-session/types"

type ProxyAuthFn = NonNullable<NonNullable<Parameters<typeof proxyToBackend>[3]>["authFn"]>

const acmeBuyer: BuyerSessionUser = {
  id: "cmp-acme",
  email: "acme@example.com",
  name: "Acme Buyer",
  userType: "comprador",
  empresa_id: "emp-acme",
  empresa_slug: "acme",
  passwordVersion: 123,
}

const empresaSession: Session = {
  user: {
    id: "emp-1",
    slug: "acme",
    userType: "empresa",
  },
  expires: "2099-01-01T00:00:00.000Z",
}

const resolveEmpresaSession: ProxyAuthFn = async () => empresaSession

test("tenant SSR forwarding sends the resolved buyer actor to backend", async () => {
  let forwardedHeaders: HeadersInit | undefined

  const payload = await fetchTenantBackendFromServer<{ ok: boolean }>("/api/tenant/acme/mis-tickets", "acme", {
    getBuyerSessionForTenantSlug: async () => acmeBuyer,
    fetchImpl: async (_input, init) => {
      forwardedHeaders = init?.headers
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    },
  })

  const headers = forwardedHeaders as Record<string, string>
  assert.equal(payload.ok, true)
  assert.equal(headers["x-actor-kind"], "buyer")
  assert.equal(headers["x-tenant-slug"], "acme")
  assert.match(headers["x-user"], /cmp-acme/)
})

test("tenant BFF forwarding rejects internal-only access before reaching backend", async () => {
  let backendCalled = false

  const request = new NextRequest("https://acme.platea.test/api/tenant/acme/mis-tickets")
  const response = await proxyToBackend(
    request,
    "/api/tenant/acme/mis-tickets",
    {},
    {
      readBuyerSessionRegistryFromRequest: () => ({}),
      fetchImpl: async () => {
        backendCalled = true
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      },
    }
  )

  assert.equal(response.status, 401)
  assert.equal(backendCalled, false)
})

test("tenant BFF forwarding sends buyer actor headers when tenant session exists", async () => {
  let forwardedHeaders: HeadersInit | undefined

  const request = new NextRequest("https://acme.platea.test/api/tenant/acme/mis-tickets", {
    headers: {
      "x-forwarded-for": "1.2.3.4",
      "user-agent": "platea-test",
    },
  })

  const response = await proxyToBackend(
    request,
    "/api/tenant/acme/mis-tickets",
    {},
    {
      readBuyerSessionRegistryFromRequest: () => ({ acme: acmeBuyer }),
      fetchImpl: async (_input, init) => {
        forwardedHeaders = init?.headers
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      },
    }
  )

  const body = await response.json()
  const headers = forwardedHeaders as Record<string, string>

  assert.equal(body.ok, true)
  assert.equal(headers["x-actor-kind"], "buyer")
  assert.equal(headers["x-tenant-slug"], "acme")
  assert.match(headers["x-user"], /cmp-acme/)
  assert.equal(headers["x-client-ip"], "1.2.3.4")
  assert.equal(headers["x-client-user-agent"], "platea-test")
})

test("BFF raw response mode preserves XLSX headers and body for downloads", async () => {
  const workbookBytes = Uint8Array.from([0x50, 0x4b, 0x03, 0x04])
  const request = new NextRequest("https://app.platea.test/api/entradas/export")
  const response = await proxyToBackend(
    request,
    "/api/entradas/export",
    { responseMode: "raw" },
    {
      authFn: resolveEmpresaSession,
      fetchImpl: async () => new Response(workbookBytes, {
        status: 200,
        headers: {
          "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "content-disposition": 'attachment; filename="entradas-export-2026-05-19.xlsx"',
        },
      }),
    }
  )

  assert.equal(response.status, 200)
  assert.equal(response.headers.get("content-type"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
  assert.equal(response.headers.get("content-disposition"), 'attachment; filename="entradas-export-2026-05-19.xlsx"')
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), workbookBytes)
})
