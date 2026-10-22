import assert from "node:assert/strict"
import { createRequire } from "node:module"
import Module from "node:module"
import test from "node:test"
import { renderToStaticMarkup } from "react-dom/server"

const require = createRequire(import.meta.url)
type NodeModuleLoader = typeof Module & {
  _load: (request: string, parent: NodeModule | null, isMain: boolean) => unknown
}

function MockNextLink({ children, href, ...props }: { children: React.ReactNode; href: string }) {
  return <a href={href} {...props}>{children}</a>
}

function loadModule<T>(
  moduleRelativePath: string,
  search = "tab=entradas&vePage=2&vcPage=4&vcBusqueda=gin&vcEstado=pendiente"
) {
  const nodeModule = Module as NodeModuleLoader
  const originalLoad = nodeModule._load

  nodeModule._load = function patchedLoad(request: string, parent: NodeModule | null, isMain: boolean) {
    if (request === "next/navigation") {
      return {
        usePathname: () => "/dashboard/ventas",
        useRouter: () => ({ replace: () => undefined, refresh: () => undefined }),
        useSearchParams: () => new URLSearchParams(search),
      }
    }

    if (request === "next/link") {
      return MockNextLink
    }

    if (request === "@/components/loading-provider") {
      return {
        useLoading: () => ({
          withLoading: async <T,>(work: () => Promise<T>) => work(),
        }),
      }
    }

    return originalLoad.call(this, request, parent, isMain)
  }

  try {
    const modulePath = require.resolve(moduleRelativePath)
    delete require.cache[modulePath]
    return require(modulePath).default as T
  } finally {
    nodeModule._load = originalLoad
  }
}

function loadVentasTabsShell(search = "tab=entradas&vePage=2&vcPage=4&vcBusqueda=gin&vcEstado=pendiente") {
  return loadModule<(props: {
    tabs: Array<{ id: "entradas" | "consumibles"; label: string }>
    activeTab: "entradas" | "consumibles"
    children: React.ReactNode
  }) => React.ReactNode>("./ventas-tabs-shell", search)
}

function loadConsumiblesVentasContent(search = "tab=consumibles&vcPage=4") {
  return loadModule<(props: {
    ventas: []
    eventos: []
    stats: {
      total_tickets: number
      total_neto_acreditado: number
      total_bruto: number
      total_pendientes: number
      total_canjeados: number
      total_cancelados: number
    }
    ingresosPorEvento: []
    pagination: { page: number; pageSize: number; total: number; totalPages: number }
    mode: "tab"
    queryScope: "consumibles"
    recoverableError: string
  }) => React.ReactNode>("./consumibles-ventas-content", search)
}

test("VentasTabsShell renders both tabs and preserves independent query state in tab hrefs", () => {
  const VentasTabsShell = loadVentasTabsShell()
  const markup = renderToStaticMarkup(
    <VentasTabsShell
      activeTab="entradas"
      tabs={[
        { id: "entradas", label: "Entradas" },
        { id: "consumibles", label: "Consumibles" },
      ]}
    >
      <div>Entradas body</div>
    </VentasTabsShell>
  )

  assert.match(markup, />Ventas</)
  assert.match(markup, /href="\/dashboard\/ventas\?tab=entradas&amp;vePage=2&amp;vcPage=4&amp;vcBusqueda=gin&amp;vcEstado=pendiente"/)
  assert.match(markup, /href="\/dashboard\/ventas\?tab=consumibles&amp;vePage=2&amp;vcPage=4&amp;vcBusqueda=gin&amp;vcEstado=pendiente"/)
  assert.match(markup, /aria-selected="true"[^>]*>Entradas</)
  assert.match(markup, />Consumibles</)
})

test("VentasTabsShell hides forbidden tabs instead of rendering broken placeholders", () => {
  const VentasTabsShell = loadVentasTabsShell("tab=consumibles&vcPage=4")
  const markup = renderToStaticMarkup(
    <VentasTabsShell
      activeTab="consumibles"
      tabs={[{ id: "consumibles", label: "Consumibles" }]}
    >
      <div role="alert">No pudimos cargar las ventas de consumibles</div>
    </VentasTabsShell>
  )

  assert.doesNotMatch(markup, />Entradas</)
  assert.match(markup, />Consumibles</)
  assert.match(markup, /No pudimos cargar las ventas de consumibles/)
})

test("VentasTabsShell keeps the shell usable when consumibles render a recoverable state", () => {
  const VentasTabsShell = loadVentasTabsShell("tab=consumibles&vcPage=4")
  const ConsumiblesVentasContent = loadConsumiblesVentasContent("tab=consumibles&vcPage=4")
  const markup = renderToStaticMarkup(
    <VentasTabsShell
      activeTab="consumibles"
      tabs={[
        { id: "entradas", label: "Entradas" },
        { id: "consumibles", label: "Consumibles" },
      ]}
    >
      <ConsumiblesVentasContent
        ventas={[]}
        eventos={[]}
        stats={{
          total_tickets: 0,
          total_neto_acreditado: 0,
          total_bruto: 0,
          total_pendientes: 0,
          total_canjeados: 0,
          total_cancelados: 0,
        }}
        ingresosPorEvento={[]}
        pagination={{ page: 1, pageSize: 25, total: 0, totalPages: 1 }}
        mode="tab"
        queryScope="consumibles"
        recoverableError="Reintentá actualizando la página."
      />
    </VentasTabsShell>
  )

  assert.match(markup, />Ventas</)
  assert.match(markup, /href="\/dashboard\/ventas\?tab=entradas&amp;vcPage=4"/)
  assert.match(markup, /href="\/dashboard\/ventas\?tab=consumibles&amp;vcPage=4"/)
  assert.match(markup, /Podés cambiar de tab sin perder los filtros propios de consumibles\./)
  assert.match(markup, /No pudimos cargar las ventas de consumibles/)
})
