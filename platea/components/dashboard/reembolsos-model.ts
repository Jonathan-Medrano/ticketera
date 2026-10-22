export type RefundManualFlow = "entradas" | "consumibles"
export type RefundAutomaticScope = "consumibles" | "entradas" | "todos"
export type RefundAutomaticMode = "manual" | RefundAutomaticScope

export type RefundAutomaticConfig = {
  enabled: boolean
  mode: RefundAutomaticMode
  scope: RefundAutomaticScope
}

export function getRefundAutomaticScopeLabel(scope: RefundAutomaticScope) {
  switch (scope) {
    case "consumibles":
      return "Consumibles"
    case "entradas":
      return "Entradas"
    case "todos":
      return "Todos"
  }
}

export type RefundManualStatus =
  | "requested"
  | "under_review"
  | "approved_for_manual_execution"
  | "rejected"
  | "executed"
  | "resolved_non_refundable"

export type RefundManualCaseSummary = {
  id: string
  checkout_session_id: string
  flow: RefundManualFlow
  status: RefundManualStatus
  requested_amount: number
  currency: string
  payment_id?: string | null
  payment_status?: string | null
  reconciliation_status?: string | null
  request_reason: string
  request_note?: string | null
  request_origin?: "company_manual" | "buyer_event_request" | "buyer_consumible_request" | "bar_stockout_auto"
  external_refund_reference?: string | null
  evidence_note?: string | null
  requester_actor_id: string
  requester_actor_type: string
  requester_buyer_id?: string | null
  buyer_name?: string | null
  buyer_email?: string | null
  requested_event_id?: string | null
  requested_event_name?: string | null
  requested_entry_id?: string | null
  requested_entry_label?: string | null
  company_policy_snapshot?: number
  event_policy_snapshot?: number
  created_by: string
  resolved_by?: string | null
  created_at: string
  updated_at: string
  resolved_at?: string | null
}

export type RefundManualCaseItem = {
  id: string
  case_id: string
  target_type: "entrada" | "consumible_venta"
  target_id: string
  target_status_before?: string | null
  target_status_after?: string | null
  eligibility: string
  block_reason?: string | null
  amount_snapshot?: number | null
  created_at: string
}

export type RefundManualCaseEvent = {
  id: string
  case_id: string
  event_type: string
  actor_id: string
  actor_type: string
  payload?: Record<string, unknown> | null
  created_at: string
}

export type RefundManualPurchaseContext = {
  checkout_session_id: string
  flow: RefundManualFlow
  checkout_status: string
  confirmed_at?: string | null
  payment_id?: string | null
  payment_status?: string | null
  reconciliation_status?: string | null
  requested_amount: number
  currency: string
  buyer?: {
    id?: string | null
    nombre?: string | null
    email?: string | null
  } | null
  items_count: number
}

export type RefundManualCaseDetail = {
  case: RefundManualCaseSummary
  purchase_context: RefundManualPurchaseContext | null
  items: RefundManualCaseItem[]
  consumible_items?: Array<{
    id: string
    case_id: string
    venta_id: string
    venta_item_id: string
    consumible_id?: string | null
    nombre: string
    quantity_original: number
    quantity_requested: number
    quantity_executed: number
    quantity_rejected: number
    unit_price_snapshot: number
    amount_snapshot: number
    status: RefundManualStatus
    created_at: string
    updated_at: string
  }>
  events: RefundManualCaseEvent[]
}

export type RefundManualActionId = "link_items" | "approve" | "reject" | "execute" | "resolve_non_refundable"

export type RefundCaseSortOrder = "date_desc" | "date_asc"

export type RefundCaseFilters = {
  query: string
  buyer: string
  event: string
  flow: RefundManualFlow | "all"
  sortOrder: RefundCaseSortOrder
}

export type RefundManualActionState = {
  id: RefundManualActionId
  label: string
  description: string
  disabled: boolean
  disabledReason?: string
}

export type RefundTimelineEntry = {
  id: string
  title: string
  detail: string
  createdAt: string
}

export type RefundManualViewerAccess = {
  canCreateManualCases: boolean
  canMutateEntryCases: boolean
  canMutateBuyerConsumibleCases: boolean
  canMutateCompanyConsumibleCases: boolean
}

const STATUS_META: Record<RefundManualStatus, { label: string; className: string }> = {
  requested: {
    label: "Solicitado",
    className: "bg-slate-100 text-slate-700 dark:bg-slate-900/40 dark:text-slate-300",
  },
  under_review: {
    label: "En revisión",
    className: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  },
  approved_for_manual_execution: {
    label: "Aprobado para ejecutar",
    className: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300",
  },
  rejected: {
    label: "Rechazado",
    className: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300",
  },
  executed: {
    label: "Ejecutado",
    className: "bg-success/15 text-success",
  },
  resolved_non_refundable: {
    label: "No reembolsable (MVP)",
    className: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",
  },
}

