import assert from "node:assert/strict"
import { createRequire } from "node:module"
import Module from "node:module"
import test from "node:test"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"

import {
  buildRefundTimeline,
  filterAndSortRefundCases,
  getRefundAutomaticScopeLabel,
  getRefundBlockReasonLabel,
  getRefundOriginLabel,
  getRefundPaymentStatusLabel,
  getRefundReconciliationStatusLabel,
  requiresEvidenceForRefundExecution,
  getRefundStatusMeta,
  getRefundTargetStatusLabel,
  getRefundTargetTypeLabel,
  getRefundVisibleActions,
  resolveRefundExportErrorMessage,
  type RefundManualViewerAccess,
  type RefundManualCaseDetail,
} from "./reembolsos-model"

const companyAccess: RefundManualViewerAccess = {
  canCreateManualCases: true,
  canMutateEntryCases: true,
  canMutateBuyerConsumibleCases: true,
  canMutateCompanyConsumibleCases: true,
}

const employeeConsumiblesAccess: RefundManualViewerAccess = {
  canCreateManualCases: false,
  canMutateEntryCases: false,
  canMutateBuyerConsumibleCases: true,
  canMutateCompanyConsumibleCases: false,
}

const require = createRequire(import.meta.url)
type NodeModuleLoader = typeof Module & {
  _load: (request: string, parent: NodeModule | null, isMain: boolean) => unknown
}

function loadReembolsosContent() {
  const nodeModule = Module as NodeModuleLoader
  const originalLoad = nodeModule._load

  nodeModule._load = function patchedLoad(request: string, parent: NodeModule | null, isMain: boolean) {
    if (request === "next/navigation") {
      return {
        usePathname: () => "/dashboard/reembolsos",
        useRouter: () => ({ replace: () => undefined, refresh: () => undefined }),
        useSearchParams: () => new URLSearchParams("caseId=case-1"),
      }
    }

    if (request === "@/components/loading-provider") {
      return {
        useLoading: () => ({ withLoading: async <T,>(callback: () => Promise<T> | T) => await callback() }),
      }
    }

    if (request === "sonner") {
      return {
        toast: {
          success: () => undefined,
          error: () => undefined,
        },
      }
    }

    if (request === "@/components/ui/badge") {
      return {
        Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
      }
    }

    if (request === "@/components/ui/button") {
      return {
        Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
      }
    }

    if (request === "@/components/ui/input") {
      return {
        Input: () => <input />,
      }
    }

    if (request === "@/components/ui/label") {
      return {
        Label: ({ children }: { children: React.ReactNode }) => <label>{children}</label>,
      }
    }

    if (request === "@/components/ui/textarea") {
      return {
        Textarea: () => <textarea />,
      }
    }

    if (request === "@/components/ui/select") {
      return {
        Select: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
        SelectTrigger: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
        SelectValue: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
        SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
        SelectItem: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
      }
    }

    if (request === "@/components/ui/tooltip") {
      return {
        TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
        Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
        TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
        TooltipContent: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
      }
    }

    return originalLoad.call(this, request, parent, isMain)
  }

  try {
    const modulePath = require.resolve("./reembolsos-content")
    delete require.cache[modulePath]
    return require(modulePath).default
  } finally {
    nodeModule._load = originalLoad
  }
}

function buildDetail(overrides: Partial<RefundManualCaseDetail["case"]>, items: RefundManualCaseDetail["items"] = []): RefundManualCaseDetail {
  return {
    case: {
      id: "case-1",
      checkout_session_id: "cs-1",
      flow: "entradas",
      status: "requested",
      requested_amount: 12000,
      currency: "ARS",
      payment_id: "pay-1",
      payment_status: "approved",
      reconciliation_status: "approved",
      request_reason: "Comprador pidió devolución",
      request_note: null,
      external_refund_reference: null,
      evidence_note: null,
      requester_actor_id: "emp-1",
      requester_actor_type: "empresa",
      created_by: "emp-1",
      resolved_by: null,
      created_at: "2026-05-08T12:00:00.000Z",
      updated_at: "2026-05-08T12:00:00.000Z",
      resolved_at: null,
      ...overrides,
    },
    purchase_context: null,
    items,
    events: [],
  }
}

