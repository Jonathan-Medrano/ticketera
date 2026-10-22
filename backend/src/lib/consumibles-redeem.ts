import { randomUUID as uuidv4 } from 'node:crypto'
import { PaymentRefund } from 'mercadopago'
import { prismaDirectUrl } from './prisma'
import { getMercadoPagoClientByEmpresaId, getPaymentAccountByEmpresaId } from './payment-accounts'
import { reversePlatformAllocationsProportionally } from './platform-profit-sharing'
import { roundMoney } from './money'

type ActorType = 'empresa' | 'empleado'
type VentaEstado = 'pendiente' | 'canjeado' | 'cancelado' | 'resuelto_parcial'

type VentaRow = {
  id: string
  barra_id: string
  evento_id: string
  total: number | string
  estado: VentaEstado
  canjeado_at: string | null
  resuelto_at: string | null
  checkout_session_id: string | null
  owner_fee_amount: number | string | null
  mp_fee_amount: number | string | null
  neto_empresa_amount: number | string | null
  barra_nombre: string
  evento_nombre: string
  clave_corta: string
}

type ItemRow = {
  id: string
  consumible_id: string
  nombre: string
  cantidad: number
  precio_unitario: number
  subtotal: number
}

type CheckoutSessionRow = {
  id: string
  payment_id: string | null
  payment_status: string | null
  reconciliation_status: string | null
  comprador_id: string | null
}

type ResolutionInput = {
  venta_item_id: string
  cantidad_entregada: number
  cantidad_reembolsada: number
  resolution_reason?: 'stock_shortage'
}

type ResolvedItem = {
  venta_item_id: string
  consumible_id: string
  nombre: string
  cantidad: number
  precio_unitario: number
  subtotal: number
  cantidad_entregada: number
  cantidad_reembolsada: number
  monto_entregado: number
  monto_reembolsado: number
  resolution_reason?: 'stock_shortage'
}

export type ConsumiblesRedeemPreviewResult =
  | {
      ok: true
      venta_id: string
      barra_id: string
      barra_nombre: string
      evento_id: string
      evento_nombre: string
      total: number
      clave_corta: string
      items: Array<{
        venta_item_id: string
        consumible_id: string
        nombre: string
        cantidad: number
        precio_unitario: number
        subtotal: number
      }>
    }
  | {
      ok: false
      motivo: string
      canjeado_at?: string | null
      resuelto_at?: string | null
    }

export type ConsumiblesRedeemResolveResult =
  | {
      ok: true
      venta_id: string
      barra_id: string
      estado: VentaEstado
      total: number
      delivered_amount: number
      refunded_amount: number
      refund_case_id: string | null
      items: ResolvedItem[]
    }
  | {
      ok: false
      motivo: string
      canjeado_at?: string | null
      resuelto_at?: string | null
    }

let auditSchemaEnsured = false

// Strategy A — retry on P2034 serialization failure
async function withSerializableRetry<T>(fn: () => Promise<T>, retries = 3, backoffMs = 100): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      const isPrismaSerializationError =
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code?: string }).code === 'P2034'
      if (isPrismaSerializationError && attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, backoffMs * (attempt + 1)))
        continue
      }
      throw err
    }
  }
  throw new Error('withSerializableRetry: unreachable')
}

async function ensureAuditSchema() {
  // Phase 4: `consumibles_canje_auditoria` is now in prisma/schema.prisma
  // (model ConsumiblesCanjeAuditoria) + migration 20260601120100_add_consumibles_canje_auditoria.
  // No runtime DDL needed. Kept as a no-op so existing callers do not need to change.
  return
}

type PrismaTx = Parameters<Parameters<typeof prismaDirectUrl.$transaction>[0]>[0]

async function insertAudit(
  tx: PrismaTx,
  input: {
    ventaId?: string | null
    empresaId: string
    eventoId?: string | null
    barraId?: string | null
    actorId: string
    actorType: ActorType
    accion: string
    codigoIngresado?: string | null
    motivo?: string | null
    detalle?: Record<string, unknown> | null
  }
) {
  const detalleJson = input.detalle ? JSON.stringify(input.detalle) : null
  await tx.$executeRaw`
    INSERT INTO consumibles_canje_auditoria
    (id, venta_id, empresa_id, evento_id, barra_id, actor_id, actor_type, accion, codigo_ingresado, motivo, detalle_json)
    VALUES (
      ${uuidv4()},
      ${input.ventaId ?? null},
      ${input.empresaId},
      ${input.eventoId ?? null},
      ${input.barraId ?? null},
      ${input.actorId},
      ${input.actorType},
      ${input.accion},
      ${input.codigoIngresado ?? null},
      ${input.motivo ?? null},
      ${detalleJson}
    )`
}

