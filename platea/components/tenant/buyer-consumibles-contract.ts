export type BuyerConsumibleRefundState = {
  eligible_quantity: number
  requested_quantity: number
  executed_quantity: number
  rejected_quantity: number
  existing_request?: { case_id: string; status?: string | null } | null
}

export type BuyerConsumibleRefundSelection = Record<string, boolean>
export type BuyerConsumibleRefundMode = "total" | "parcial"
export type BuyerAutomaticRefundPolicy = {
  enabled: boolean
  mode: "manual" | "consumibles" | "entradas" | "todos"
  applies: boolean
}

export type BuyerConsumibleRefundRequestItem = {
  venta_id: string
  venta_item_id: string
  quantity_requested: number
}

export type BuyerConsumibleVentaItem = {
  venta_item_id: string
  consumible_id: string
  nombre: string
  cantidad: number
  precio_unitario: number
  subtotal: number
  cantidad_entregada?: number | null
  cantidad_reembolsada?: number | null
  monto_entregado?: number | null
  monto_reembolsado?: number | null
  resolution_reason?: string | null
  refund?: BuyerConsumibleRefundState
}

export type BuyerConsumibleVenta = {
  id: string
  qr_code: string
  clave_corta: string
  total: number
  estado: "pendiente" | "canjeado" | "cancelado" | "resuelto_parcial"
  canjeado_at?: string | null
  resuelto_at?: string | null
  delivered_amount?: number | null
  refunded_amount?: number | null
  created_at: string
  barra_id: string
  barra_nombre: string
  buyer_consumible_refunds_enabled?: boolean
  evento_id: string
  evento_nombre: string
  refund_policy?: BuyerAutomaticRefundPolicy | null
  items: BuyerConsumibleVentaItem[]
}

export function getBuyerAutomaticRefundAlertCopy(policy: BuyerAutomaticRefundPolicy | null | undefined, flow: "entradas" | "consumibles") {
  if (!policy?.enabled || !policy.applies) return null

  return flow === "entradas"
    ? "La empresa tiene reembolsos automáticos activos para entradas. Si tu solicitud pasa las validaciones, Ticketera va a intentar ejecutar el reembolso automáticamente."
    : "La empresa tiene reembolsos automáticos activos para consumibles. Si tu solicitud pasa las validaciones, Ticketera va a intentar ejecutar el reembolso automáticamente."
}

export function getBuyerConsumibleRefundableItems(venta: BuyerConsumibleVenta | null | undefined) {
  if (!venta || venta.estado !== "pendiente") return []
  if (venta.buyer_consumible_refunds_enabled === false) return []
  return venta.items.filter((item) => Number(item.refund?.eligible_quantity ?? 0) > 0)
}

export function buildBuyerConsumibleDefaultRefundSelection(venta: BuyerConsumibleVenta | null | undefined): BuyerConsumibleRefundSelection {
  return getBuyerConsumibleRefundableItems(venta).reduce<BuyerConsumibleRefundSelection>((acc, item) => {
    acc[item.venta_item_id] = true
    return acc
  }, {})
}

export function buildBuyerConsumibleRefundRequestItems(
  venta: BuyerConsumibleVenta | null | undefined,
  selection: BuyerConsumibleRefundSelection
): BuyerConsumibleRefundRequestItem[] {
  if (!venta) return []

  return getBuyerConsumibleRefundableItems(venta)
    .filter((item) => selection[item.venta_item_id] !== false)
    .map((item) => ({
      venta_id: venta.id,
      venta_item_id: item.venta_item_id,
      quantity_requested: Number(item.refund?.eligible_quantity ?? 0),
    }))
    .filter((item) => item.quantity_requested > 0)
}

/**
 * ¿Se muestra el bloque de reembolso de consumibles?
 *
 * Regla: si la barra NO tiene habilitado el reembolso al comprador, no se muestra
 * nada. Salvo que el comprador YA tenga una solicitud viva (pedida, ejecutada,
 * rechazada o marcada no reembolsable), en cuyo caso necesita poder seguirla
 * aunque después la hayan apagado.
 */
export function shouldShowBuyerConsumibleRefundPanel(venta: BuyerConsumibleVenta) {
  if (getBuyerConsumibleRefundStatusCopy(venta)) return true
  if (venta.buyer_consumible_refunds_enabled === false) return false
  return getBuyerConsumibleRefundableItems(venta).length > 0
}

