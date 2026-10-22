import assert from "node:assert/strict"
import { createRequire } from "node:module"
import Module from "node:module"
import test from "node:test"
import { NextRequest } from "next/server"

const require = createRequire(import.meta.url)
type NodeModuleLoader = typeof Module & {
  _load: (request: string, parent: NodeModule | null, isMain: boolean) => unknown
}

test("consumibles export BFF route proxies to backend export in raw mode", async () => {
  const calls: Array<{ path: string; options?: unknown }> = []
  const nodeModule = Module as NodeModuleLoader
  const originalLoad = nodeModule._load

  nodeModule._load = function patchedLoad(request: string, parent: NodeModule | null, isMain: boolean) {
    if (request === "@/lib/backend-proxy") {
      return {
        proxyToBackend: async (_req: NextRequest, path: string, options?: unknown) => {
          calls.push({ path, options })
          return new Response("ok", { status: 200 })
        },
      }
    }

    return originalLoad.call(this, request, parent, isMain)
  }

  try {
    const modulePath = require.resolve("./route")
    delete require.cache[modulePath]
    const { GET } = require(modulePath) as {
      GET: (req: NextRequest) => Promise<Response>
    }

    await GET(new NextRequest("https://app.test/api/consumibles/ventas/export?vcBusqueda=gin"))

    assert.deepEqual(calls, [{ path: "/api/consumibles/ventas/export", options: { responseMode: "raw" } }])
  } finally {
    nodeModule._load = originalLoad
  }
})
