import assert from "node:assert/strict"
import { createRequire } from "node:module"
import Module from "node:module"
import test from "node:test"
import { renderToStaticMarkup } from "react-dom/server"

const require = createRequire(import.meta.url)
type NodeModuleLoader = typeof Module & {
  _load: (request: string, parent: NodeModule | null, isMain: boolean) => unknown
}

function loadEntradasContent() {
  const nodeModule = Module as NodeModuleLoader
  const originalLoad = nodeModule._load

  nodeModule._load = function patchedLoad(request: string, parent: NodeModule | null, isMain: boolean) {
    if (request === "next/navigation") {
      return {
        usePathname: () => "/dashboard/ventas",
        useRouter: () => ({ replace: () => undefined }),
        useSearchParams: () => new URLSearchParams("tab=entradas&vePage=2"),
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
    const modulePath = require.resolve("./entradas-content")
    delete require.cache[modulePath]
    return require(modulePath).default
  } finally {
    nodeModule._load = originalLoad
  }
}

test("resolveEntradasExportFilename keeps the backend attachment name when present", () => {
  const modulePath = require.resolve("./entradas-content")
  delete require.cache[modulePath]
  const { resolveEntradasExportFilename } = require(modulePath) as {
    resolveEntradasExportFilename: (disposition: string | null | undefined) => string
  }

  assert.equal(
    resolveEntradasExportFilename('attachment; filename="entradas-export-2026-05-19.xlsx"'),
    "entradas-export-2026-05-19.xlsx"
  )
})

test("resolveEntradasExportFilename falls back to the dated XLSX format", () => {
  const modulePath = require.resolve("./entradas-content")
  delete require.cache[modulePath]
  const { resolveEntradasExportFilename } = require(modulePath) as {
    resolveEntradasExportFilename: (disposition: string | null | undefined) => string
  }

  assert.match(resolveEntradasExportFilename(null), /^entradas-export-\d{4}-\d{2}-\d{2}\.xlsx$/)
})

test("EntradasContent hides the standalone heading when rendered inside ventas tabs", () => {
  const EntradasContent = loadEntradasContent()
  const markup = renderToStaticMarkup(
    <EntradasContent
      mode="tab"
      entradas={[]}
      eventos={[]}
      stats={{
        total_entradas: 0,
        total_neto_acreditado: 0,
        total_bruto: 0,
        total_validas: 0,
        total_usadas: 0,
        total_canceladas: 0,
      }}
      pagination={{ page: 1, pageSize: 25, total: 0, totalPages: 1 }}
    />
  )

  assert.doesNotMatch(markup, />Entradas<\/h1>/)
  assert.match(markup, />0 entradas en total</)
})

test("EntradasContent reads the scoped search value for ventas tabs", () => {
  const nodeModule = Module as NodeModuleLoader
  const originalLoad = nodeModule._load

  nodeModule._load = function patchedLoad(request: string, parent: NodeModule | null, isMain: boolean) {
    if (request === "next/navigation") {
      return {
        usePathname: () => "/dashboard/ventas",
        useRouter: () => ({ replace: () => undefined }),
        useSearchParams: () => new URLSearchParams("tab=entradas&veBusqueda=ana%20maria&vePage=2"),
      }
    }

    return originalLoad.call(this, request, parent, isMain)
  }

  try {
    const modulePath = require.resolve("./entradas-content")
    delete require.cache[modulePath]
    const EntradasContent = require(modulePath).default

    const markup = renderToStaticMarkup(
      <EntradasContent
        mode="tab"
        queryScope="entradas"
        entradas={[]}
        eventos={[]}
        stats={{
          total_entradas: 0,
          total_neto_acreditado: 0,
          total_bruto: 0,
          total_validas: 0,
          total_usadas: 0,
          total_canceladas: 0,
        }}
        pagination={{ page: 2, pageSize: 25, total: 0, totalPages: 1 }}
      />
    )

    assert.match(markup, /value="ana maria"/)
  } finally {
    nodeModule._load = originalLoad
  }
})

test("EntradasExportAction renders the export CTA and modal controls", () => {
  const modulePath = require.resolve("./entradas-content")
  delete require.cache[modulePath]
  const { EntradasExportAction } = require(modulePath) as {
    EntradasExportAction: (props: { exportPath: string; eventos: Array<{ id: string; nombre: string }> }) => React.ReactElement
  }
  const markup = renderToStaticMarkup(
    <EntradasExportAction
      exportPath="/api/entradas/export?busqueda=ana"
      eventos={[{ id: "evento-1", nombre: "Festival Uno" }]}
    />
  )

  assert.match(markup, />Exportar</)
  assert.match(markup, /Filtros/)
  assert.match(markup, />Buscar</)
  assert.match(markup, /data-export-path="\/api\/entradas\/export\?busqueda=ana"/)
  assert.match(markup, /data-export-formats="xlsx,csv"/)
  assert.match(markup, /data-export-all-period="true"/)
  assert.match(markup, /data-export-event="todos"/)
  assert.match(markup, /data-export-state="todos"/)
  assert.match(markup, /Todo/)
  assert.match(markup, /Desde/)
  assert.match(markup, /Hasta/)
  assert.match(markup, /Evento/)
  assert.match(markup, /Estado/)
  assert.match(markup, /Festival Uno/)
  assert.match(markup, /type="date"/)
  assert.match(markup, /Todos los estados/)
})

test("EntradasContent does not render export CTA inline on tab surfaces", () => {
  const EntradasContent = loadEntradasContent()
  const markup = renderToStaticMarkup(
    <EntradasContent
      mode="tab"
      entradas={[]}
      eventos={[]}
      stats={{
        total_entradas: 0,
        total_neto_acreditado: 0,
        total_bruto: 0,
        total_validas: 0,
        total_usadas: 0,
        total_canceladas: 0,
      }}
      pagination={{ page: 1, pageSize: 25, total: 0, totalPages: 1 }}
    />
  )

  assert.doesNotMatch(markup, /data-export-formats="xlsx,csv"/)
})
