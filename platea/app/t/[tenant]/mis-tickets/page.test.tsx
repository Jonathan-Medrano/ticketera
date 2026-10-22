import assert from "node:assert/strict"
import { createRequire } from "node:module"
import Module from "node:module"
import test from "node:test"
import type { ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"

const require = createRequire(import.meta.url)
type NodeModuleLoader = typeof Module & {
  _load: (request: string, parent: NodeModule | null, isMain: boolean) => unknown
}

test("buyer mis tickets page does not expose the refunds export action", async () => {
  const nodeModule = Module as NodeModuleLoader
  const originalLoad = nodeModule._load
  const calls: Array<string> = []

  nodeModule._load = function patchedLoad(request: string, parent: NodeModule | null, isMain: boolean) {
    if (request === "@/lib/buyer-session/server") {
      return {
        requireBuyerSessionForTenant: async (tenant: string, redirectTo: string) => {
          calls.push(`guard:${tenant}:${redirectTo}`)
          return { id: "buyer-1" }
        },
      }
    }

    if (request === "@/lib/server-backend") {
      return {
        fetchTenantBackendFromServer: async (path: string, tenant: string) => {
          calls.push(`fetch:${tenant}:${path}`)
          if (path.endsWith("/mis-consumibles")) return { data: { ventas: [] } }
          return { data: { entradas: [] } }
        },
      }
    }

    if (request === "@/components/tenant/tenant-navbar") {
      return function TenantNavbar() {
        return <div>Tenant navbar</div>
      }
    }

    if (request === "@/components/tenant/mis-tickets-content") {
      return {
        __esModule: true,
        default: () => <div>Mis tickets buyer refunds self-service</div>,
      }
    }

    return originalLoad.call(this, request, parent, isMain)
  }

  try {
    const modulePath = require.resolve("./page")
    delete require.cache[modulePath]
    const Page = (require(modulePath) as { default: (props: { params: Promise<{ tenant: string }> }) => Promise<ReactNode> }).default
    const markup = renderToStaticMarkup(await Page({ params: Promise.resolve({ tenant: "club-demo" }) }))

    assert.deepEqual(calls, [
      "guard:club-demo:mis-tickets",
      "fetch:club-demo:/api/tenant/club-demo/mis-tickets",
      "fetch:club-demo:/api/tenant/club-demo/mis-consumibles",
    ])
    assert.match(markup, /Mis tickets buyer refunds self-service/i)
    assert.doesNotMatch(markup, /Exportar CSV/i)
    assert.doesNotMatch(markup, /data-export-path=/i)
  } finally {
    nodeModule._load = originalLoad
  }
})