// FOR UPDATE Site 1 — lock consumibles_venta by QR/clave_corta (Strategy A)
async function lockVentaByCodigo(tx: PrismaTx, codigo: string, barraId: string, empresaId: string) {
  const ventaRows = await tx.$queryRaw<VentaRow[]>`
    SELECT cv.id, cv.barra_id, cv.evento_id, cv.total::float AS total, cv.estado,
           cv.canjeado_at, cv.resuelto_at, cv.checkout_session_id,
           cv.owner_fee_amount::float AS owner_fee_amount,
           cv.mp_fee_amount::float AS mp_fee_amount,
           cv.neto_empresa_amount::float AS neto_empresa_amount,
           cv.clave_corta,
           b.nombre AS barra_nombre, ev.nombre AS evento_nombre
    FROM consumibles_ventas cv
    JOIN barras b ON b.id = cv.barra_id
    JOIN eventos ev ON ev.id = cv.evento_id
    WHERE (cv.qr_code = ${codigo} OR cv.clave_corta = ${codigo})
      AND cv.empresa_id = ${empresaId}
      AND cv.barra_id = ${barraId}
    FOR UPDATE`

  return ventaRows[0] ?? null
}

// FOR UPDATE Site 2 — lock consumibles_venta by id (Strategy A)
async function lockVentaById(tx: PrismaTx, ventaId: string, barraId: string, empresaId: string) {
  const ventaRows = await tx.$queryRaw<VentaRow[]>`
    SELECT cv.id, cv.barra_id, cv.evento_id, cv.total::float AS total, cv.estado,
           cv.canjeado_at, cv.resuelto_at, cv.checkout_session_id,
           cv.owner_fee_amount::float AS owner_fee_amount,
           cv.mp_fee_amount::float AS mp_fee_amount,
           cv.neto_empresa_amount::float AS neto_empresa_amount,
           cv.clave_corta,
           b.nombre AS barra_nombre, ev.nombre AS evento_nombre
    FROM consumibles_ventas cv
    JOIN barras b ON b.id = cv.barra_id
    JOIN eventos ev ON ev.id = cv.evento_id
    WHERE cv.id = ${ventaId}
      AND cv.empresa_id = ${empresaId}
      AND cv.barra_id = ${barraId}
    FOR UPDATE`

  return ventaRows[0] ?? null
}

// FOR UPDATE Site 3 — lock checkout_session for refund (Strategy A)
async function lockCheckoutSession(tx: PrismaTx, checkoutSessionId: string, empresaId: string) {
  const rows = await tx.$queryRaw<CheckoutSessionRow[]>`
    SELECT id, payment_id, payment_status, reconciliation_status, comprador_id
    FROM checkout_sessions
    WHERE id = ${checkoutSessionId}
      AND empresa_id = ${empresaId}
    LIMIT 1
    FOR UPDATE`

  return rows[0] ?? null
}

async function getVentaItems(tx: PrismaTx, ventaId: string) {
  const itemRows = await tx.$queryRaw<ItemRow[]>`
    SELECT id, consumible_id, nombre_snapshot AS nombre,
           cantidad, precio_unitario::float AS precio_unitario, subtotal::float AS subtotal
    FROM consumibles_venta_items
    WHERE venta_id = ${ventaId}
    ORDER BY nombre_snapshot ASC, id ASC`

  return itemRows.map((item) => ({
    venta_item_id: String(item.id),
    consumible_id: String(item.consumible_id),
    nombre: String(item.nombre),
    cantidad: Number(item.cantidad),
    precio_unitario: Number(item.precio_unitario),
    subtotal: Number(item.subtotal),
  }))
}