const FLOW_META: Record<RefundManualFlow, { label: string; className: string }> = {
  entradas: {
    label: "Entradas",
    className: "bg-primary/10 text-primary",
  },
  consumibles: {
    label: "Consumibles",
    className: "bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900/30 dark:text-fuchsia-300",
  },
}

const ITEM_ELIGIBILITY_META: Record<string, { label: string; className: string }> = {
  elegible: {
    label: "Elegible",
    className: "bg-success/15 text-success",
  },
  bloqueado: {
    label: "Bloqueado",
    className: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300",
  },
}

export function getRefundStatusMeta(status: RefundManualStatus) {
  return STATUS_META[status]
}

export function getRefundFlowMeta(flow: RefundManualFlow) {
  return FLOW_META[flow]
}

export function getRefundOriginLabel(origin?: string | null) {
  if (origin === "buyer_event_request") return "Comprador"
  if (origin === "buyer_consumible_request") return "Comprador consumibles"
  if (origin === "bar_stockout_auto") return "Faltante en barra"
  return "Manual empresa"
}

export function getRefundItemEligibilityMeta(eligibility: string) {
  return ITEM_ELIGIBILITY_META[eligibility] ?? {
    label: eligibility,
    className: "bg-muted text-muted-foreground",
  }
}

export function getRefundPaymentStatusLabel(status?: string | null) {
  switch (status) {
    case "approved":
      return "Aprobado"
    case "pending":
      return "Pendiente"
    case "in_process":
      return "En proceso"
    case "rejected":
      return "Rechazado"
    case "cancelled":
      return "Cancelado"
    case "refunded":
      return "Reintegrado"
    default:
      return status ?? "—"
  }
}

export function getRefundReconciliationStatusLabel(status?: string | null) {
  switch (status) {
    case "reconciled":
      return "Conciliado"
    case "needs_review":
      return "Requiere revisión"
    case "none":
      return "Sin conciliación"
    default:
      return status ?? "—"
  }
}

export function getRefundTargetTypeLabel(targetType: string) {
  switch (targetType) {
    case "entrada":
      return "Entrada"
    case "consumible_venta":
      return "Consumible"
    default:
      return targetType
  }
}

export function getRefundTargetStatusLabel(status?: string | null) {
  switch (status) {
    case "valida":
      return "Válida"
    case "usada":
      return "Usada"
    case "cancelada":
      return "Cancelada"
    case "pendiente":
      return "Pendiente"
    case "canjeado":
      return "Canjeado"
    case "cancelado":
      return "Cancelado"
    case "resuelto_parcial":
      return "Resuelto parcial"
    default:
      return status ?? "—"
  }
}

export function getRefundBlockReasonLabel(reason?: string | null) {
  switch (reason) {
    case "entrada_usada":
      return "Entrada usada"
    case "entrada_cancelada":
      return "Entrada cancelada"
    case "consumible_canjeado":
      return "Consumible canjeado"
    case "consumible_cancelado":
      return "Consumible cancelado"
    default:
      return reason ?? "—"
  }
}


export function getRefundBlockedItems(detail: RefundManualCaseDetail) {
  return detail.items.filter((item) => item.eligibility !== "elegible")
}