export function getBuyerConsumibleRefundStatusCopy(venta: BuyerConsumibleVenta) {
  const executedQuantity = venta.items.reduce((sum, item) => sum + Number(item.refund?.executed_quantity ?? 0), 0)
  const requestedQuantity = venta.items.reduce((sum, item) => sum + Number(item.refund?.requested_quantity ?? 0), 0)
  const rejectedItem = venta.items.find((item) => item.refund?.existing_request?.status === "rejected")
  const nonRefundableItem = venta.items.find((item) => item.refund?.existing_request?.status === "resolved_non_refundable")

  if (rejectedItem) {
    const rejectedQuantity = Number(rejectedItem.refund?.rejected_quantity ?? 0)
    return `La empresa rechazó tu solicitud de reembolso${rejectedQuantity > 0 ? ` por ${rejectedQuantity} unidad${rejectedQuantity === 1 ? "" : "es"}` : ""}. Esa cantidad sigue disponible para retirar.`
  }

  if (nonRefundableItem) {
    return "La empresa marcó esta solicitud como no reembolsable. Esa cantidad sigue disponible para retirar."
  }

  if (executedQuantity > 0) {
    return `${executedQuantity} unidad${executedQuantity === 1 ? "" : "es"} ya fueron reembolsadas y no se pueden canjear.`
  }

  if (requestedQuantity > 0) {
    return `Tenés ${requestedQuantity} unidad${requestedQuantity === 1 ? "" : "es"} en revisión manual.`
  }

  return null
}

/**
 * Cuando la barra tiene el reembolso al comprador APAGADO, el panel entero no se
 * monta (ver `shouldShowBuyerConsumibleRefundPanel`): anunciarle a alguien que no
 * puede pedir algo que nunca vio es peor que no mostrar nada.
 *
 * La única excepción es que ya tenga una solicitud en curso — ahí sí se muestra,
 * pero con su estado real, no con "esta barra no acepta solicitudes" (que sería
 * contradictorio con la solicitud que el comprador está viendo).
 */
export function getBuyerConsumibleRefundAvailabilityCopy(venta: BuyerConsumibleVenta) {
  const statusCopy = getBuyerConsumibleRefundStatusCopy(venta)
  if (statusCopy && /rechazó tu solicitud de reembolso|no reembolsable/i.test(statusCopy)) return statusCopy

  const eligibleQuantity = venta.items.reduce((sum, item) => sum + Number(item.refund?.eligible_quantity ?? 0), 0)
  if (eligibleQuantity > 0) {
    return `Podés pedir el reembolso de hasta ${eligibleQuantity} unidad${eligibleQuantity === 1 ? "" : "es"}. La empresa lo revisa desde Reembolsos.`
  }

  if (statusCopy) return statusCopy

  return "Esta compra de consumibles no tiene reembolso para compradores disponible en este momento."
}

export function getBuyerConsumibleItemRefundCopy(item: BuyerConsumibleVentaItem, ventaEstado: BuyerConsumibleVenta["estado"]) {
  if (ventaEstado !== "pendiente") return null

  const executedQuantity = Number(item.refund?.executed_quantity ?? 0)
  const eligibleQuantity = Number(item.refund?.eligible_quantity ?? 0)
  const requestedQuantity = Number(item.refund?.requested_quantity ?? 0)
  const rejectedQuantity = Number(item.refund?.rejected_quantity ?? 0)
  const latestStatus = item.refund?.existing_request?.status

  if (executedQuantity > 0) {
    return `${executedQuantity} unidad${executedQuantity === 1 ? "" : "es"} ya fueron reembolsadas y no se pueden canjear.`
  }

  if (latestStatus === "rejected") {
    const quantity = rejectedQuantity > 0 ? rejectedQuantity : requestedQuantity
    return `La empresa rechazó tu solicitud de reembolso${quantity > 0 ? ` por ${quantity} unidad${quantity === 1 ? "" : "es"}` : ""}. Esa cantidad sigue disponible para retirar.`
  }

  if (latestStatus === "resolved_non_refundable") {
    return "La empresa marcó esta solicitud como no reembolsable. Esa cantidad sigue disponible para retirar."
  }

  if (requestedQuantity > 0) {
    return `Tenés ${requestedQuantity} unidad${requestedQuantity === 1 ? "" : "es"} en revisión manual.`
  }

  if (eligibleQuantity > 0) {
    return `Todavía podés pedir el reembolso de ${eligibleQuantity} unidad${eligibleQuantity === 1 ? "" : "es"}.`
  }

  return null
}
