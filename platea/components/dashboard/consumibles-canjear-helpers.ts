export type ConsumiblePreviewItem = {
  venta_item_id: string
  nombre: string
  cantidad: number
  precio_unitario: number
  subtotal: number
}

export type ConsumibleResolutionDraft = {
  venta_item_id: string
  cantidad_total: number
  cantidad_entregada: number
  cantidad_reembolsada: number
  status: "delivered" | "mixed" | "refunded"
  units: Array<{
    id: string
    status: "delivered" | "refunded" | null
  }>
}

function deriveStatus(cantidadEntregada: number, cantidadReembolsada: number) {
  if (cantidadReembolsada <= 0) return "delivered" as const
  if (cantidadEntregada <= 0) return "refunded" as const
  return "mixed" as const
}

export function buildInitialConsumibleResolutionDrafts(items: ConsumiblePreviewItem[]): ConsumibleResolutionDraft[] {
  return items.map((item) => ({
    venta_item_id: item.venta_item_id,
    cantidad_total: item.cantidad,
    cantidad_entregada: 0,
    cantidad_reembolsada: 0,
    status: "mixed",
    units: Array.from({ length: item.cantidad }, (_, index) => ({
      id: `${item.venta_item_id}-${index + 1}`,
      status: null,
    })),
  }))
}

function buildDraftFromUnits(draft: ConsumibleResolutionDraft) {
  const cantidadEntregada = draft.units.filter((unit) => unit.status === "delivered").length
  const cantidadReembolsada = draft.units.filter((unit) => unit.status === "refunded").length
  return {
    ...draft,
    cantidad_entregada: cantidadEntregada,
    cantidad_reembolsada: cantidadReembolsada,
    status: deriveStatus(cantidadEntregada, cantidadReembolsada),
  }
}

export function updateConsumibleUnitStatus(
  drafts: ConsumibleResolutionDraft[],
  ventaItemId: string,
  unitId: string,
  nextStatus: "delivered" | "refunded",
) {
  return drafts.map((draft) => {
    if (draft.venta_item_id !== ventaItemId) return draft
    return buildDraftFromUnits({
      ...draft,
      units: draft.units.map((unit) => (unit.id === unitId ? { ...unit, status: nextStatus } : unit)),
    })
  })
}

export function isConsumibleResolutionComplete(drafts: ConsumibleResolutionDraft[]) {
  return drafts.every((draft) => draft.units.every((unit) => unit.status !== null))
}

export function buildConsumiblesResolutionPayload(drafts: ConsumibleResolutionDraft[]) {
  return drafts.map((draft) => ({
    venta_item_id: draft.venta_item_id,
    cantidad_entregada: draft.cantidad_entregada,
    cantidad_reembolsada: draft.cantidad_reembolsada,
    ...(draft.cantidad_reembolsada > 0 ? { resolution_reason: "stock_shortage" as const } : {}),
  }))
}