test("getRefundStatusMeta reflects consumables MVP terminal state", () => {
  const meta = getRefundStatusMeta("resolved_non_refundable")

  assert.equal(meta.label, "No reembolsable (MVP)")
  assert.match(meta.className, /violet/i)
})

test("requested ticket cases show refund and rejection actions only", () => {
  const actions = getRefundVisibleActions(buildDetail({ flow: "entradas", status: "requested" }), companyAccess)

  assert.deepEqual(actions.map((action) => action.id), ["reject", "execute"])
  assert.equal(actions[0]?.label, "Rechazar reembolso")
  assert.equal(actions[1]?.label, "Reembolsar")
  assert.equal(actions[1]?.disabled, true)
  assert.match(actions[1]?.disabledReason ?? "", /El caso no tiene items vinculados para ejecutar/)
})

test("approved ticket cases show refund action only when items are eligible", () => {
  const detail = buildDetail(
      { flow: "entradas", status: "approved_for_manual_execution" },
      [
        {
          id: "item-1",
          case_id: "case-1",
          target_type: "entrada",
          target_id: "en-1",
          target_status_before: "valida",
          target_status_after: null,
          eligibility: "elegible",
          block_reason: null,
          amount_snapshot: 12000,
          created_at: "2026-05-08T12:30:00.000Z",
        },
      ]
    )

  const actions = getRefundVisibleActions(detail, companyAccess)

  assert.deepEqual(actions.map((action) => action.id), ["reject", "execute"])
  assert.equal(actions[0]?.disabled, false)
  assert.equal(actions[1]?.disabled, false)
  assert.equal(actions[1]?.label, "Reembolsar")
  assert.equal(requiresEvidenceForRefundExecution(detail), false)
})

test("company-manual consumables cases still expose non-refundable resolution only", () => {
  const actions = getRefundVisibleActions(buildDetail({ flow: "consumibles", status: "under_review", request_origin: "company_manual" }), companyAccess)

  assert.deepEqual(actions.map((action) => action.id), ["reject", "resolve_non_refundable"])
  assert.equal(actions.some((action) => action.id === "execute"), false)
})

test("buyer consumable refund cases expose manual execute without auto-refund approval step", () => {
  const actions = getRefundVisibleActions(buildDetail({ flow: "consumibles", status: "under_review", request_origin: "buyer_consumible_request" }), employeeConsumiblesAccess)

  assert.deepEqual(actions.map((action) => action.id), ["reject", "execute"])
  assert.equal(actions.some((action) => action.id === "approve"), false)
  assert.equal(actions.find((action) => action.id === "execute")?.label, "Reembolsar")
  assert.equal(actions.find((action) => action.id === "reject")?.label, "Rechazar reembolso")
})

test("buildRefundTimeline maps backend events to readable dashboard labels", () => {
  const timeline = buildRefundTimeline([
    {
      id: "evt-1",
      case_id: "case-1",
      event_type: "case_requested",
      actor_id: "emp-1",
      actor_type: "empresa",
      payload: { reason: "Comprador pidió devolución" },
      created_at: "2026-05-08T12:00:00.000Z",
    },
    {
      id: "evt-2",
      case_id: "case-1",
      event_type: "case_rejected",
      actor_id: "emp-1",
      actor_type: "empresa",
      payload: {
        previous_status: "under_review",
        next_status: "rejected",
        external_refund_reference: "AUD-123",
      },
      created_at: "2026-05-08T13:00:00.000Z",
    },
  ])

  assert.equal(timeline[0]?.title, "Caso solicitado")
  assert.match(timeline[0]?.detail ?? "", /Motivo: Comprador pidió devolución/)
  assert.equal(timeline[1]?.title, "Caso rechazado")
  assert.match(timeline[1]?.detail ?? "", /Referencia: AUD-123/)
})