async function getBuyerExecutedRefundQuantityByVentaItem(tx: PrismaTx, ventaId: string) {
  type RefundRow = { venta_item_id: string; executed_quantity: number }
  const rows = await tx.$queryRaw<RefundRow[]>`
    SELECT venta_item_id, COALESCE(SUM(quantity_executed), 0)::int AS executed_quantity
    FROM refund_manual_case_consumible_items
    WHERE venta_id = ${ventaId} AND status = 'executed'
    GROUP BY venta_item_id`

  return new Map(rows.map((row) => [String(row.venta_item_id), Number(row.executed_quantity ?? 0)]))
}

async function getRedeemableVentaItems(tx: PrismaTx, ventaId: string) {
  const items = await getVentaItems(tx, ventaId)
  const executedRefunds = await getBuyerExecutedRefundQuantityByVentaItem(tx, ventaId)

  return items
    .map((item) => {
      const executedQuantity = executedRefunds.get(item.venta_item_id) ?? 0
      const availableQuantity = Math.max(0, item.cantidad - executedQuantity)
      return {
        ...item,
        cantidad: availableQuantity,
        subtotal: roundMoney(item.precio_unitario * availableQuantity),
      }
    })
    .filter((item) => item.cantidad > 0)
}

function getClosedTicketResult(venta: VentaRow) {
  if (venta.estado === 'canjeado') {
    return { ok: false as const, motivo: 'Ticket ya canjeado', canjeado_at: venta.canjeado_at, resuelto_at: venta.resuelto_at }
  }
  if (venta.estado === 'cancelado') {
    return { ok: false as const, motivo: 'Ticket cancelado', canjeado_at: venta.canjeado_at, resuelto_at: venta.resuelto_at }
  }
  return { ok: false as const, motivo: 'Ticket ya resuelto', canjeado_at: venta.canjeado_at, resuelto_at: venta.resuelto_at }
}

function normalizeExplicitResolution(items: Awaited<ReturnType<typeof getVentaItems>>, resolutionItems: ResolutionInput[]) {
  const normalizedInput = new Map<string, ResolutionInput>()

  for (const resolution of resolutionItems ?? []) {
    const ventaItemId = typeof resolution?.venta_item_id === 'string' ? resolution.venta_item_id.trim() : ''
    if (!ventaItemId || normalizedInput.has(ventaItemId)) return { ok: false as const, motivo: 'Cada línea debe resolverse una sola vez' }

    const cantidadEntregada = Number(resolution?.cantidad_entregada)
    const cantidadReembolsada = Number(resolution?.cantidad_reembolsada)
    if (!Number.isInteger(cantidadEntregada) || !Number.isInteger(cantidadReembolsada) || cantidadEntregada < 0 || cantidadReembolsada < 0) {
      return { ok: false as const, motivo: 'Las cantidades de resolución deben ser enteras y no negativas' }
    }

    normalizedInput.set(ventaItemId, {
      venta_item_id: ventaItemId,
      cantidad_entregada: cantidadEntregada,
      cantidad_reembolsada: cantidadReembolsada,
      resolution_reason: resolution?.resolution_reason === 'stock_shortage' ? 'stock_shortage' : undefined,
    })
  }

  if (normalizedInput.size !== items.length) {
    return { ok: false as const, motivo: 'Debés resolver todas las líneas del ticket' }
  }

  const resolvedItems: ResolvedItem[] = []
  for (const item of items) {
    const resolution = normalizedInput.get(item.venta_item_id)
    if (!resolution) return { ok: false as const, motivo: 'Falta resolución para una línea del ticket' }
    if (resolution.cantidad_entregada + resolution.cantidad_reembolsada !== item.cantidad) {
      return { ok: false as const, motivo: `La suma entregada + reembolsada debe coincidir para ${item.nombre}` }
    }

    const montoEntregado = roundMoney(item.precio_unitario * resolution.cantidad_entregada)
    const montoReembolsado = roundMoney(item.precio_unitario * resolution.cantidad_reembolsada)
    resolvedItems.push({
      ...item,
      cantidad_entregada: resolution.cantidad_entregada,
      cantidad_reembolsada: resolution.cantidad_reembolsada,
      monto_entregado: montoEntregado,
      monto_reembolsado: montoReembolsado,
      resolution_reason: resolution.cantidad_reembolsada > 0 ? (resolution.resolution_reason ?? 'stock_shortage') : undefined,
    })
  }

  return { ok: true as const, items: resolvedItems }
}

