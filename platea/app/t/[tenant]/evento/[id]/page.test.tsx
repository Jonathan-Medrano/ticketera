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

test("public tenant event page does not expose the refunds export action", async () => {
  const nodeModule = Module as NodeModuleLoader
  const originalLoad = nodeModule._load
  const calls: Array<string> = []

  nodeModule._load = function patchedLoad(request: string, parent: NodeModule | null, isMain: boolean) {
    if (request === "@/lib/server-backend") {
      return {
        fetchPublicBackendFromServer: async (path: string) => {
          calls.push(path)
          if (path.endsWith("/consumibles")) return { data: { barras: [] } }
          return {
            data: {
              evento: {
                id: "evt-1",
                nombre: "Festival Demo",
                venta_consumibles_habilitada: 0,
                publication_status: "live",
                publication_reason: "live",
                is_listed: true,
                is_detail_visible: true,
                is_checkout_open: true,
                publication: {
                  mode: "immediate",
                  pre_publish_visibility: "detail_visible",
                  publish_at_utc: null,
                  publish_timezone: null,
                  published_live_at: null,
                },
                buyer_event_refunds_enabled: 1,
                company_buyer_event_refunds_enabled: 1,
              },
              categorias: [],
              fechas: [],
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

    if (request === "@/components/tenant/evento-detalle") {
      return {
        __esModule: true,
        default: () => <div>Evento público con reembolsos para compradores</div>,
      }
    }

    if (request === "next/navigation") {
      return { notFound: () => { throw new Error("notFound should not run") } }
    }

    return originalLoad.call(this, request, parent, isMain)
  }

  try {
    const modulePath = require.resolve("./page")
    delete require.cache[modulePath]
    const Page = (require(modulePath) as { default: (props: { params: Promise<{ tenant: string; id: string }> }) => Promise<ReactNode> }).default
    const markup = renderToStaticMarkup(await Page({ params: Promise.resolve({ tenant: "club-demo", id: "evt-1" }) }))

    assert.deepEqual(calls, [
      "/api/tenant/club-demo/evento/evt-1",
      "/api/tenant/club-demo/evento/evt-1/consumibles",
    ])
    assert.match(markup, /Evento público con reembolsos para compradores/i)
    assert.doesNotMatch(markup, /Exportar CSV/i)
    assert.doesNotMatch(markup, /data-export-path=/i)
  } finally {
    nodeModule._load = originalLoad
  }
})
