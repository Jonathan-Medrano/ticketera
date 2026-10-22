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

test("tenant buyer settings page guards auth and renders the backend snapshot", async () => {
  const nodeModule = Module as NodeModuleLoader
  const originalLoad = nodeModule._load
  const calls: Array<string> = []

  nodeModule._load = function patchedLoad(request: string, parent: NodeModule | null, isMain: boolean) {
    if (request === "@/lib/buyer-session/server") {
      return {
        requireBuyerSessionForTenant: async (tenant: string, redirectTo: string) => {
          calls.push(`guard:${tenant}:${redirectTo}`)
          return { id: "cmp-1" }
        },
      }
    }

    if (request === "@/lib/server-backend") {
      return {
        fetchTenantBackendFromServer: async (path: string, tenant: string) => {
          calls.push(`fetch:${tenant}:${path}`)
          return {
            data: {
              buyer: {
                email: "buyer@example.com",
                name: "Comprador Demo",
                phoneE164: "+5491155554444",
                phoneVerifiedAt: "2026-05-18T10:00:00.000Z",
                deliveryPreference: "both",
              },
              whatsappVerification: {
                providerAvailable: true,
              },
            },
          }
        },
      }
    }

    if (request === "@/components/tenant/tenant-navbar") {
      return function TenantNavbar() {
        return <div>Tenant navbar</div>
      }
    }

    if (request === "@/components/tenant/tenant-buyer-settings-content") {
      return {
        __esModule: true,
        default: ({ initialSnapshot }: { initialSnapshot: { buyer: { email: string } } }) => <div>Buyer settings {initialSnapshot.buyer.email}</div>,
      }
    }

    return originalLoad.call(this, request, parent, isMain)
  }

  try {
    const modulePath = require.resolve("@/app/t/[tenant]/configuracion/page")
    delete require.cache[modulePath]
    const Page = (require(modulePath) as { default: (props: { params: Promise<{ tenant: string }> }) => Promise<ReactNode> }).default
    const markup = renderToStaticMarkup(await Page({ params: Promise.resolve({ tenant: "club-demo" }) }))

    assert.deepEqual(calls, [
      "guard:club-demo:configuracion",
      "fetch:club-demo:/api/tenant/club-demo/account",
    ])
    assert.match(markup, /Tenant navbar/)
    assert.match(markup, /Buyer settings buyer@example.com/)
  } finally {
    nodeModule._load = originalLoad
  }
})