function buildAllDeliveredResolution(items: Awaited<ReturnType<typeof getVentaItems>>) {
  return items.map<ResolvedItem>((item) => ({
    ...item,
    cantidad_entregada: item.cantidad,
    cantidad_reembolsada: 0,
    monto_entregado: item.subtotal,
    monto_reembolsado: 0,
  }))
}

function deriveResolvedEstado(deliveredAmount: number, refundedAmount: number): VentaEstado {
  if (refundedAmount <= 0) return 'canjeado'
  if (deliveredAmount <= 0) return 'cancelado'
  return 'resuelto_parcial'
}

function deriveResolvedNetoAmount(venta: VentaRow, deliveredAmount: number) {
  const total = Number(venta.total ?? 0)
  if (total <= 0 || deliveredAmount <= 0) return 0

  const originalNeto = venta.neto_empresa_amount == null
    ? Number(venta.total ?? 0) - Number(venta.owner_fee_amount ?? 0) - Number(venta.mp_fee_amount ?? 0)
    : Number(venta.neto_empresa_amount)

  return roundMoney(originalNeto * Math.min(1, deliveredAmount / total))
}

async function executePartialMercadoPagoRefund(input: {
  empresaId: string
  paymentId: string
  refundAmount: number
  saleId: string
}) {
  const paymentAccount = await getPaymentAccountByEmpresaId(input.empresaId)
  if (!paymentAccount) {
    return { ok: false as const, motivo: 'La empresa no tiene una cuenta de Mercado Pago conectada para ejecutar refunds automáticos' }
  }
  if (paymentAccount.status !== 'ready_to_sell') {
    return { ok: false as const, motivo: 'La cuenta de Mercado Pago de la empresa no está lista para ejecutar refunds automáticos' }
  }

  const mpClient = await getMercadoPagoClientByEmpresaId(input.empresaId)
  if (!mpClient) {
    return { ok: false as const, motivo: 'No se pudo inicializar Mercado Pago para ejecutar el refund automático' }
  }

  try {
    const refundClient = new PaymentRefund(mpClient)
    const refund = await (refundClient as any).create({
      payment_id: input.paymentId,
      body: { amount: input.refundAmount },
      requestOptions: { idempotencyKey: `consumibles-bar-refund-${input.saleId}` },
    })

    return {
      ok: true as const,
      refundReference: refund?.id != null ? String(refund.id) : null,
      refundStatus: typeof refund?.status === 'string' ? refund.status : null,
      refundedAmount: refund?.amount != null ? Number(refund.amount) : input.refundAmount,
    }
  } catch (error) {
    return {
      ok: false as const,
      motivo: error instanceof Error ? error.message : 'No se pudo ejecutar el refund automático',
    }
  }
}