export function normalizeRefundCaseSearchValue(refundCase: RefundManualCaseSummary) {
  return [
    refundCase.request_reason,
    refundCase.checkout_session_id,
    refundCase.requested_event_name,
    refundCase.buyer_name,
    refundCase.requested_entry_id,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
}

export function filterAndSortRefundCases(cases: RefundManualCaseSummary[], filters: RefundCaseFilters) {
  const normalizedQuery = filters.query.trim().toLowerCase()
  const normalizedBuyer = filters.buyer.trim().toLowerCase()

  const filtered = cases.filter((refundCase) => {
    if (filters.flow !== "all" && refundCase.flow !== filters.flow) return false
    if (filters.event !== "all" && (refundCase.requested_event_name ?? "Sin evento") !== filters.event) return false
    if (normalizedBuyer && !(refundCase.buyer_name ?? "").toLowerCase().includes(normalizedBuyer)) return false
    if (normalizedQuery && !normalizeRefundCaseSearchValue(refundCase).includes(normalizedQuery)) return false
    return true
  })

  return [...filtered].sort((a, b) => {
    const aTime = new Date(a.created_at).getTime()
    const bTime = new Date(b.created_at).getTime()
    return filters.sortOrder === "date_asc" ? aTime - bTime : bTime - aTime
  })
}

export function resolveRefundExportErrorMessage(payload: unknown) {
  if (payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string" && payload.error.trim()) {
    return payload.error
  }

  return "No pudimos exportar los reembolsos. Reintentá en unos segundos."
}

export function getRefundVisibleActions(detail: RefundManualCaseDetail | null, access: RefundManualViewerAccess) {
  if (!detail) return [] satisfies RefundManualActionState[]

  const status = detail.case.status
  const blockedItems = getRefundBlockedItems(detail)
  const hasItems = detail.items.length > 0
  const actions: RefundManualActionState[] = []

  const isBuyerConsumibleCase = detail.case.flow === "consumibles" && detail.case.request_origin === "buyer_consumible_request"
  const canMutateCurrentCase = detail.case.flow === "entradas"
    ? access.canMutateEntryCases
    : isBuyerConsumibleCase
      ? access.canMutateBuyerConsumibleCases
      : access.canMutateCompanyConsumibleCases

  if (!canMutateCurrentCase) return actions

  if (access.canMutateEntryCases && (status === "requested" || status === "under_review")) {
    actions.push({
      id: "approve",
      label: "Aprobar para ejecución",
      description: "Aprobá el caso para que quede listo para ejecutar el reembolso. No mueve dinero todavía.",
      disabled: false,
    })
  }

  if (status === "requested" || status === "under_review" || status === "approved_for_manual_execution") {
    actions.push({
      id: "reject",
      label: "Rechazar reembolso",
      description: "Cerrá el caso como rechazado con motivo y evidencia o referencia externa para auditoría.",
      disabled: false,
    })
  }

  if (detail.case.flow === "entradas" && (status === "requested" || status === "under_review" || status === "approved_for_manual_execution")) {
    actions.push({
      id: "execute",
      label: "Reembolsar",
      description: "Ejecutá el reembolso y cerrá el caso.",
      disabled: !hasItems || blockedItems.length > 0,
      disabledReason: !hasItems
        ? "El caso no tiene items vinculados para ejecutar."
        : blockedItems.length > 0
          ? "Hay items bloqueados que impiden ejecutar el caso."
          : undefined,
    })
  }

  if (isBuyerConsumibleCase && (status === "requested" || status === "under_review" || status === "approved_for_manual_execution")) {
    actions.push({
      id: "execute",
      label: "Reembolsar",
      description: "Registrá la ejecución manual externa. Solo esa cantidad deja de poder canjearse.",
      disabled: !hasItems || blockedItems.length > 0,
      disabledReason: !hasItems
        ? "El caso no tiene items de consumibles para ejecutar."
        : blockedItems.length > 0
          ? "Hay items bloqueados que impiden ejecutar el caso."
          : undefined,
    })
  }

  if (
    detail.case.flow === "consumibles"
    && !isBuyerConsumibleCase
    && (status === "requested" || status === "under_review" || status === "approved_for_manual_execution")
  ) {
    actions.push({
      id: "resolve_non_refundable",
      label: "Resolver como no reembolsable",
      description: "Cierra el caso de consumibles según el contrato MVP vigente, sin mover dinero ni stock.",
      disabled: false,
    })
  }

  return actions
}

export function requiresEvidenceForRefundExecution(detail: RefundManualCaseDetail | null) {
  return detail?.case.flow !== "entradas"
}

function summarizePayload(payload?: Record<string, unknown> | null) {
  if (!payload) return "Sin detalle adicional"

  const reason = typeof payload.reason === "string" ? payload.reason : null
  const note = typeof payload.note === "string" ? payload.note : null
  const previousStatus = typeof payload.previous_status === "string" ? payload.previous_status : null
  const nextStatus = typeof payload.next_status === "string" ? payload.next_status : null
  const evidence = typeof payload.evidence_note === "string" ? payload.evidence_note : null
  const externalReference = typeof payload.external_refund_reference === "string" ? payload.external_refund_reference : null

  const parts = [
    previousStatus && nextStatus ? `${previousStatus} → ${nextStatus}` : null,
    reason ? `Motivo: ${reason}` : null,
    note ? `Nota: ${note}` : null,
    evidence ? `Evidencia: ${evidence}` : null,
    externalReference ? `Referencia: ${externalReference}` : null,
  ].filter(Boolean)

  return parts.length > 0 ? parts.join(" · ") : "Sin detalle adicional"
}

export function buildRefundTimeline(events: RefundManualCaseEvent[]): RefundTimelineEntry[] {
    const labelByEventType: Record<string, string> = {
      case_requested: "Caso solicitado",
      case_under_review: "Caso en revisión",
      case_items_linked: "Items vinculados",
      case_approved_for_manual_execution: "Aprobado para ejecución manual",
      case_rejected: "Caso rechazado",
      case_executed: "Refund marcado como ejecutado",
      case_resolved_non_refundable: "Caso resuelto como no reembolsable",
    }

  return events.map((event) => ({
    id: event.id,
    title: labelByEventType[event.event_type] ?? event.event_type,
    detail: summarizePayload(event.payload),
    createdAt: event.created_at,
  }))
}