test("buyer-origin refunds expose readable origin labels", () => {
  assert.equal(getRefundOriginLabel("buyer_event_request"), "Comprador")
  assert.equal(getRefundOriginLabel("company_manual"), "Manual empresa")
  assert.equal(getRefundOriginLabel("bar_stockout_auto"), "Faltante en barra")
})

test("non-entry details keep manual evidence requirements", () => {
  assert.equal(requiresEvidenceForRefundExecution(buildDetail({ flow: "consumibles", status: "under_review" })), true)
})

test("employees only mutate buyer consumible cases when access is consumibles-scoped", () => {
  const buyerCaseActions = getRefundVisibleActions(
    buildDetail({ flow: "consumibles", status: "requested", request_origin: "buyer_consumible_request" }),
    employeeConsumiblesAccess
  )
  const companyManualActions = getRefundVisibleActions(
    buildDetail({ flow: "consumibles", status: "requested", request_origin: "company_manual" }),
    employeeConsumiblesAccess
  )
  const entryActions = getRefundVisibleActions(buildDetail({ flow: "entradas", status: "requested" }), employeeConsumiblesAccess)

  assert.deepEqual(buyerCaseActions.map((action) => action.id), ["reject", "execute"])
  assert.deepEqual(companyManualActions, [])
  assert.deepEqual(entryActions, [])
})

test("refund dashboard labels payment and item data in Spanish", () => {
  assert.equal(getRefundPaymentStatusLabel("approved"), "Aprobado")
  assert.equal(getRefundReconciliationStatusLabel("reconciled"), "Conciliado")
  assert.equal(getRefundTargetTypeLabel("entrada"), "Entrada")
  assert.equal(getRefundTargetStatusLabel("cancelada"), "Cancelada")
  assert.equal(getRefundBlockReasonLabel("entrada_usada"), "Entrada usada")
  assert.equal(getRefundAutomaticScopeLabel("todos"), "Todos")
})

test("refund case filters support query, buyer, event, flow and date sorting", () => {
  const cases = [
    {
      ...buildDetail({
        id: "case-1",
        flow: "entradas",
        request_reason: "No voy a asistir",
        checkout_session_id: "cs-1",
        created_at: "2026-05-10T10:00:00.000Z",
        requested_event_name: "Festival Uno",
        buyer_name: "Juan Pérez",
      }).case,
    },
    {
      ...buildDetail({
        id: "case-2",
        flow: "consumibles",
        request_reason: "Error en barra",
        checkout_session_id: "cs-2",
        created_at: "2026-05-12T10:00:00.000Z",
        requested_event_name: "Festival Dos",
        buyer_name: "Ana Gómez",
      }).case,
    },
  ]

  const filtered = filterAndSortRefundCases(cases, {
    query: "barra",
    buyer: "ana",
    event: "Festival Dos",
    flow: "consumibles",
    sortOrder: "date_asc",
  })

  assert.equal(filtered.length, 1)
  assert.equal(filtered[0]?.id, "case-2")

  const sorted = filterAndSortRefundCases(cases, {
    query: "",
    buyer: "",
    event: "all",
    flow: "all",
    sortOrder: "date_desc",
  })

  assert.deepEqual(sorted.map((refundCase) => refundCase.id), ["case-2", "case-1"])
})

test("Reembolsos renders stock-shortage automatic refunds for operators", () => {
  const ReembolsosContent = loadReembolsosContent()
  const detail = buildDetail({
    id: "case-1",
    flow: "consumibles",
    status: "executed",
    request_origin: "bar_stockout_auto",
    request_reason: "Refund automático por faltante",
    requested_amount: 3000,
    buyer_name: "Ana Gómez",
    requested_event_name: "Festival Demo",
  })

  const markup = renderToStaticMarkup(
    <ReembolsosContent
      cases={[detail.case]}
      selectedCase={detail}
      access={companyAccess}
      automaticRefundConfig={{ enabled: false, mode: "manual", scope: "todos" }}
      initialFilters={{ query: "", buyer: "", event: "all", flow: "all", sortOrder: "date_desc" }}
      exportPath={null}
    />
  )

  assert.match(markup, /Refund automático por faltante/)
  assert.match(markup, /Faltante en barra/)
  assert.match(markup, /Caso: case-1/)
  assert.match(markup, /Checkout: cs-1/)
})