async function createAutomaticRefundCase(
  tx: PrismaTx,
  input: {
    venta: VentaRow
    empresaId: string
    actorId: string
    actorType: ActorType
    checkoutSession: CheckoutSessionRow
    refundAmount: number
    nextEstado: VentaEstado
    resolvedItems: ResolvedItem[]
  }
) {
  const refundCaseId = uuidv4()
  // Note: executePartialMercadoPagoRefund makes external HTTP call — done outside tx would be safer
  // but kept here for atomicity consistency with original design (rollback on MP failure).
  const automaticRefund = await executePartialMercadoPagoRefund({
    empresaId: input.empresaId,
    paymentId: String(input.checkoutSession.payment_id),
    refundAmount: input.refundAmount,
    saleId: input.venta.id,
  })

  if (!automaticRefund.ok) {
    return { ok: false as const, motivo: automaticRefund.motivo }
  }

  await tx.$executeRaw`
    INSERT INTO refund_manual_cases
    (id, empresa_id, checkout_session_id, flow, status, payment_id, payment_status, reconciliation_status,
     requested_amount, currency, request_reason, request_note, request_origin, external_refund_reference,
     evidence_note, requester_actor_id, requester_actor_type, requester_buyer_id, requested_event_id,
     created_by, resolved_by, resolved_at)
    VALUES (
      ${refundCaseId}, ${input.empresaId}, ${input.checkoutSession.id},
      'consumibles', 'executed',
      ${input.checkoutSession.payment_id}, ${input.checkoutSession.payment_status},
      ${input.checkoutSession.reconciliation_status},
      ${input.refundAmount}, 'ARS',
      'Reembolso por falta de stock',
      'Refund automático por faltante en barra',
      'bar_stockout_auto',
      ${automaticRefund.refundReference},
      ${`Refund automático por falta de stock en barra${automaticRefund.refundStatus ? ` (${automaticRefund.refundStatus})` : ''}`},
      ${input.actorId}, ${input.actorType},
      ${input.checkoutSession.comprador_id},
      ${input.venta.evento_id},
      ${input.actorId}, ${input.actorId}, NOW()
    )`

  await tx.$executeRaw`
    INSERT INTO refund_manual_case_items
    (id, case_id, target_type, target_id, target_status_before, target_status_after, eligibility, block_reason, amount_snapshot)
    VALUES (
      ${uuidv4()}, ${refundCaseId}, 'consumible_venta',
      ${input.venta.id}, ${input.venta.estado}, ${input.nextEstado},
      'elegible', NULL, ${input.refundAmount}
    )`

  const caseEventsId1 = uuidv4()
  const caseEventsId2 = uuidv4()
  const requestedPayload = JSON.stringify({
    request_origin: 'bar_stockout_auto',
    reason: 'Reembolso por falta de stock',
    refunded_amount: input.refundAmount,
  })
  const executedPayload = JSON.stringify({
    request_origin: 'bar_stockout_auto',
    refunded_amount: automaticRefund.refundedAmount,
    refund_status: automaticRefund.refundStatus,
    external_refund_reference: automaticRefund.refundReference,
    resolution: input.resolvedItems.map((item) => ({
      venta_item_id: item.venta_item_id,
      cantidad_entregada: item.cantidad_entregada,
      cantidad_reembolsada: item.cantidad_reembolsada,
    })),
  })

  await tx.$executeRaw`
    INSERT INTO refund_manual_case_events
    (id, case_id, event_type, actor_id, actor_type, payload_json)
    VALUES
    (${caseEventsId1}, ${refundCaseId}, 'case_requested', ${input.actorId}, ${input.actorType}, ${requestedPayload}),
    (${caseEventsId2}, ${refundCaseId}, 'case_executed', ${input.actorId}, ${input.actorType}, ${executedPayload})`

  for (const item of input.resolvedItems.filter((resolvedItem) => resolvedItem.cantidad_reembolsada > 0)) {
    const consumibleCaseItemId = uuidv4()

    await tx.$executeRaw`
      INSERT INTO refund_manual_case_consumible_items
      (id, case_id, venta_id, venta_item_id, consumible_id, nombre_snapshot, quantity_original, quantity_requested,
       quantity_executed, quantity_rejected, unit_price_snapshot, amount_snapshot, status)
      VALUES (
        ${consumibleCaseItemId}, ${refundCaseId},
        ${input.venta.id}, ${item.venta_item_id}, ${item.consumible_id},
        ${item.nombre}, ${item.cantidad}, ${item.cantidad_reembolsada},
        ${item.cantidad_reembolsada}, ${0},
        ${item.precio_unitario}, ${item.monto_reembolsado},
        'executed'
      )`

    await tx.$executeRaw`
      INSERT INTO refund_manual_case_consumible_item_events
      (id, case_id, consumible_case_item_id, event_type, actor_id, actor_type, payload_json)
      VALUES (
        ${uuidv4()}, ${refundCaseId}, ${consumibleCaseItemId},
        'quantity_executed', ${input.actorId}, ${input.actorType},
        ${JSON.stringify({ quantity_executed: item.cantidad_reembolsada, venta_item_id: item.venta_item_id })}
      )`

    // Bug fix: an automatic bar-stockout refund never restored `barra_stock`, so every
    // executed refund permanently shrank sellable stock (units paid back to the buyer stayed
    // "sold" forever, since stock is decremented at purchase time — see routes/tenant.ts).
    // Restore stock_actual by the REFUNDED quantity for this line, mirroring the pattern in
    // refund-manual.ts (~line 2444 and ~line 2664): guard on stock_ilimitado = false, same tx.
    await tx.$executeRaw`
      UPDATE barra_stock SET stock_actual = stock_actual + ${item.cantidad_reembolsada}
      WHERE barra_id = ${input.venta.barra_id} AND consumible_id = ${item.consumible_id}
        AND stock_ilimitado = false
    `
  }

  return {
    ok: true as const,
    refundCaseId,
  }
}

