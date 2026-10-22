import assert from "node:assert/strict"
import { createRequire } from "node:module"
import Module from "node:module"
import test from "node:test"
import { renderToStaticMarkup } from "react-dom/server"

const require = createRequire(import.meta.url)
type NodeModuleLoader = typeof Module & {
  _load: (request: string, parent: NodeModule | null, isMain: boolean) => unknown
}

function loadConsumiblesVentasContent() {
  const nodeModule = Module as NodeModuleLoader
  const originalLoad = nodeModule._load

  nodeModule._load = function patchedLoad(request: string, parent: NodeModule | null, isMain: boolean) {
    if (request === "next/navigation") {
      return {
        usePathname: () => "/dashboard/consumibles/ventas",
        useRouter: () => ({ replace: () => undefined, refresh: () => undefined }),
        useSearchParams: () => new URLSearchParams(""),
      }
    }

    if (request === "@/components/loading-provider") {
      return {
        useLoading: () => ({ withLoading: async <T,>(callback: () => Promise<T> | T) => await callback() }),
      }
    }

    if (request === "@/components/ui/dialog") {
      return {
        Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
        DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
        DialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
        DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
        DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
        DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
      }
    }

    return originalLoad.call(this, request, parent, isMain)
  }

  try {
    const modulePath = require.resolve("./consumibles-ventas-content")
    delete require.cache[modulePath]
    return require(modulePath).default
  } finally {
    nodeModule._load = originalLoad
  }
}

test("Consumibles ventas detail shows delivered vs refunded trace for partially resolved sales", () => {
  const ConsumiblesVentasContent = loadConsumiblesVentasContent()
  const markup = renderToStaticMarkup(
    <ConsumiblesVentasContent
      initialDetalleVentaId="venta-1"
      ventas={[
        {
          id: "venta-1",
          clave_corta: "ABC123",
          estado: "resuelto_parcial",
          total: 6000,
          delivered_amount: 3000,
          refunded_amount: 3000,
          barra_nombre: "Barra Norte",
          evento_nombre: "Festival Demo",
          created_at: "2026-05-16T10:00:00.000Z",
          items: [
            {
              id: "item-1",
              consumible_nombre: "Cerveza",
              cantidad: 2,
              precio_unitario: 1500,
              subtotal: 3000,
              cantidad_entregada: 1,
              cantidad_reembolsada: 1,
            },
            {
              id: "item-2",
              consumible_nombre: "Papas",
              cantidad: 1,
              precio_unitario: 3000,
              subtotal: 3000,
              cantidad_entregada: 1,
              cantidad_reembolsada: 0,
            },
          ],
        },
      ]}
      eventos={[]}
      stats={{
        total_tickets: 1,
        total_neto_acreditado: 3000,
        total_bruto: 6000,
        total_pendientes: 0,
        total_canjeados: 0,
        total_cancelados: 0,
      }}
      ingresosPorEvento={[]}
      pagination={{ page: 1, pageSize: 25, total: 1, totalPages: 1 }}
    />
  )

  assert.match(markup, /Entregado: \$3\.000/)
  assert.match(markup, /Reembolsado: \$3\.000/)
  assert.match(markup, /Entregados: 1/)
  assert.match(markup, /Reembolsados: 1/)
  assert.match(markup, /Total cobrado/)
})

test("Consumibles ventas reads scoped search input without leaking global query keys", () => {
  const nodeModule = Module as NodeModuleLoader
  const originalLoad = nodeModule._load

  nodeModule._load = function patchedLoad(request: string, parent: NodeModule | null, isMain: boolean) {
    if (request === "next/navigation") {
      return {
        usePathname: () => "/dashboard/ventas",
        useRouter: () => ({ replace: () => undefined, refresh: () => undefined }),
        useSearchParams: () => new URLSearchParams("tab=consumibles&busqueda=global&vcBusqueda=gin%20tonic&vcPage=3"),
      }
    }

    if (request === "@/components/loading-provider") {
      return {
        useLoading: () => ({ withLoading: async <T,>(callback: () => Promise<T> | T) => await callback() }),
      }
    }

    if (request === "@/components/ui/dialog") {
      return {
        Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
        DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
        DialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
        DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
        DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
        DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
      }
    }

    return originalLoad.call(this, request, parent, isMain)
  }

  try {
    const modulePath = require.resolve("./consumibles-ventas-content")
    delete require.cache[modulePath]
    const ConsumiblesVentasContent = require(modulePath).default

    const markup = renderToStaticMarkup(
      <ConsumiblesVentasContent
        mode="tab"
        queryScope="consumibles"
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
        pagination={{ page: 3, pageSize: 25, total: 0, totalPages: 1 }}
      />
    )

    assert.match(markup, /value="gin tonic"/)
    assert.doesNotMatch(markup, /value="global"/)
  } finally {
    nodeModule._load = originalLoad
  }
})

test("ConsumiblesExportAction renders export CTA and modal filters", () => {
  const modulePath = require.resolve("./consumibles-ventas-content")
  delete require.cache[modulePath]
  const { ConsumiblesExportAction } = require(modulePath) as {
    ConsumiblesExportAction: (props: { exportPath: string; eventos: Array<{ id: string; nombre: string }> }) => React.ReactElement
  }
  const markup = renderToStaticMarkup(
    <ConsumiblesExportAction
      exportPath="/api/consumibles/ventas/export?busqueda=gin"
      eventos={[{ id: "evento-1", nombre: "Festival Uno" }]}
    />
  )

  assert.match(markup, /Exportar/)
  assert.match(markup, /Exportar Excel/)
  assert.match(markup, /data-export-path="\/api\/consumibles\/ventas\/export\?busqueda=gin"/)
  assert.match(markup, /Evento/)
  assert.match(markup, /Estado/)
  assert.match(markup, /Todo/)
  assert.match(markup, /Festival Uno/)
  assert.match(markup, /Todos los estados/)
})

test("Consumibles ventas tolerates null totals shaped by backend roles", () => {
  const ConsumiblesVentasContent = loadConsumiblesVentasContent()
  const markup = renderToStaticMarkup(
    <ConsumiblesVentasContent
      ventas={[
        {
          id: "venta-null-total",
          clave_corta: "NULL-001",
          estado: "pendiente",
          total: null,
          barra_nombre: "Barra Norte",
          evento_nombre: "Festival Demo",
          created_at: "2026-05-16T10:00:00.000Z",
          items: [],
        },
      ]}
      eventos={[]}
      stats={{
        total_tickets: 1,
        total_neto_acreditado: null,
        total_bruto: null,
        total_pendientes: 1,
        total_canjeados: 0,
        total_cancelados: 0,
      }}
      ingresosPorEvento={[]}
      pagination={{ page: 1, pageSize: 25, total: 1, totalPages: 1 }}
    />
  )

  assert.match(markup, /NULL-001/)
  assert.match(markup, /\$0/)
})

test("Consumibles ventas does not render export CTA inline on out-of-scope surfaces", () => {
  const ConsumiblesVentasContent = loadConsumiblesVentasContent()
  const markup = renderToStaticMarkup(
    <ConsumiblesVentasContent
      mode="tab"
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
    />
  )

  assert.match(markup, /Filtros/)
  assert.match(markup, />Buscar</)
  assert.doesNotMatch(markup, /data-export-path="\/api\/consumibles\/ventas\/export/)
})