test("Reembolsos renders updated consumibles guidance copy", () => {
  const ReembolsosContent = loadReembolsosContent()
  const detail = buildDetail({
    id: "case-cons-1",
    flow: "consumibles",
    status: "requested",
    request_origin: "buyer_consumible_request",
    request_reason: "No voy a retirar todo",
  })

  const markup = renderToStaticMarkup(
    <ReembolsosContent
      cases={[detail.case]}
      selectedCase={detail}
      access={employeeConsumiblesAccess}
      automaticRefundConfig={{ enabled: false, mode: "manual", scope: "todos" }}
      initialFilters={{ query: "", buyer: "", event: "all", flow: "all", sortOrder: "date_desc" }}
      exportPath={null}
    />
  )

  assert.match(markup, /Comprador consumibles/i)
  assert.match(markup, /Reembolsar/i)
})

test("Reembolsos renders automatic refund policy controls below manual case card", () => {
  const ReembolsosContent = loadReembolsosContent()
  const detail = buildDetail({ flow: "entradas", status: "requested" })

  const markup = renderToStaticMarkup(
    <ReembolsosContent
      cases={[detail.case]}
      selectedCase={detail}
      access={companyAccess}
      automaticRefundConfig={{ enabled: true, mode: "entradas", scope: "entradas" }}
      initialFilters={{ query: "", buyer: "", event: "all", flow: "all", sortOrder: "date_desc" }}
      exportPath={null}
    />
  )

  assert.match(markup, /Reembolsos automáticos/i)
  assert.match(markup, /Aplicar a/i)
  assert.match(markup, /entradas/i)
})

test("Reembolsos renders export CTA only when export path is available", () => {
  const ReembolsosContent = loadReembolsosContent()
  const detail = buildDetail({ flow: "entradas", status: "requested" })

  const withExport = renderToStaticMarkup(
    <ReembolsosContent
      cases={[detail.case]}
      selectedCase={detail}
      access={companyAccess}
      automaticRefundConfig={{ enabled: false, mode: "manual", scope: "todos" }}
      initialFilters={{ query: "", buyer: "", event: "all", flow: "all", sortOrder: "date_desc" }}
      exportPath="/api/reembolsos/export?query=ana"
    />
  )
  const withoutExport = renderToStaticMarkup(
    <ReembolsosContent
      cases={[detail.case]}
      selectedCase={detail}
      access={companyAccess}
      automaticRefundConfig={{ enabled: false, mode: "manual", scope: "todos" }}
      initialFilters={{ query: "", buyer: "", event: "all", flow: "all", sortOrder: "date_desc" }}
      exportPath={null}
    />
  )

  assert.match(withExport, /Exportar CSV/i)
  assert.match(withExport, /data-export-path="\/api\/reembolsos\/export\?query=ana"/i)
  assert.doesNotMatch(withoutExport, /Exportar CSV/i)
  assert.doesNotMatch(withoutExport, /data-export-path=/i)
})

test("refund export errors resolve refined backend messages before generic fallback", () => {
  assert.equal(
    resolveRefundExportErrorMessage({ error: "Refiná filtros para exportar hasta 1 caso", code: "export_limit_exceeded" }),
    "Refiná filtros para exportar hasta 1 caso"
  )
  assert.equal(
    resolveRefundExportErrorMessage({ message: "sin payload útil" }),
    "No pudimos exportar los reembolsos. Reintentá en unos segundos."
  )
})