export async function previewConsumiblesRedeem(input: {
  codigo: string
  barraId: string
  empresaId: string
  actorId: string
  actorType: ActorType
}): Promise<ConsumiblesRedeemPreviewResult> {
  await ensureAuditSchema()

  type TxResult = ConsumiblesRedeemPreviewResult

  let txResult: TxResult | null = null

  await withSerializableRetry(() =>
    prismaDirectUrl.$transaction(async (tx) => {
      txResult = null // reset on retry

      // FOR UPDATE Site 1 (via lockVentaByCodigo) — also lock barra first to prevent deadlock
      // Barra lock: lightweight, ensures consistency before main venta lock
      type BarraLock = { id: string }[]
      const barraRows = await tx.$queryRaw<BarraLock>`
        SELECT id FROM barras
        WHERE id = ${input.barraId} AND empresa_id = ${input.empresaId}
        FOR UPDATE`

      if (!barraRows.length) {
        await insertAudit(tx, {
          empresaId: input.empresaId,
          barraId: input.barraId,
          actorId: input.actorId,
          actorType: input.actorType,
          accion: 'preview_rejected',
          codigoIngresado: input.codigo,
          motivo: 'barra_no_encontrada',
        })
        txResult = { ok: false, motivo: 'Barra no encontrada' }
        return
      }

      // FOR UPDATE Site 1 — lock consumibles_venta by QR/clave_corta
      const venta = await lockVentaByCodigo(tx, input.codigo, input.barraId, input.empresaId)

      if (!venta) {
        await insertAudit(tx, {
          empresaId: input.empresaId,
          barraId: input.barraId,
          actorId: input.actorId,
          actorType: input.actorType,
          accion: 'preview_rejected',
          codigoIngresado: input.codigo,
          motivo: 'ticket_no_encontrado',
        })
        txResult = { ok: false, motivo: 'Ticket no encontrado' }
        return
      }

      if (venta.estado !== 'pendiente') {
        await insertAudit(tx, {
          ventaId: venta.id,
          empresaId: input.empresaId,
          eventoId: venta.evento_id,
          barraId: venta.barra_id,
          actorId: input.actorId,
          actorType: input.actorType,
          accion: 'preview_rejected',
          codigoIngresado: input.codigo,
          motivo: `ticket_${venta.estado}`,
        })
        txResult = getClosedTicketResult(venta)
        return
      }

      const items = await getRedeemableVentaItems(tx, venta.id)

      if (!items.length) {
        await insertAudit(tx, {
          ventaId: venta.id,
          empresaId: input.empresaId,
          eventoId: venta.evento_id,
          barraId: venta.barra_id,
          actorId: input.actorId,
          actorType: input.actorType,
          accion: 'preview_rejected',
          codigoIngresado: input.codigo,
          motivo: 'ticket_cancelado',
        })
        txResult = { ok: false, motivo: 'Ticket cancelado', canjeado_at: venta.canjeado_at, resuelto_at: venta.resuelto_at }
        return
      }

      await insertAudit(tx, {
        ventaId: venta.id,
        empresaId: input.empresaId,
        eventoId: venta.evento_id,
        barraId: venta.barra_id,
        actorId: input.actorId,
        actorType: input.actorType,
        accion: 'preview_ok',
        codigoIngresado: input.codigo,
        detalle: { items: items.length, total: Number(venta.total) },
      })

      txResult = {
        ok: true,
        venta_id: venta.id,
        barra_id: venta.barra_id,
        barra_nombre: venta.barra_nombre,
        evento_id: venta.evento_id,
        evento_nombre: venta.evento_nombre,
        total: Number(venta.total),
        clave_corta: venta.clave_corta,
        items,
      }
    }, {
      isolationLevel: 'Serializable',
      maxWait: 5000,
      timeout: 15000,
    })
  )

  if (!txResult) throw new Error('preview_consumibles_redeem_failed')
  return txResult
}

