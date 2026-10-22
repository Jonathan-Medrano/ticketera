import assert from "node:assert/strict"
import { createRequire } from "node:module"
import Module from "node:module"
import test from "node:test"
import { NextRequest } from "next/server"

const require = createRequire(import.meta.url)
type NodeModuleLoader = typeof Module & {
  _load: (request: string, parent: NodeModule | null, isMain: boolean) => unknown
}

async function loadRouteHandler<T>(moduleRelativePath: string, exportName: string, calls: Array<{ path: string; options?: unknown }>) {
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
    const modulePath = require.resolve(moduleRelativePath)
    delete require.cache[modulePath]
    const loaded = require(modulePath) as Record<string, T>
    return loaded[exportName]
  } finally {
    nodeModule._load = originalLoad
  }
}

test("tenant account BFF routes proxy each handler to the expected backend path", async () => {
  const calls: Array<{ path: string; options?: unknown }> = []
  const GET = await loadRouteHandler<(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) => Promise<Response>>("./route", "GET", calls)
  const PATCH_PASSWORD = await loadRouteHandler<(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) => Promise<Response>>("./password/route", "PATCH", calls)
  const PATCH_DELIVERY = await loadRouteHandler<(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) => Promise<Response>>("./delivery-preference/route", "PATCH", calls)
  const POST_REQUEST = await loadRouteHandler<(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) => Promise<Response>>("./whatsapp/request-code/route", "POST", calls)
  const POST_VERIFY = await loadRouteHandler<(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) => Promise<Response>>("./whatsapp/verify-code/route", "POST", calls)

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
