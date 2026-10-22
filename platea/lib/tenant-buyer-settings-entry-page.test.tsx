import assert from "node:assert/strict"
import { createRequire } from "node:module"
import Module from "node:module"
import test from "node:test"
import React from "react"
import type { ReactElement } from "react"
import type { ReactNode } from "react"

const require = createRequire(import.meta.url)
type NodeModuleLoader = typeof Module & {
  _load: (request: string, parent: NodeModule | null, isMain: boolean) => unknown
}

class RedirectError extends Error {
  constructor(readonly location: string) {
    super(location)
  }
}

type MockProps = {
  children?: ReactNode | RenderedNode | Array<RenderedNode>
  [key: string]: unknown
}

type RenderedNode =
  | string
  | number
  | boolean
  | null
  | undefined
  | { type: unknown; props: MockProps }

async function resolveNode(node: unknown): Promise<RenderedNode | Array<RenderedNode>> {
  if (Array.isArray(node)) {
    return Promise.all(node.map((entry) => resolveNode(entry) as Promise<RenderedNode>))
  }

  if (node === null || node === undefined || typeof node === "string" || typeof node === "number" || typeof node === "boolean") {
    return node
  }

  if (!React.isValidElement(node)) {
    return null
  }

  const element = node as ReactElement<MockProps>

  if (typeof element.type === "function") {
    return resolveNode(await (element.type as (props: MockProps) => unknown)(element.props))
  }

  return {
    type: element.type,
    props: {
      ...element.props,
      children: await Promise.all(React.Children.toArray(element.props.children as ReactNode).map((child) => resolveNode(child) as Promise<RenderedNode>)),
    },
  }
}

test("host-resolved /configuracion entry keeps anonymous buyers on the allowed tenant auth redirect", async () => {
  const nodeModule = Module as NodeModuleLoader
  const originalLoad = nodeModule._load
  const redirectCalls: string[] = []
  const guardCalls: Array<{ tenant: string; redirectTo: string }> = []

  nodeModule._load = function patchedLoad(request: string, parent: NodeModule | null, isMain: boolean) {
    if (request === "next/navigation") {
      return {
        redirect: (location: string) => {
          redirectCalls.push(location)
          throw new RedirectError(location)
        },
      }
    }

    if (request === "@/lib/tenant-host") {
      return {
        resolveTenantFromHost: async () => "club-demo",
      }
    }

    if (request === "@/lib/buyer-session/server") {
      return {
        requireBuyerSessionForTenant: async (tenant: string, redirectTo: string) => {
          guardCalls.push({ tenant, redirectTo })
          throw new RedirectError(`/t/${tenant}/auth?redirect=%2Fconfiguracion`)
        },
      }
    }

    if (request === "@/lib/server-backend") {
      return {
        fetchTenantBackendFromServer: async () => {
          throw new Error("backend fetch should not run for anonymous redirect")
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
        default: function TenantBuyerSettingsContent() {
          return <div>Buyer settings content</div>
        },
      }
    }

    if (request === "@/components/tenant/tenant-surface-shell") {
      return function TenantSurfaceShell({ children }: { children: React.ReactNode }) {
        return <div>{children}</div>
      }
    }

    return originalLoad.call(this, request, parent, isMain)
  }

  try {
    const modulePath = require.resolve("@/app/configuracion/page")
    delete require.cache[modulePath]
    const Page = (require(modulePath) as { default: () => Promise<ReactNode> }).default

    await assert.rejects(async () => {
      await resolveNode(await Page())
    }, (error: unknown) => {
      assert.ok(error instanceof RedirectError)
      assert.equal((error as RedirectError).location, "/t/club-demo/auth?redirect=%2Fconfiguracion")
      return true
    })

    assert.deepEqual(guardCalls, [{ tenant: "club-demo", redirectTo: "configuracion" }])
    assert.deepEqual(redirectCalls, [])
  } finally {
    nodeModule._load = originalLoad
  }
})