export async function resolveConsumiblesRedeem(input: {
  ventaId: string
  barraId: string
  empresaId: string
  actorId: string
  actorType: ActorType
  items?: ResolutionInput[]
  shorthandAllDelivered?: boolean
}): Promise<ConsumiblesRedeemResolveResult> {
  await ensureAuditSchema()

  type TxResult = ConsumiblesRedeemResolveResult & {
    _postCommitRefundCaseId?: string | null
    _postCommitVentaId?: string
    _postCommitVentaTotal?: number
    _postCommitEmpresaId?: string
  }

  let txResult: TxResult | null = null

  await withSerializableRetry(() =>
    prismaDirectUrl.$transaction(async (tx) => {
      txResult = null // reset on retry

      // FOR UPDATE Site 2 — lock consumibles_venta by id
      const venta = await lockVentaById(tx, input.ventaId, input.barraId, input.empresaId)
      if (!venta) {
        await insertAudit(tx, {
          ventaId: input.ventaId,
          empresaId: input.empresaId,
          barraId: input.barraId,
          actorId: input.actorId,
          actorType: input.actorType,
          accion: 'resolve_rejected',
          motivo: 'ticket_no_encontrado',
        })
        txResult = { ok: false, motivo: 'Ticket no encontrado' }
        return
      }

      if (venta.estado !== 'pendiente') {
        await insertAudit(tx, {
          ventaId: venta.id,
          empresaId: input.empresaId,
          eventoId: venta.evento_id,
          barraId: venta.barra_id,
          actorId: input.actorId,
          actorType: input.actorType,
          accion: 'resolve_rejected',
          motivo: `ticket_${venta.estado}`,
        })
        txResult = getClosedTicketResult(venta)
        return
      }

      const ventaItems = await getRedeemableVentaItems(tx, venta.id)
      const normalizedResolution = input.shorthandAllDelivered
        ? { ok: true as const, items: buildAllDeliveredResolution(ventaItems) }
        : normalizeExplicitResolution(ventaItems, input.items ?? [])

      if (!normalizedResolution.ok) {
        txResult = { ok: false, motivo: normalizedResolution.motivo }
        return
      }

      const deliveredAmount = roundMoney(normalizedResolution.items.reduce((sum, item) => sum + item.monto_entregado, 0))
      const refundedAmount = roundMoney(normalizedResolution.items.reduce((sum, item) => sum + item.monto_reembolsado, 0))

      // Guard: el monto a reembolsar nunca puede superar el total de la venta
      // (con tolerancia de un centavo por redondeos). Aborta la transacción.
      const ventaTotal = Number(venta.total ?? 0)
      if (refundedAmount > ventaTotal + 0.01) {
        await insertAudit(tx, {
          ventaId: venta.id,
          empresaId: input.empresaId,
          eventoId: venta.evento_id,
          barraId: venta.barra_id,
          actorId: input.actorId,
          actorType: input.actorType,
          accion: 'resolve_rejected',
          motivo: 'refund_excede_total',
          detalle: { refunded_amount: refundedAmount, venta_total: ventaTotal },
        })
        txResult = { ok: false, motivo: 'El monto a reembolsar no puede superar el total de la venta' }
        return
      }

      const nextEstado = deriveResolvedEstado(deliveredAmount, refundedAmount)
      const nextNeto = deriveResolvedNetoAmount(venta, deliveredAmount)

      let refundCaseId: string | null = null
      if (refundedAmount > 0) {
        if (!venta.checkout_session_id) {
          txResult = { ok: false, motivo: 'La venta no tiene una compra confirmada asociada para ejecutar el refund automático' }
          return
        }

        // FOR UPDATE Site 3 — lock checkout_session
        const checkoutSession = await lockCheckoutSession(tx, venta.checkout_session_id, input.empresaId)
        if (!checkoutSession?.payment_id) {
          txResult = { ok: false, motivo: 'La compra original no tiene payment_id para ejecutar el refund automático' }
          return
        }

        const automaticRefundCase = await createAutomaticRefundCase(tx, {
          venta,
          empresaId: input.empresaId,
          actorId: input.actorId,
          actorType: input.actorType,
          checkoutSession,
          refundAmount: refundedAmount,
          nextEstado,
          resolvedItems: normalizedResolution.items,
        })

        if (!automaticRefundCase.ok) {
          txResult = { ok: false, motivo: automaticRefundCase.motivo }
          return
        }

        refundCaseId = automaticRefundCase.refundCaseId

        // Note: reversePlatformAllocationsProportionally cannot be called inside Prisma tx
        // (mixed drivers — it uses mysql2 PoolConnection path). Moved post-commit (best-effort).
      }

      await tx.$executeRaw`
        DELETE FROM consumibles_venta_resolucion_items WHERE venta_id = ${venta.id}`

      for (const item of normalizedResolution.items) {
        await tx.$executeRaw`
          INSERT INTO consumibles_venta_resolucion_items
          (id, venta_id, venta_item_id, consumible_id, nombre_snapshot, cantidad_total, cantidad_entregada, cantidad_reembolsada,
           monto_entregado, monto_reembolsado, resolution_reason, actor_id, actor_type)
          VALUES (
            ${uuidv4()}, ${venta.id}, ${item.venta_item_id}, ${item.consumible_id},
            ${item.nombre}, ${item.cantidad},
            ${item.cantidad_entregada}, ${item.cantidad_reembolsada},
            ${item.monto_entregado}, ${item.monto_reembolsado},
            ${item.resolution_reason ?? null},
            ${input.actorId}, ${input.actorType}
          )`
      }

      await tx.$executeRaw`
        UPDATE consumibles_ventas
        SET estado = ${nextEstado},
            canjeado_at = ${nextEstado === 'canjeado' ? new Date() : null},
            resuelto_at = NOW(),
            delivered_amount = ${deliveredAmount},
            refunded_amount = ${refundedAmount},
            refund_case_id = ${refundCaseId},
            neto_empresa_amount = ${nextNeto}
        WHERE id = ${venta.id}`

      await insertAudit(tx, {
        ventaId: venta.id,
        empresaId: input.empresaId,
        eventoId: venta.evento_id,
        barraId: venta.barra_id,
        actorId: input.actorId,
        actorType: input.actorType,
        accion: 'resolve_ok',
        detalle: {
          estado: nextEstado,
          delivered_amount: deliveredAmount,
          refunded_amount: refundedAmount,
          refund_case_id: refundCaseId,
        },
      })

      txResult = {
        ok: true,
        venta_id: venta.id,
        barra_id: venta.barra_id,
        estado: nextEstado,
        total: Number(venta.total),
        delivered_amount: deliveredAmount,
        refunded_amount: refundedAmount,
        refund_case_id: refundCaseId,
        items: normalizedResolution.items,
        // Post-commit metadata (stripped before return)
        _postCommitRefundCaseId: refundCaseId,
        _postCommitVentaId: venta.id,
        _postCommitVentaTotal: Number(venta.total ?? 0),
        _postCommitEmpresaId: input.empresaId,
      }
    }, {
      isolationLevel: 'Serializable',
      maxWait: 5000,
      timeout: 15000,
    })
  )

  if (!txResult) throw new Error('resolve_consumibles_redeem_failed')

  // Post-commit: reverse platform allocations if refund occurred (best-effort, idempotent)
  if ((txResult as TxResult).ok && (txResult as TxResult & { _postCommitRefundCaseId?: string | null })._postCommitRefundCaseId) {
    const r = txResult as TxResult & {
      _postCommitRefundCaseId: string
      _postCommitVentaId: string
      _postCommitVentaTotal: number
      _postCommitEmpresaId: string
      refunded_amount: number
    }
    await reversePlatformAllocationsProportionally({
      sourceType: 'consumible_venta',
      sourceId: r._postCommitVentaId,
      refundAmount: r.refunded_amount,
      sourceAmount: r._postCommitVentaTotal,
      empresaId: r._postCommitEmpresaId,
      reason: 'bar_stockout_auto_refund',
      referenceType: 'refund_manual_case',
      referenceId: r._postCommitRefundCaseId,
    }).catch(() => {
      // best-effort: reversal is idempotent and can be retried
    })
  }

  // Strip internal post-commit fields before returning
  const {
    _postCommitRefundCaseId: _a,
    _postCommitVentaId: _b,
    _postCommitVentaTotal: _c,
    _postCommitEmpresaId: _d,
    ...result
  } = txResult as TxResult & {
    _postCommitRefundCaseId?: unknown
    _postCommitVentaId?: unknown
    _postCommitVentaTotal?: unknown
    _postCommitEmpresaId?: unknown
  }

  return result as ConsumiblesRedeemResolveResult
}

export async function confirmConsumiblesRedeem(input: {
  ventaId: string
  barraId: string
  empresaId: string
  actorId: string
  actorType: ActorType
}) {
  return resolveConsumiblesRedeem({ ...input, shorthandAllDelivered: true })
}
