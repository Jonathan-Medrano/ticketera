import assert from "node:assert/strict"
import { createRequire } from "node:module"
import Module from "node:module"
import test from "node:test"
import { NextRequest } from "next/server"

const require = createRequire(import.meta.url)
type NodeModuleLoader = typeof Module & {
  _load: (request: string, parent: NodeModule | null, isMain: boolean) => unknown
}

function loadRouteHandler<T>(moduleAbsolutePath: string, exportName: string, calls: Array<{ path: string; options?: unknown }>) {
  const nodeModule = Module as NodeModuleLoader
  const originalLoad = nodeModule._load

  nodeModule._load = function patchedLoad(request: string, parent: NodeModule | null, isMain: boolean) {
    if (request === "@/lib/backend-proxy") {
      return {
        proxyToBackend: async (_req: NextRequest, path: string, options?: unknown) => {
          calls.push({ path, options })
          return new Response(JSON.stringify({ ok: true }), { status: 200 })
        },
      }
    }

    return originalLoad.call(this, request, parent, isMain)
  }

  try {
    delete require.cache[moduleAbsolutePath]
    const loaded = require(moduleAbsolutePath) as Record<string, T>
    return loaded[exportName]
  } finally {
    nodeModule._load = originalLoad
  }
}

test("tenant buyer settings route handlers proxy to the expected backend paths", async () => {
  const calls: Array<{ path: string; options?: unknown }> = []
  const base = require.resolve("@/app/api/tenant/[slug]/account/route")
  const password = require.resolve("@/app/api/tenant/[slug]/account/password/route")
  const delivery = require.resolve("@/app/api/tenant/[slug]/account/delivery-preference/route")
  const requestCode = require.resolve("@/app/api/tenant/[slug]/account/whatsapp/request-code/route")
  const verifyCode = require.resolve("@/app/api/tenant/[slug]/account/whatsapp/verify-code/route")

  const GET = loadRouteHandler<(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) => Promise<Response>>(base, "GET", calls)
  const PATCH_PASSWORD = loadRouteHandler<(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) => Promise<Response>>(password, "PATCH", calls)
  const PATCH_DELIVERY = loadRouteHandler<(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) => Promise<Response>>(delivery, "PATCH", calls)
  const POST_REQUEST = loadRouteHandler<(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) => Promise<Response>>(requestCode, "POST", calls)
  const POST_VERIFY = loadRouteHandler<(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) => Promise<Response>>(verifyCode, "POST", calls)

  await GET(new NextRequest("https://tenant.test/api/tenant/club-demo/account"), { params: Promise.resolve({ slug: "club-demo" }) })
  await PATCH_PASSWORD(new NextRequest("https://tenant.test/api/tenant/club-demo/account/password", { method: "PATCH" }), { params: Promise.resolve({ slug: "club-demo" }) })
  await PATCH_DELIVERY(new NextRequest("https://tenant.test/api/tenant/club-demo/account/delivery-preference", { method: "PATCH" }), { params: Promise.resolve({ slug: "club-demo" }) })
  await POST_REQUEST(new NextRequest("https://tenant.test/api/tenant/club-demo/account/whatsapp/request-code", { method: "POST" }), { params: Promise.resolve({ slug: "club-demo" }) })
  await POST_VERIFY(new NextRequest("https://tenant.test/api/tenant/club-demo/account/whatsapp/verify-code", { method: "POST" }), { params: Promise.resolve({ slug: "club-demo" }) })

  assert.deepEqual(calls.map((call) => call.path), [
    "/api/tenant/club-demo/account",
    "/api/tenant/club-demo/account/password",
    "/api/tenant/club-demo/account/delivery-preference",
    "/api/tenant/club-demo/account/whatsapp/request-code",
    "/api/tenant/club-demo/account/whatsapp/verify-code",
  ])
})

test("tenant buyer delivery-preference proxy preserves backend verification errors", async () => {
  const nodeModule = Module as NodeModuleLoader
  const originalLoad = nodeModule._load

  nodeModule._load = function patchedLoad(request: string, parent: NodeModule | null, isMain: boolean) {
    if (request === "@/lib/backend-proxy") {
      return {
        proxyToBackend: async () => new Response(JSON.stringify({ error: "Necesitás verificar tu WhatsApp antes de elegir esta opción" }), { status: 400 }),
      }
    }

    return originalLoad.call(this, request, parent, isMain)
  }

  try {
    const delivery = require.resolve("@/app/api/tenant/[slug]/account/delivery-preference/route")
    delete require.cache[delivery]
    const PATCH = (require(delivery) as { PATCH: (req: NextRequest, ctx: { params: Promise<{ slug: string }> }) => Promise<Response> }).PATCH

    const response = await PATCH(new NextRequest("https://tenant.test/api/tenant/club-demo/account/delivery-preference", { method: "PATCH" }), { params: Promise.resolve({ slug: "club-demo" }) })

    assert.equal(response.status, 400)
    assert.deepEqual(await response.json(), { error: "Necesitás verificar tu WhatsApp antes de elegir esta opción" })
  } finally {
    nodeModule._load = originalLoad
  }
})
