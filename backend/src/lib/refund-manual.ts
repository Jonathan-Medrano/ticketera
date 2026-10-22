import { randomUUID as uuidv4 } from 'node:crypto'
import { PaymentRefund } from 'mercadopago'
import { Prisma } from '@prisma/client'
import { prismaDirectUrl } from './prisma'
import { getMercadoPagoClientByEmpresaId, getPaymentAccountByEmpresaId } from './payment-accounts'
import { reversePlatformAllocationsForSources, reversePlatformAllocationsProportionally } from './platform-profit-sharing'
import { safeCsvCell } from './csv-escape'

// Prisma transaction client type — used by refund helpers that are inside
// prismaDirectUrl.$transaction(). Strategy A from migrate-to-postgres-prisma design.
type PrismaTx = Omit<typeof prismaDirectUrl, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>

async function withSerializableRetry<T>(fn: () => Promise<T>, retries = 3, backoffMs = 100): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (err: unknown) {
      const prismaErr = err as { code?: string }
      if (prismaErr?.code === 'P2034' && attempt < retries) {
        await new Promise((r) => setTimeout(r, backoffMs * (attempt + 1)))
        continue
      }
      throw err
    }
  }
  throw new Error('unreachable')
}

export type RefundManualFlow = 'entradas' | 'consumibles'
export type BuyerAutomaticRefundScope = 'consumibles' | 'entradas' | 'todos'
export type BuyerAutomaticRefundMode = 'manual' | BuyerAutomaticRefundScope
export type RefundManualStatus =
  | 'requested'
  | 'under_review'
  | 'approved_for_manual_execution'
  | 'rejected'
  | 'executed'
  | 'resolved_non_refundable'

export type RefundRequestOrigin = 'company_manual' | 'buyer_event_request' | 'buyer_consumible_request' | 'bar_stockout_auto'

export type RefundManualCasesQuery = {
  status?: string
  query?: string
  buyer?: string
  event?: string
  flow?: RefundManualFlow | 'all'
  sortOrder?: 'date_desc' | 'date_asc'
}

type CheckoutSessionRow = {
  id: string
  comprador_id: string | null
  empresa_id: string
  datos: string | Record<string, unknown> | unknown[]
  estado: string
  confirmed_at: string | Date | null
  payment_id: string | null
  payment_status: string | null
  reconciliation_status: string | null
  comprador_nombre: string | null
  comprador_email: string | null
}

type RefundManualCaseRow = {
  id: string
  empresa_id: string
  checkout_session_id: string
  flow: RefundManualFlow
  status: RefundManualStatus
  payment_id: string | null
  payment_status: string | null
  reconciliation_status: string | null
  requested_amount: number | string
  currency: string
  request_reason: string
  request_note: string | null
  request_origin: RefundRequestOrigin
  external_refund_reference: string | null
  evidence_note: string | null
  requester_actor_id: string
  requester_actor_type: string
  requester_buyer_id: string | null
  requested_event_id: string | null
  requested_entry_id: string | null
  requested_sale_id: string | null
  company_policy_snapshot: number
  event_policy_snapshot: number
  created_by: string
  resolved_by: string | null
  created_at: string | Date
  updated_at: string | Date
  resolved_at: string | Date | null
}

type RefundManualCaseSummaryRow = RefundManualCaseRow & {
  buyer_name: string | null
  buyer_email: string | null
  requested_event_name: string | null
  requested_entry_label: string | null
}

export type RefundManualCaseExportRow = {
  case_id: string
  created_at: string
  resolved_at: string
  checkout_session_id: string
  flow: RefundManualFlow
  status: RefundManualStatus
  request_origin: RefundRequestOrigin
  requested_event_name: string
  buyer_name: string
  requested_amount: number
  currency: string
  payment_status: string
  reconciliation_status: string
  request_reason: string
  external_refund_reference: string
}

type RefundManualEventRow = {
  id: string
  case_id: string
  event_type: string
  actor_id: string
  actor_type: string
  payload_json: string | null
  created_at: string | Date
}

type RefundManualCaseItemRow = {
  id: string
  case_id: string
  target_type: 'entrada' | 'consumible_venta'
  target_id: string
  target_status_before: string | null
  target_status_after: string | null
  eligibility: string
  block_reason: string | null
  amount_snapshot: number | string | null
  created_at: string | Date
}

type RefundManualCaseConsumibleItemRow = {
  id: string
  case_id: string
  venta_id: string
  venta_item_id: string
  consumible_id: string | null
  nombre_snapshot: string
  quantity_original: number
  quantity_requested: number
  quantity_executed: number
  quantity_rejected: number
  unit_price_snapshot: number | string
  amount_snapshot: number | string
  status: RefundManualStatus
  created_at: string | Date
  updated_at: string | Date
}

type EntradaLinkRow = {
  id: string
  evento_id: string
  estado: string
  precio_pagado: number | string | null
  comprador_id: string | null
  // Only populated by the query in executeRefundManualCase's cancellation loop (seated events).
  asiento_id?: string | null
}

type BuyerEntryRow = {
  entrada_id: string
  entrada_estado: string
  entrada_created_at: string | Date | null
  precio_pagado: number | string | null
  comprador_id: string | null
  evento_id: string
  evento_nombre: string | null
  evento_refunds_enabled: boolean
  empresa_refunds_enabled: boolean
  empresa_auto_refunds_enabled: boolean
  empresa_auto_refunds_scope: string | null
  empresa_cool_off_window_hours: number | null
  empresa_request_window_days: number | null
  checkout_session_id: string | null
  checkout_estado: string | null
  confirmed_at: string | Date | null
}

type AutomaticRefundResult = {
  refundReference: string | null
  refundStatus: string | null
  refundedAmount: number | null
}

function roundRefundAmount(amount: number) {
  return Number(amount.toFixed(2))
}

function getRefundAmountFromCaseItems(items: Array<{ amount_snapshot: number | string | null }>) {
  return roundRefundAmount(
    items.reduce((sum, item) => sum + Number(item.amount_snapshot ?? 0), 0)
  )
}

type ConsumibleVentaLinkRow = {
  id: string
  estado: 'pendiente' | 'canjeado' | 'cancelado'
  total: number | string
  checkout_session_id: string | null
}

type RefundRequestedContextRow = {
  entrada_id: string
  clave_corta: string | null
  evento_id: string
  evento_nombre: string | null
}

type BuyerConsumibleVentaRow = {
  venta_id: string
  venta_estado: 'pendiente' | 'canjeado' | 'cancelado' | 'resuelto_parcial'
  venta_total: number | string
  checkout_session_id: string | null
  comprador_id: string | null
  empresa_id: string
  evento_id: string
  evento_nombre: string | null
  barra_nombre: string | null
  barra_buyer_refunds_enabled: boolean
  empresa_auto_refunds_enabled: boolean
  empresa_auto_refunds_scope: string | null
  empresa_cool_off_window_hours: number | null
  empresa_request_window_days: number | null
  checkout_confirmed_at: string | Date | null
  item_id: string
  consumible_id: string
  nombre: string
  cantidad: number
  precio_unitario: number | string
  subtotal: number | string
}

type ExecutedRefundConflictRow = {
  id: string
  external_refund_reference: string | null
  conflict_target_type: 'entrada' | 'consumible_venta'
  conflict_target_id: string
}

type RefundExecutionEntryConflictRow = {
  id: string
  estado: 'valida' | 'usada' | 'cancelada'
}

type RefundExecutionConsumibleConflictRow = {
  id: string
  estado: 'pendiente' | 'canjeado' | 'cancelado' | 'resuelto_parcial'
}

type RefundExecutionConsumibleQuantityConflictRow = {
  venta_item_id: string
  quantity_original: number
  executed_quantity: number
  conflict_case_id: string | null
  external_refund_reference: string | null
}

type CheckoutSessionData = {
  flow?: 'entradas' | 'consumibles'
  items?: Array<Record<string, unknown>>
  marketplaceFee?: {
    currency?: string
  } | null
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback

  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function parseCheckoutSessionData(raw: CheckoutSessionRow['datos']): CheckoutSessionData {
  if (Array.isArray(raw)) {
    return { flow: 'entradas', items: raw as Array<Record<string, unknown>>, marketplaceFee: null }
  }

  if (typeof raw === 'string') {
    return parseCheckoutSessionData(parseJson<CheckoutSessionData | Array<Record<string, unknown>>>(raw, { items: [] }) as CheckoutSessionRow['datos'])
  }

  if (!raw || typeof raw !== 'object') {
    return { flow: 'entradas', items: [], marketplaceFee: null }
  }

  return {
    flow: raw.flow === 'consumibles' ? 'consumibles' : 'entradas',
    items: Array.isArray(raw.items) ? raw.items : [],
    marketplaceFee: raw.marketplaceFee && typeof raw.marketplaceFee === 'object' ? raw.marketplaceFee : null,
  }
}

function detectFlow(raw: CheckoutSessionRow['datos']): RefundManualFlow {
  const sessionData = parseCheckoutSessionData(raw)
  return sessionData.flow === 'consumibles' ? 'consumibles' : 'entradas'
}

function deriveRequestedAmount(raw: CheckoutSessionRow['datos']) {
  const sessionData = parseCheckoutSessionData(raw)
  return Number(
    (sessionData.items ?? []).reduce((total, item) => {
      const price = Number(item.precio ?? 0)
      const quantity = Number(item.cantidad ?? 0)
      return total + price * quantity
    }, 0)
  )
}

function deriveCurrency(raw: CheckoutSessionRow['datos']) {
  const sessionData = parseCheckoutSessionData(raw)
  return typeof sessionData.marketplaceFee?.currency === 'string' && sessionData.marketplaceFee.currency.trim()
    ? sessionData.marketplaceFee.currency.trim().toUpperCase()
    : 'ARS'
}

export function normalizeBuyerAutomaticRefundMode(enabled: unknown, scope: unknown): BuyerAutomaticRefundMode {
  if (!(Number(enabled) === 1 || enabled === true)) return 'manual'
  if (scope === 'consumibles' || scope === 'entradas' || scope === 'todos') return scope
  return 'todos'
}

export function shouldAutoRefundBuyerFlow(mode: BuyerAutomaticRefundMode, flow: RefundManualFlow) {
  if (mode === 'manual') return false
  if (mode === 'todos') return true
  return mode === flow
}

/**
 * Cool-off gate para auto-refund.
 *
 * - Si window_hours = 0 → no aplica, devuelve true (comportamiento previo: si está habilitado
 *   el auto-refund, va sin importar tiempo)
 * - Si window_hours > 0 → solo auto-refund si la compra fue hace <= N horas
 * - Si confirmed_at es null (no debería pasar en este punto), no auto-aprueba como seguridad
 *
 * Devuelve true si auto-refund es permitido, false si debe quedar 'requested' para revisión manual.
 */
export function isWithinCoolOffWindow(params: {
  windowHours: number | null | undefined
  confirmedAt: Date | string | null | undefined
  now?: Date
}): boolean {
  const window = Number(params.windowHours ?? 0)
  if (!Number.isFinite(window) || window <= 0) return true // sin cool-off configurado → no gate
  if (!params.confirmedAt) return false
  const confirmed = params.confirmedAt instanceof Date ? params.confirmedAt : new Date(params.confirmedAt)
  if (Number.isNaN(confirmed.getTime())) return false
  const now = params.now ?? new Date()
  const elapsedMs = now.getTime() - confirmed.getTime()
  const windowMs = window * 60 * 60 * 1000
  return elapsedMs <= windowMs
}

/**
 * Gate del plazo del comprador para PEDIR reembolso.
 *
 * - Si window_days <= 0 → la empresa desactivo el plazo y se permite siempre (devolvemos true)
 * - Si purchasedAt es null → no se puede calcular, no permitir (false) por seguridad
 * - Si purchasedAt + window_days >= now → dentro del plazo (true)
 *
 * Devuelve true si el comprador todavia puede pedir reembolso para esa entrada.
 */
export function isWithinBuyerRequestWindow(params: {
  windowDays: number | null | undefined
  purchasedAt: Date | string | null | undefined
  now?: Date
}): boolean {
  const window = Number(params.windowDays ?? 0)
  if (!Number.isFinite(window) || window <= 0) return true // sin ventana configurada → no gate
  if (!params.purchasedAt) return false
  const purchased = params.purchasedAt instanceof Date ? params.purchasedAt : new Date(params.purchasedAt)
  if (Number.isNaN(purchased.getTime())) return false
  const now = params.now ?? new Date()
  const deadlineMs = purchased.getTime() + window * 24 * 60 * 60 * 1000
  return now.getTime() <= deadlineMs
}

async function attemptAutomaticBuyerRefund(input: {
  empresaId: string
  refundCaseId: string
  flow: RefundManualFlow
}) {
  const actorId = 'system:auto-refund-policy'

  return executeRefundManualCase({
    caseId: input.refundCaseId,
    empresaId: input.empresaId,
    actorId,
    actorType: 'empresa',
    ...(input.flow === 'consumibles'
      ? { evidenceNote: 'Refund automático por política de reembolsos de comprador.' }
      : {}),
  })
}

function toCaseSummary(row: RefundManualCaseRow) {
  return {
    id: row.id,
    checkout_session_id: row.checkout_session_id,
    flow: row.flow,
    status: row.status,
    requested_amount: Number(row.requested_amount ?? 0),
    currency: row.currency,
    payment_id: row.payment_id,
    payment_status: row.payment_status,
    reconciliation_status: row.reconciliation_status,
    request_reason: row.request_reason,
    request_note: row.request_note,
    request_origin: row.request_origin ?? 'company_manual',
    external_refund_reference: row.external_refund_reference,
    evidence_note: row.evidence_note,
    requester_actor_id: row.requester_actor_id,
    requester_actor_type: row.requester_actor_type,
    requester_buyer_id: row.requester_buyer_id ?? null,
    requested_event_id: row.requested_event_id ?? null,
    requested_entry_id: row.requested_entry_id ?? null,
    requested_sale_id: row.requested_sale_id ?? null,
    company_policy_snapshot: Number(row.company_policy_snapshot ?? 0),
    event_policy_snapshot: Number(row.event_policy_snapshot ?? 0),
    created_by: row.created_by,
    resolved_by: row.resolved_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
    resolved_at: row.resolved_at,
  }
}

function toCaseSummaryFromListRow(row: RefundManualCaseSummaryRow) {
  return {
    ...toCaseSummary(row),
    buyer_name: row.buyer_name ?? row.requester_buyer_id ?? null,
    buyer_email: row.buyer_email ?? null,
    requested_event_name: row.requested_event_name ?? row.requested_event_id ?? null,
    requested_entry_label: row.requested_entry_label ?? row.requested_entry_id ?? null,
  }
}

async function getCaseSummaryContext(caseRow: RefundManualCaseRow, empresaId: string) {
  const [requestedContext, session] = await Promise.all([
    getRefundRequestedContext(caseRow, empresaId),
    getCheckoutSessionById(caseRow.checkout_session_id, empresaId),
  ])

  return {
    ...requestedContext,
    buyer_name: session?.comprador_nombre ?? caseRow.requester_buyer_id ?? null,
    buyer_email: session?.comprador_email ?? null,
  }
}

function toCaseItem(row: RefundManualCaseItemRow) {
  return {
    id: row.id,
    case_id: row.case_id,
    target_type: row.target_type,
    target_id: row.target_id,
    target_status_before: row.target_status_before,
    target_status_after: row.target_status_after,
    eligibility: row.eligibility,
    block_reason: row.block_reason,
    amount_snapshot: row.amount_snapshot == null ? null : Number(row.amount_snapshot),
    created_at: row.created_at,
  }
}

function toConsumibleCaseItem(row: RefundManualCaseConsumibleItemRow) {
  return {
    id: row.id,
    case_id: row.case_id,
    venta_id: row.venta_id,
    venta_item_id: row.venta_item_id,
    consumible_id: row.consumible_id,
    nombre: row.nombre_snapshot,
    quantity_original: Number(row.quantity_original ?? 0),
    quantity_requested: Number(row.quantity_requested ?? 0),
    quantity_executed: Number(row.quantity_executed ?? 0),
    quantity_rejected: Number(row.quantity_rejected ?? 0),
    unit_price_snapshot: Number(row.unit_price_snapshot ?? 0),
    amount_snapshot: Number(row.amount_snapshot ?? 0),
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

function buildPurchaseContext(session: CheckoutSessionRow) {
  const flow = detectFlow(session.datos)
  const sessionData = parseCheckoutSessionData(session.datos)

  return {
    checkout_session_id: session.id,
    flow,
    checkout_status: session.estado,
    confirmed_at: session.confirmed_at,
    payment_id: session.payment_id,
    payment_status: session.payment_status,
    reconciliation_status: session.reconciliation_status,
    requested_amount: deriveRequestedAmount(session.datos),
    currency: deriveCurrency(session.datos),
    buyer: {
      id: session.comprador_id,
      nombre: session.comprador_nombre,
      email: session.comprador_email,
    },
    items_count: Array.isArray(sessionData.items) ? sessionData.items.length : 0,
  }
}

async function getRefundRequestedContext(caseRow: RefundManualCaseRow, empresaId: string) {
  if (caseRow.requested_entry_id) {
    const rows = await prismaDirectUrl.$queryRaw<RefundRequestedContextRow[]>`
      SELECT en.id AS entrada_id, en.clave_corta, ev.id AS evento_id, ev.nombre AS evento_nombre
      FROM entradas en
      JOIN eventos ev ON ev.id = en.evento_id
      WHERE en.id = ${caseRow.requested_entry_id} AND ev.empresa_id = ${empresaId}
      LIMIT 1
    `

    if (rows[0]) {
      return {
        requested_entry_label: rows[0].clave_corta ?? rows[0].entrada_id,
        requested_event_name: rows[0].evento_nombre ?? caseRow.requested_event_id,
      }
    }
  }

  if (caseRow.requested_event_id) {
    const rows = await prismaDirectUrl.$queryRaw<{ nombre: string }[]>`
      SELECT nombre FROM eventos WHERE id = ${caseRow.requested_event_id} AND empresa_id = ${empresaId} LIMIT 1
    `

    if (rows[0]) {
      return {
        requested_entry_label: caseRow.requested_entry_id,
        requested_event_name: typeof rows[0].nombre === 'string' ? rows[0].nombre : caseRow.requested_event_id,
      }
    }
  }

  return {
    requested_entry_label: caseRow.requested_entry_id,
    requested_event_name: caseRow.requested_event_id,
  }
}

async function lockCheckoutSession(
  tx: PrismaTx,
  checkoutSessionId: string,
  empresaId: string
) {
  const rows = await tx.$queryRaw<CheckoutSessionRow[]>`
    SELECT cs.id, cs.comprador_id, cs.empresa_id, cs.datos, cs.estado, cs.confirmed_at,
           cs.payment_id, cs.payment_status, cs.reconciliation_status,
           c.nombre AS comprador_nombre, c.email AS comprador_email
    FROM checkout_sessions cs
    LEFT JOIN compradores c ON c.id = cs.comprador_id
    WHERE cs.id = ${checkoutSessionId} AND cs.empresa_id = ${empresaId}
    LIMIT 1
    FOR UPDATE OF cs
  `
  return rows[0] ?? null
}

async function getCheckoutSessionById(checkoutSessionId: string, empresaId: string) {
  const rows = await prismaDirectUrl.$queryRaw<CheckoutSessionRow[]>`
    SELECT cs.id, cs.comprador_id, cs.empresa_id, cs.datos, cs.estado, cs.confirmed_at,
           cs.payment_id, cs.payment_status, cs.reconciliation_status,
           c.nombre AS comprador_nombre, c.email AS comprador_email
    FROM checkout_sessions cs
    LEFT JOIN compradores c ON c.id = cs.comprador_id
    WHERE cs.id = ${checkoutSessionId} AND cs.empresa_id = ${empresaId}
    LIMIT 1
  `
  return rows[0] ?? null
}

async function getCaseEvents(caseId: string) {
  const rows = await prismaDirectUrl.$queryRaw<RefundManualEventRow[]>`
    SELECT id, case_id, event_type, actor_id, actor_type, payload_json, created_at
    FROM refund_manual_case_events
    WHERE case_id = ${caseId}
    ORDER BY created_at ASC, id ASC
  `

  return rows.map((row) => ({
    id: row.id,
    case_id: row.case_id,
    event_type: row.event_type,
    actor_id: row.actor_id,
    actor_type: row.actor_type,
    payload: parseJson<Record<string, unknown> | null>(row.payload_json, null),
    created_at: row.created_at,
  }))
}

async function getCaseItems(caseId: string) {
  const rows = await prismaDirectUrl.$queryRaw<RefundManualCaseItemRow[]>`
    SELECT id, case_id, target_type, target_id, target_status_before, target_status_after,
           eligibility, block_reason, amount_snapshot, created_at
    FROM refund_manual_case_items
    WHERE case_id = ${caseId}
    ORDER BY created_at ASC, id ASC
  `
  return rows.map(toCaseItem)
}

async function getCaseConsumibleItems(caseId: string) {
  const rows = await prismaDirectUrl.$queryRaw<RefundManualCaseConsumibleItemRow[]>`
    SELECT id, case_id, venta_id, venta_item_id, consumible_id, nombre_snapshot,
           quantity_original, quantity_requested, quantity_executed, quantity_rejected,
           unit_price_snapshot, amount_snapshot, status, created_at, updated_at
    FROM refund_manual_case_consumible_items
    WHERE case_id = ${caseId}
    ORDER BY created_at ASC, id ASC
  `
  return rows.map(toConsumibleCaseItem)
}

async function getCaseItemsForUpdate(tx: PrismaTx, caseId: string) {
  return tx.$queryRaw<RefundManualCaseItemRow[]>`
    SELECT id, case_id, target_type, target_id, target_status_before, target_status_after,
           eligibility, block_reason, amount_snapshot, created_at
    FROM refund_manual_case_items
    WHERE case_id = ${caseId}
    ORDER BY created_at ASC, id ASC
    FOR UPDATE
  `
}

async function getCaseConsumibleItemsForUpdate(tx: PrismaTx, caseId: string) {
  return tx.$queryRaw<RefundManualCaseConsumibleItemRow[]>`
    SELECT id, case_id, venta_id, venta_item_id, consumible_id, nombre_snapshot,
           quantity_original, quantity_requested, quantity_executed, quantity_rejected,
           unit_price_snapshot, amount_snapshot, status, created_at, updated_at
    FROM refund_manual_case_consumible_items
    WHERE case_id = ${caseId}
    ORDER BY created_at ASC, id ASC
    FOR UPDATE
  `
}

async function lockRefundManualCase(tx: PrismaTx, caseId: string, empresaId: string) {
  const rows = await tx.$queryRaw<RefundManualCaseRow[]>`
    SELECT *
    FROM refund_manual_cases
    WHERE id = ${caseId} AND empresa_id = ${empresaId}
    LIMIT 1
    FOR UPDATE
  `
  return rows[0] ?? null
}

async function insertCaseEvent(
  tx: PrismaTx,
  input: {
    caseId: string
    eventType: string
    actorId: string
    actorType: 'empresa' | 'empleado' | 'comprador'
    payload?: Record<string, unknown> | null
  }
) {
  const id = uuidv4()
  const payloadJson = input.payload ? JSON.stringify(input.payload) : null
  await tx.$executeRaw`
    INSERT INTO refund_manual_case_events
    (id, case_id, event_type, actor_id, actor_type, payload_json)
    VALUES (${id}, ${input.caseId}, ${input.eventType}, ${input.actorId}, ${input.actorType}, ${payloadJson})
  `
}

function getBlockedItems<T extends { eligibility: string; block_reason: string | null }>(items: T[]) {
  return items.filter((item) => item.eligibility !== 'elegible')
}

function getCaseItemsErrorMessage(items: Array<{ target_type: string; target_id: string; block_reason: string | null }>) {
  const firstBlocked = items[0]
  if (!firstBlocked) return 'Hay items bloqueados en el caso'

  return `${firstBlocked.target_type} ${firstBlocked.target_id} bloqueado: ${firstBlocked.block_reason ?? 'sin motivo'}`
}

function getConsumablesNonRefundableMessage() {
  return 'Los consumibles deben resolverse como no reembolsables en este MVP'
}

function normalizeOptionalText(value?: string | null) {
  return value?.trim() ? value.trim() : null
}

function formatCsvDateTime(value: string | Date | null | undefined) {
  if (!value) return ''

  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })

  return formatter.format(date)
}

export function toCsv(rows: Array<Record<string, unknown>>, columns: string[]) {
  const header = columns.map(safeCsvCell).join(',')
  const body = rows.map((row) => columns.map((column) => safeCsvCell(row[column])).join(',')).join('\n')
  return body ? `${header}\n${body}\n` : `${header}\n`
}

export const REFUND_MANUAL_EXPORT_COLUMNS = [
  'case_id',
  'created_at',
  'resolved_at',
  'checkout_session_id',
  'flow',
  'status',
  'request_origin',
  'requested_event_name',
  'buyer_name',
  'requested_amount',
  'currency',
  'payment_status',
  'reconciliation_status',
  'request_reason',
  'external_refund_reference',
] as const

function resolveRefundManualSortOrder(sortOrder?: string) {
  return sortOrder === 'date_asc'
    ? 'c.created_at ASC, c.id ASC'
    : 'c.created_at DESC, c.id DESC'
}

function buildRefundManualCasesWhereClause(empresaId: string, query: RefundManualCasesQuery) {
  const values: unknown[] = []
  let n = 0
  const next = () => `$${++n}`

  const where = [`c.empresa_id = ${next()}`]
  values.push(empresaId)

  if (typeof query.status === 'string' && query.status.trim()) {
    where.push(`c.status = ${next()}`)
    values.push(query.status.trim())
  }

  if (query.flow && query.flow !== 'all') {
    where.push(`c.flow = ${next()}`)
    values.push(query.flow)
  }

  const normalizedBuyer = normalizeOptionalText(query.buyer)
  if (normalizedBuyer) {
    where.push(`COALESCE(cb.nombre, c.requester_buyer_id, '') ILIKE ${next()}`)
    values.push(`%${normalizedBuyer}%`)
  }

  const normalizedEvent = normalizeOptionalText(query.event)
  if (normalizedEvent && normalizedEvent !== 'all') {
    where.push(`COALESCE(en_event.nombre, direct_event.nombre, sale_event.nombre, c.requested_event_id, '') = ${next()}`)
    values.push(normalizedEvent)
  }

  const normalizedQuery = normalizeOptionalText(query.query)
  if (normalizedQuery) {
    const p1 = next(), p2 = next(), p3 = next(), p4 = next(), p5 = next()
    where.push(`(
      c.request_reason ILIKE ${p1}
      OR c.checkout_session_id ILIKE ${p2}
      OR COALESCE(en_event.nombre, direct_event.nombre, sale_event.nombre, c.requested_event_id, '') ILIKE ${p3}
      OR COALESCE(cb.nombre, c.requester_buyer_id, '') ILIKE ${p4}
      OR COALESCE(c.requested_entry_id, '') ILIKE ${p5}
    )`)
    const searchValue = `%${normalizedQuery}%`
    values.push(searchValue, searchValue, searchValue, searchValue, searchValue)
  }

  return {
    whereClause: where.join(' AND '),
    values,
  }
}

function buildRefundManualCasesSelectQuery(whereClause: string, limitClause = '') {
  return `SELECT c.*, cb.nombre AS buyer_name, cb.email AS buyer_email,
                 COALESCE(en_event.nombre, direct_event.nombre, sale_event.nombre, c.requested_event_id) AS requested_event_name,
                 COALESCE(en.clave_corta, c.requested_entry_id) AS requested_entry_label
          FROM refund_manual_cases c
          LEFT JOIN checkout_sessions cs ON cs.id = c.checkout_session_id AND cs.empresa_id = c.empresa_id
          LEFT JOIN compradores cb ON cb.id = cs.comprador_id
          LEFT JOIN entradas en ON en.id = c.requested_entry_id
          LEFT JOIN eventos en_event ON en_event.id = en.evento_id AND en_event.empresa_id = c.empresa_id
          LEFT JOIN eventos direct_event ON direct_event.id = c.requested_event_id AND direct_event.empresa_id = c.empresa_id
          LEFT JOIN consumibles_ventas cv ON cv.id = c.requested_sale_id AND cv.empresa_id = c.empresa_id
          LEFT JOIN eventos sale_event ON sale_event.id = cv.evento_id AND sale_event.empresa_id = c.empresa_id
          WHERE ${whereClause}
          ${limitClause}`
}

function serializeRefundManualExportRows(rows: RefundManualCaseSummaryRow[]): RefundManualCaseExportRow[] {
  return rows.map((row) => ({
    case_id: row.id,
    created_at: formatCsvDateTime(row.created_at),
    resolved_at: formatCsvDateTime(row.resolved_at),
    checkout_session_id: row.checkout_session_id,
    flow: row.flow,
    status: row.status,
    request_origin: row.request_origin ?? 'company_manual',
    requested_event_name: row.requested_event_name ?? '',
    buyer_name: row.buyer_name ?? row.requester_buyer_id ?? '',
    requested_amount: Number(row.requested_amount ?? 0),
    currency: row.currency,
    payment_status: row.payment_status ?? '',
    reconciliation_status: row.reconciliation_status ?? '',
    request_reason: row.request_reason,
    external_refund_reference: row.external_refund_reference ?? '',
  }))
}

export function resolveRefundManualExportLimit() {
  const raw = Number(process.env.REFUND_MANUAL_EXPORT_MAX_ROWS)
  if (!Number.isFinite(raw) || raw <= 0) return 2000
  return Math.floor(raw)
}

export async function countRefundManualCases(empresaId: string, query: RefundManualCasesQuery = {}) {
  const { whereClause, values } = buildRefundManualCasesWhereClause(empresaId, query)
  const rows = await prismaDirectUrl.$queryRawUnsafe<{ total: bigint }[]>(
    `SELECT COUNT(*) AS total
     FROM refund_manual_cases c
     LEFT JOIN checkout_sessions cs ON cs.id = c.checkout_session_id AND cs.empresa_id = c.empresa_id
     LEFT JOIN compradores cb ON cb.id = cs.comprador_id
     LEFT JOIN entradas en ON en.id = c.requested_entry_id
     LEFT JOIN eventos en_event ON en_event.id = en.evento_id AND en_event.empresa_id = c.empresa_id
     LEFT JOIN eventos direct_event ON direct_event.id = c.requested_event_id AND direct_event.empresa_id = c.empresa_id
     LEFT JOIN consumibles_ventas cv ON cv.id = c.requested_sale_id AND cv.empresa_id = c.empresa_id
     LEFT JOIN eventos sale_event ON sale_event.id = cv.evento_id AND sale_event.empresa_id = c.empresa_id
     WHERE ${whereClause}`,
    ...values
  )

  return Number(rows[0]?.total ?? 0)
}

export async function selectRefundManualCaseSummaries(empresaId: string, query: RefundManualCasesQuery = {}) {
  const { whereClause, values } = buildRefundManualCasesWhereClause(empresaId, query)
  const orderClause = resolveRefundManualSortOrder(query.sortOrder)
  const rows = await prismaDirectUrl.$queryRawUnsafe<RefundManualCaseSummaryRow[]>(
    buildRefundManualCasesSelectQuery(whereClause, `ORDER BY ${orderClause}`),
    ...values
  )

  return rows.map(toCaseSummaryFromListRow)
}

export async function selectRefundManualCasesForExport(empresaId: string, query: RefundManualCasesQuery = {}, limit?: number) {
  const { whereClause, values } = buildRefundManualCasesWhereClause(empresaId, query)
  const orderClause = resolveRefundManualSortOrder(query.sortOrder)
  const hasLimit = typeof limit === 'number' && Number.isFinite(limit) && limit > 0
  const finalValues = hasLimit ? [...values, Math.floor(limit)] : values
  const limitPlaceholder = hasLimit ? ` LIMIT $${values.length + 1}` : ''
  const rows = await prismaDirectUrl.$queryRawUnsafe<RefundManualCaseSummaryRow[]>(
    buildRefundManualCasesSelectQuery(whereClause, `ORDER BY ${orderClause}${limitPlaceholder}`),
    ...finalValues
  )

  return serializeRefundManualExportRows(rows)
}

function isOpenBuyerRefundStatus(status: string | null | undefined) {
  return status === 'requested' || status === 'under_review' || status === 'approved_for_manual_execution'
}

function resolveBuyerRefundPolicy(companyEnabled: unknown, eventEnabled: unknown) {
  return Number(companyEnabled ?? 0) === 1 && Number(eventEnabled ?? 0) === 1
}

async function getOpenBuyerRefundCaseByEntry(tx: PrismaTx, entryId: string, empresaId: string) {
  const rows = await tx.$queryRaw<RefundManualCaseRow[]>`
    SELECT *
    FROM refund_manual_cases
    WHERE empresa_id = ${empresaId}
      AND requested_entry_id = ${entryId}
      AND status IN ('requested', 'under_review', 'approved_for_manual_execution')
    ORDER BY created_at DESC, id DESC
    LIMIT 1
    FOR UPDATE
  `
  return rows[0] ?? null
}

async function getBuyerEntryForRefund(tx: PrismaTx, input: { empresaId: string; buyerId: string; entryId: string }) {
  const rows = await tx.$queryRaw<BuyerEntryRow[]>`
    SELECT en.id AS entrada_id,
           en.estado AS entrada_estado,
           en.created_at AS entrada_created_at,
           en.precio_pagado,
           en.comprador_id,
           ev.id AS evento_id,
           ev.nombre AS evento_nombre,
           COALESCE(ev.buyer_event_refunds_enabled, false) AS evento_refunds_enabled,
           COALESCE(emp.buyer_event_refunds_enabled, false) AS empresa_refunds_enabled,
           COALESCE(emp.buyer_auto_refunds_enabled, false) AS empresa_auto_refunds_enabled,
           emp.buyer_auto_refunds_scope AS empresa_auto_refunds_scope,
           COALESCE(emp.buyer_cool_off_window_hours, 0) AS empresa_cool_off_window_hours,
           COALESCE(emp.buyer_request_window_days, 30) AS empresa_request_window_days,
           alloc.checkout_session_id,
           cs.estado AS checkout_estado,
           cs.confirmed_at
    FROM entradas en
    JOIN eventos ev ON ev.id = en.evento_id
    JOIN empresas emp ON emp.id = ev.empresa_id
    LEFT JOIN platform_sale_allocations alloc
      ON alloc.source_type = 'entrada'
     AND alloc.source_id = en.id
     AND alloc.entry_kind = 'allocation'
    LEFT JOIN checkout_sessions cs
      ON cs.id = alloc.checkout_session_id
     AND cs.empresa_id = emp.id
    WHERE en.id = ${input.entryId}
      AND en.comprador_id = ${input.buyerId}
      AND emp.id = ${input.empresaId}
    ORDER BY alloc.created_at DESC, alloc.id DESC
    LIMIT 1
    FOR UPDATE OF en
  `
  return rows[0] ?? null
}

async function getBuyerConsumibleVentaItemForRefund(tx: PrismaTx, input: {
  empresaId: string
  buyerId: string
  ventaId: string
  ventaItemId: string
}) {
  const rows = await tx.$queryRaw<BuyerConsumibleVentaRow[]>`
    SELECT cv.id AS venta_id,
           cv.estado AS venta_estado,
           cv.total AS venta_total,
           cv.checkout_session_id,
           cv.comprador_id,
           cv.empresa_id,
           cv.evento_id,
           ev.nombre AS evento_nombre,
           b.nombre AS barra_nombre,
           COALESCE(b.buyer_consumible_refunds_enabled, true) AS barra_buyer_refunds_enabled,
           COALESCE(emp.buyer_auto_refunds_enabled, false) AS empresa_auto_refunds_enabled,
           emp.buyer_auto_refunds_scope AS empresa_auto_refunds_scope,
           COALESCE(emp.buyer_cool_off_window_hours, 0) AS empresa_cool_off_window_hours,
           COALESCE(emp.buyer_request_window_days, 30) AS empresa_request_window_days,
           cs.confirmed_at AS checkout_confirmed_at,
           cvi.id AS item_id,
           cvi.consumible_id,
           cvi.nombre_snapshot AS nombre,
           cvi.cantidad,
           cvi.precio_unitario,
           cvi.subtotal
    FROM consumibles_ventas cv
    JOIN consumibles_venta_items cvi ON cvi.venta_id = cv.id
    JOIN eventos ev ON ev.id = cv.evento_id
    JOIN barras b ON b.id = cv.barra_id
    JOIN empresas emp ON emp.id = cv.empresa_id
    LEFT JOIN checkout_sessions cs ON cs.id = cv.checkout_session_id AND cs.empresa_id = cv.empresa_id
    WHERE cv.id = ${input.ventaId}
      AND cvi.id = ${input.ventaItemId}
      AND cv.empresa_id = ${input.empresaId}
      AND cv.comprador_id = ${input.buyerId}
    LIMIT 1
    FOR UPDATE OF cv, cvi
  `
  return rows[0] ?? null
}

async function getOpenBuyerConsumibleRefundCaseBySale(tx: PrismaTx, saleId: string, empresaId: string) {
  const rows = await tx.$queryRaw<RefundManualCaseRow[]>`
    SELECT *
    FROM refund_manual_cases
    WHERE empresa_id = ${empresaId}
      AND requested_sale_id = ${saleId}
      AND request_origin = 'buyer_consumible_request'
      AND status IN ('requested', 'under_review', 'approved_for_manual_execution')
    ORDER BY created_at DESC, id DESC
    LIMIT 1
    FOR UPDATE
  `
  return rows[0] ?? null
}

async function getConsumibleRefundQuantities(tx: PrismaTx, ventaItemId: string) {
  const rows = await tx.$queryRaw<{ executed_quantity: bigint; open_quantity: bigint; rejected_quantity: bigint }[]>`
    SELECT
      COALESCE(SUM(CASE WHEN status = 'executed' THEN quantity_executed ELSE 0 END), 0) AS executed_quantity,
      COALESCE(SUM(CASE WHEN status IN ('requested', 'under_review', 'approved_for_manual_execution') THEN quantity_requested ELSE 0 END), 0) AS open_quantity,
      COALESCE(SUM(CASE WHEN status = 'rejected' THEN quantity_rejected ELSE 0 END), 0) AS rejected_quantity
    FROM refund_manual_case_consumible_items
    WHERE venta_item_id = ${ventaItemId}
  `

  return {
    executedQuantity: Number(rows[0]?.executed_quantity ?? 0),
    openQuantity: Number(rows[0]?.open_quantity ?? 0),
    rejectedQuantity: Number(rows[0]?.rejected_quantity ?? 0),
  }
}

function getConsumibleRefundRequestStatusMessage() {
  return 'La cantidad solicitada supera el remanente elegible para reembolso'
}

async function syncBuyerConsumibleSaleState(tx: PrismaTx, ventaId: string, empresaId: string) {
  const saleRows = await tx.$queryRaw<{ id: string; total: number; estado: string }[]>`
    SELECT id, total, estado
    FROM consumibles_ventas
    WHERE id = ${ventaId} AND empresa_id = ${empresaId}
    LIMIT 1
    FOR UPDATE
  `

  const sale = saleRows[0]
  if (!sale) return

  const itemRows = await tx.$queryRaw<{ id: string; cantidad: number; precio_unitario: number }[]>`
    SELECT cvi.id, cvi.cantidad, cvi.precio_unitario
    FROM consumibles_venta_items cvi
    WHERE cvi.venta_id = ${ventaId}
  `

  let totalRequestedExecuted = 0
  let allExecuted = itemRows.length > 0
  for (const item of itemRows) {
    const quantities = await getConsumibleRefundQuantities(tx, String(item.id))
    totalRequestedExecuted += Number(item.precio_unitario ?? 0) * quantities.executedQuantity
    if (quantities.executedQuantity < Number(item.cantidad ?? 0)) {
      allExecuted = false
    }
  }

  const newEstado = allExecuted ? 'cancelado' : 'pendiente'
  const refundedAmount = totalRequestedExecuted > 0 ? totalRequestedExecuted : null
  await tx.$executeRaw`
    UPDATE consumibles_ventas
    SET estado = ${newEstado},
        refunded_amount = ${refundedAmount},
        refund_case_id = NULL,
        resuelto_at = CASE WHEN ${newEstado} = 'cancelado' THEN NOW() ELSE resuelto_at END
    WHERE id = ${ventaId} AND empresa_id = ${empresaId}
  `
}

async function rejectRefundManualCaseWithinTransaction(
  tx: PrismaTx,
  input: {
    refundCase: RefundManualCaseRow
    empresaId: string
    actorId: string
    actorType: 'empresa' | 'empleado'
    reason: string
    note?: string | null
    evidenceNote?: string | null
    externalRefundReference?: string | null
  }
) {
  if (input.refundCase.request_origin === 'buyer_consumible_request') {
    const consumibleItems = await getCaseConsumibleItemsForUpdate(tx, input.refundCase.id)
    for (const item of consumibleItems) {
      await tx.$executeRaw`
        UPDATE refund_manual_case_consumible_items
        SET status = 'rejected', quantity_rejected = quantity_requested, quantity_executed = 0
        WHERE id = ${item.id} AND case_id = ${input.refundCase.id}
      `
    }
  }

  await transitionRefundManualCase(tx, {
    refundCase: input.refundCase,
    empresaId: input.empresaId,
    actorId: input.actorId,
    actorType: input.actorType,
    nextStatus: 'rejected',
    eventType: 'case_rejected',
    reason: input.reason,
    note: input.note,
    evidenceNote: input.evidenceNote,
    externalRefundReference: input.externalRefundReference,
    resolved: true,
  })
}

async function getExecutedRefundConflictByTargets(
  tx: PrismaTx,
  input: { empresaId: string; caseId: string; entryIds: string[]; saleIds: string[] }
) {
  const entryIds = Array.from(new Set(input.entryIds.filter(Boolean)))
  const saleIds = Array.from(new Set(input.saleIds.filter(Boolean)))

  if (entryIds.length) {
    const rows = await tx.$queryRaw<ExecutedRefundConflictRow[]>`
      SELECT rmc.id,
              rmc.external_refund_reference,
              'entrada' AS conflict_target_type,
              COALESCE(
                CASE WHEN rmc.requested_entry_id IN (${Prisma.join(entryIds)}) THEN rmc.requested_entry_id END,
                (
                  SELECT rmci.target_id
                  FROM refund_manual_case_items rmci
                  WHERE rmci.case_id = rmc.id
                    AND rmci.target_type = 'entrada'
                    AND rmci.target_id IN (${Prisma.join(entryIds)})
                  ORDER BY rmci.created_at ASC, rmci.id ASC
                  LIMIT 1
                )
              ) AS conflict_target_id
       FROM refund_manual_cases rmc
       WHERE rmc.empresa_id = ${input.empresaId}
         AND rmc.status = 'executed'
         AND rmc.id <> ${input.caseId}
         AND (
           rmc.requested_entry_id IN (${Prisma.join(entryIds)})
           OR EXISTS (
             SELECT 1
             FROM refund_manual_case_items rmci
             WHERE rmci.case_id = rmc.id
               AND rmci.target_type = 'entrada'
               AND rmci.target_id IN (${Prisma.join(entryIds)})
           )
         )
       ORDER BY rmc.resolved_at DESC, rmc.created_at DESC, rmc.id DESC
       LIMIT 1
       FOR UPDATE`

    if (rows[0]) return rows[0]
  }

  if (saleIds.length) {
    const rows = await tx.$queryRaw<ExecutedRefundConflictRow[]>`
      SELECT rmc.id,
              rmc.external_refund_reference,
              'consumible_venta' AS conflict_target_type,
              COALESCE(
                CASE WHEN rmc.requested_sale_id IN (${Prisma.join(saleIds)}) THEN rmc.requested_sale_id END,
                (
                  SELECT rmci.target_id
                  FROM refund_manual_case_items rmci
                  WHERE rmci.case_id = rmc.id
                    AND rmci.target_type = 'consumible_venta'
                    AND rmci.target_id IN (${Prisma.join(saleIds)})
                  ORDER BY rmci.created_at ASC, rmci.id ASC
                  LIMIT 1
                ),
                (
                  SELECT rmcci.venta_id
                  FROM refund_manual_case_consumible_items rmcci
                  WHERE rmcci.case_id = rmc.id
                    AND rmcci.venta_id IN (${Prisma.join(saleIds)})
                  ORDER BY rmcci.created_at ASC, rmcci.id ASC
                  LIMIT 1
                )
              ) AS conflict_target_id
       FROM refund_manual_cases rmc
       WHERE rmc.empresa_id = ${input.empresaId}
         AND rmc.status = 'executed'
         AND rmc.id <> ${input.caseId}
         AND (
           rmc.requested_sale_id IN (${Prisma.join(saleIds)})
           OR EXISTS (
             SELECT 1
             FROM refund_manual_case_items rmci
             WHERE rmci.case_id = rmc.id
               AND rmci.target_type = 'consumible_venta'
               AND rmci.target_id IN (${Prisma.join(saleIds)})
           )
           OR EXISTS (
             SELECT 1
             FROM refund_manual_case_consumible_items rmcci
             WHERE rmcci.case_id = rmc.id
               AND rmcci.venta_id IN (${Prisma.join(saleIds)})
           )
         )
       ORDER BY rmc.resolved_at DESC, rmc.created_at DESC, rmc.id DESC
       LIMIT 1
       FOR UPDATE`

    if (rows[0]) return rows[0]
  }

  return null
}

async function getRefundExecutionEntryConflict(
  tx: PrismaTx,
  input: { empresaId: string; entryIds: string[] }
) {
  if (!input.entryIds.length) return null

  const rows = await tx.$queryRaw<RefundExecutionEntryConflictRow[]>`
    SELECT en.id, en.estado
     FROM entradas en
     JOIN eventos ev ON ev.id = en.evento_id
     WHERE ev.empresa_id = ${input.empresaId}
       AND en.id IN (${Prisma.join(input.entryIds)})
       AND en.estado = 'usada'
     ORDER BY en.id ASC
     LIMIT 1
     FOR UPDATE`

  return rows[0] ?? null
}

async function getRefundExecutionConsumibleConflict(
  tx: PrismaTx,
  input: { empresaId: string; saleIds: string[] }
) {
  if (!input.saleIds.length) return null

  const rows = await tx.$queryRaw<RefundExecutionConsumibleConflictRow[]>`
    SELECT id, estado
     FROM consumibles_ventas
     WHERE empresa_id = ${input.empresaId}
       AND id IN (${Prisma.join(input.saleIds)})
       AND estado IN ('canjeado', 'resuelto_parcial')
     ORDER BY id ASC
     LIMIT 1
     FOR UPDATE`

  return rows[0] ?? null
}

async function getRefundExecutionConsumibleQuantityConflict(
  tx: PrismaTx,
  input: { caseId: string; consumibleItems: RefundManualCaseConsumibleItemRow[] }
) {
  for (const item of input.consumibleItems) {
    const rows = await tx.$queryRaw<RefundExecutionConsumibleQuantityConflictRow[]>`
      SELECT cvi.id AS venta_item_id,
             cvi.cantidad AS quantity_original,
             COALESCE((
               SELECT SUM(rmcci.quantity_executed)
               FROM refund_manual_case_consumible_items rmcci
               WHERE rmcci.venta_item_id = cvi.id
                 AND rmcci.status = 'executed'
                 AND rmcci.case_id <> ${input.caseId}
             ), 0) AS executed_quantity,
             (
               SELECT rmc.id
               FROM refund_manual_case_consumible_items rmcci
               JOIN refund_manual_cases rmc ON rmc.id = rmcci.case_id
               WHERE rmcci.venta_item_id = cvi.id
                 AND rmcci.status = 'executed'
                 AND rmcci.case_id <> ${input.caseId}
               ORDER BY rmc.resolved_at DESC, rmc.created_at DESC, rmc.id DESC
               LIMIT 1
             ) AS conflict_case_id,
             (
               SELECT rmc.external_refund_reference
               FROM refund_manual_case_consumible_items rmcci
               JOIN refund_manual_cases rmc ON rmc.id = rmcci.case_id
               WHERE rmcci.venta_item_id = cvi.id
                 AND rmcci.status = 'executed'
                 AND rmcci.case_id <> ${input.caseId}
               ORDER BY rmc.resolved_at DESC, rmc.created_at DESC, rmc.id DESC
               LIMIT 1
             ) AS external_refund_reference
      FROM consumibles_venta_items cvi
      WHERE cvi.id = ${item.venta_item_id}
      LIMIT 1
      FOR UPDATE
    `

    const row = rows[0]
    if (!row) continue

    const quantityOriginal = Number(row.quantity_original ?? 0)
    const executedQuantity = Number(row.executed_quantity ?? 0)
    const currentRequestedQuantity = Number(item.quantity_requested ?? 0)

    if (executedQuantity + currentRequestedQuantity > quantityOriginal) {
      return {
        ventaItemId: String(row.venta_item_id),
        quantityOriginal,
        executedQuantity,
        currentRequestedQuantity,
        conflictCaseId: row.conflict_case_id ? String(row.conflict_case_id) : null,
        externalRefundReference: row.external_refund_reference ? String(row.external_refund_reference) : null,
      }
    }
  }

  return null
}

async function guardRefundExecutionByPaymentState(
  tx: PrismaTx,
  input: {
    refundCase: RefundManualCaseRow
    empresaId: string
    actorId: string
    actorType: 'empresa' | 'empleado'
    caseItems?: RefundManualCaseItemRow[]
    consumibleItems?: RefundManualCaseConsumibleItemRow[]
  }
) {
  const normalizedPaymentId = input.refundCase.payment_id?.trim() ?? ''
  const usesConsumibleQuantityGuard = (input.consumibleItems ?? []).length > 0
  const entryIds = Array.from(new Set([
    ...(input.refundCase.requested_entry_id ? [input.refundCase.requested_entry_id] : []),
    ...((input.caseItems ?? []).filter((item) => item.target_type === 'entrada').map((item) => item.target_id)),
  ]))
  const saleIds = Array.from(new Set([
    ...(usesConsumibleQuantityGuard ? [] : input.refundCase.requested_sale_id ? [input.refundCase.requested_sale_id] : []),
    ...((input.caseItems ?? []).filter((item) => item.target_type === 'consumible_venta').map((item) => item.target_id)),
  ]))
  // Bug fix (audit finding B): `saleIds` above intentionally stays scoped to whole-sale/
  // caseItems targets for `getExecutedRefundConflictByTargets` below — a buyer-consumible case
  // with a quantity guard can legitimately coexist with OTHER already-executed cases against
  // the SAME sale (they target distinct line items; see
  // "buyer consumible refunds can execute distinct lines from the same sale..." test), so it
  // must NOT include `consumibleItems`' venta_id or that check would false-positive-reject them.
  // `redemptionCheckSaleIds` is a SEPARATE, wider set used ONLY for
  // `getRefundExecutionConsumibleConflict` (estado IN canjeado/resuelto_parcial) below: it MUST
  // include the sale(s) backing the requested consumible line items, otherwise that check never
  // runs for this flow (saleIds is empty when usesConsumibleQuantityGuard) and a sale that gets
  // redeemed at the venue BETWEEN request and execution can have its refund executed anyway
  // (comprador ends up with both the consumible delivered AND the money back).
  const redemptionCheckSaleIds = Array.from(new Set([
    ...saleIds,
    ...((input.consumibleItems ?? []).map((item) => item.venta_id)),
  ]))

  if (usesConsumibleQuantityGuard) {
    const consumibleQuantityConflict = await getRefundExecutionConsumibleQuantityConflict(tx, {
      caseId: input.refundCase.id,
      consumibleItems: input.consumibleItems ?? [],
    })

    if (consumibleQuantityConflict) {
      const reason = 'Rechazo automático: línea de consumible ya alcanzó su límite reembolsable'
      const note = `Se rechazó automáticamente porque la línea ${consumibleQuantityConflict.ventaItemId} ya tiene ${consumibleQuantityConflict.executedQuantity} unidad(es) reembolsadas y ejecutar ${consumibleQuantityConflict.currentRequestedQuantity} más supera el máximo de ${consumibleQuantityConflict.quantityOriginal}${consumibleQuantityConflict.conflictCaseId ? ` en el caso ${consumibleQuantityConflict.conflictCaseId}` : ''}${consumibleQuantityConflict.externalRefundReference ? ` (referencia ${consumibleQuantityConflict.externalRefundReference})` : ''}.`

      await rejectRefundManualCaseWithinTransaction(tx, {
        refundCase: input.refundCase,
        empresaId: input.empresaId,
        actorId: input.actorId,
        actorType: input.actorType,
        reason,
        note,
        evidenceNote: note,
      })

      return { autoRejected: true as const }
    }
  }

  const executedConflict = await getExecutedRefundConflictByTargets(tx, {
    empresaId: input.empresaId,
    caseId: input.refundCase.id,
    entryIds,
    saleIds,
  })

  if (executedConflict) {
    const targetLabel = executedConflict.conflict_target_type === 'entrada' ? 'entrada' : 'venta'
    const reason = `Rechazo automático: ${targetLabel} ya tiene un reembolso ejecutado`
    const note = `Se rechazó automáticamente porque la ${targetLabel} ${executedConflict.conflict_target_id} ya tiene un reembolso ejecutado en el caso ${executedConflict.id}${executedConflict.external_refund_reference ? ` (referencia ${executedConflict.external_refund_reference})` : ''}.`

    await rejectRefundManualCaseWithinTransaction(tx, {
      refundCase: input.refundCase,
      empresaId: input.empresaId,
      actorId: input.actorId,
      actorType: input.actorType,
      reason,
      note,
      evidenceNote: note,
    })

    return { autoRejected: true as const }
  }

  const entryConflict = await getRefundExecutionEntryConflict(tx, {
    empresaId: input.empresaId,
    entryIds,
  })

  if (entryConflict) {
    const reason = 'Rechazo automático: entrada ya fue redimida'
    const note = `Se rechazó automáticamente porque la entrada ${entryConflict.id} está en estado usada${normalizedPaymentId ? ` (payment_id ${normalizedPaymentId})` : ''}.`

    await rejectRefundManualCaseWithinTransaction(tx, {
      refundCase: input.refundCase,
      empresaId: input.empresaId,
      actorId: input.actorId,
      actorType: input.actorType,
      reason,
      note,
      evidenceNote: note,
    })

    return { autoRejected: true as const }
  }

  const saleConflict = await getRefundExecutionConsumibleConflict(tx, {
    empresaId: input.empresaId,
    saleIds: redemptionCheckSaleIds,
  })

  if (saleConflict) {
    const reason = 'Rechazo automático: venta ya fue canjeada'
    const note = `Se rechazó automáticamente porque la venta ${saleConflict.id} está en estado ${saleConflict.estado}${normalizedPaymentId ? ` (payment_id ${normalizedPaymentId})` : ''}.`

    await rejectRefundManualCaseWithinTransaction(tx, {
      refundCase: input.refundCase,
      empresaId: input.empresaId,
      actorId: input.actorId,
      actorType: input.actorType,
      reason,
      note,
      evidenceNote: note,
    })

    return { autoRejected: true as const }
  }

  return null
}

async function transitionRefundManualCase(
  tx: PrismaTx,
  input: {
    refundCase: RefundManualCaseRow
    empresaId: string
    actorId: string
    actorType: 'empresa' | 'empleado'
    nextStatus: RefundManualStatus
    eventType: string
    reason?: string | null
    note?: string | null
    evidenceNote?: string | null
    externalRefundReference?: string | null
    extraPayload?: Record<string, unknown>
    resolved?: boolean
  }
) {
  // Dynamic UPDATE — use $executeRawUnsafe to support optional SET clauses (Postgres $N placeholders)
  const values: unknown[] = []
  const bind = (value: unknown) => { values.push(value); return `$${values.length}` }

  const updates = [`status = ${bind(input.nextStatus)}`]

  if (input.externalRefundReference !== undefined) {
    updates.push(`external_refund_reference = COALESCE(${bind(input.externalRefundReference)}, external_refund_reference)`)
  }

  if (input.evidenceNote !== undefined) {
    updates.push(`evidence_note = ${bind(input.evidenceNote)}`)
  }

  if (input.resolved) {
    updates.push(`resolved_by = ${bind(input.actorId)}`)
    updates.push('resolved_at = NOW()')
  }

  const idPlaceholder = bind(input.refundCase.id)
  const empresaPlaceholder = bind(input.empresaId)

  await tx.$executeRawUnsafe(
    `UPDATE refund_manual_cases SET ${updates.join(', ')} WHERE id = ${idPlaceholder} AND empresa_id = ${empresaPlaceholder}`,
    ...values
  )

  await insertCaseEvent(tx, {
    caseId: input.refundCase.id,
    eventType: input.eventType,
    actorId: input.actorId,
    actorType: input.actorType,
    payload: {
      previous_status: input.refundCase.status,
      next_status: input.nextStatus,
      reason: input.reason ?? undefined,
      note: input.note ?? undefined,
      evidence_note: input.evidenceNote ?? undefined,
      external_refund_reference: input.externalRefundReference ?? undefined,
      ...(input.extraPayload ?? {}),
    },
  })
}

function getAutomaticRefundFailure(error: unknown) {
  const message = error instanceof Error && error.message.trim()
    ? error.message.trim()
    : 'Mercado Pago rechazó el reembolso automático'

  const status = typeof error === 'object' && error && 'status' in error && typeof (error as { status?: unknown }).status === 'number'
    ? Number((error as { status: number }).status)
    : undefined

  if (status === 400 || status === 404 || status === 409) {
    return { status: 409, error: message }
  }

  if (status === 401 || status === 403) {
    return { status: 409, error: 'La cuenta de Mercado Pago de la empresa no permite ejecutar reembolsos automáticos' }
  }

  return { status: 502, error: message }
}

function getMercadoPagoStatusLabel(status?: string | null) {
  switch (status) {
    case 'approved':
      return 'Aprobado'
    case 'pending':
      return 'Pendiente'
    case 'in_process':
      return 'En proceso'
    case 'rejected':
      return 'Rechazado'
    case 'cancelled':
      return 'Cancelado'
    case 'refunded':
      return 'Reintegrado'
    default:
      return status ?? null
  }
}

async function executeAutomaticMercadoPagoRefund(input: {
  empresaId: string
  paymentId: string
  refundCaseId: string
  refundAmount: number
}) {
  if (!(input.refundAmount > 0)) {
    return { ok: false as const, status: 409, error: 'El caso no tiene un monto válido para ejecutar el reembolso automático' }
  }

  const paymentAccount = await getPaymentAccountByEmpresaId(input.empresaId)
  if (!paymentAccount) {
    return { ok: false as const, status: 409, error: 'La empresa no tiene una cuenta de Mercado Pago conectada para ejecutar reembolsos automáticos' }
  }

  if (paymentAccount.status !== 'ready_to_sell') {
    return { ok: false as const, status: 409, error: 'La cuenta de Mercado Pago de la empresa no está lista para ejecutar reembolsos automáticos' }
  }

  const mpClient = await getMercadoPagoClientByEmpresaId(input.empresaId)
  if (!mpClient) {
    return { ok: false as const, status: 409, error: 'No se pudo inicializar Mercado Pago para ejecutar el reembolso automático' }
  }

  try {
    const refundClient = new PaymentRefund(mpClient)
    const refund = await (refundClient as any).create({
      payment_id: input.paymentId,
      body: { amount: input.refundAmount },
      requestOptions: {
        idempotencyKey: `refund-manual-case-${input.refundCaseId}`,
      },
    })

    return {
      ok: true as const,
      data: {
        refundReference: refund?.id != null ? String(refund.id) : null,
        refundStatus: typeof refund?.status === 'string' ? refund.status : null,
        refundedAmount: refund?.amount != null ? Number(refund.amount) : null,
      } satisfies AutomaticRefundResult,
    }
  } catch (error) {
    return { ok: false as const, ...getAutomaticRefundFailure(error) }
  }
}

export async function listRefundManualCases(empresaId: string, query: RefundManualCasesQuery = {}) {
  return selectRefundManualCaseSummaries(empresaId, query)
}

export async function getRefundManualCaseDetail(caseId: string, empresaId: string) {
  const rows = await prismaDirectUrl.$queryRaw<RefundManualCaseRow[]>`
    SELECT *
    FROM refund_manual_cases
    WHERE id = ${caseId} AND empresa_id = ${empresaId}
    LIMIT 1
  `

  const refundCase = rows[0]
  if (!refundCase) return null

  const session = await getCheckoutSessionById(refundCase.checkout_session_id, empresaId)
  const requestedContext = await getRefundRequestedContext(refundCase, empresaId)

  return {
    case: {
      ...toCaseSummary(refundCase),
      ...requestedContext,
    },
    purchase_context: session ? buildPurchaseContext(session) : null,
    items: await getCaseItems(refundCase.id),
    consumible_items: await getCaseConsumibleItems(refundCase.id),
    events: await getCaseEvents(refundCase.id),
  }
}

export async function createRefundManualCase(input: {
  empresaId: string
  checkoutSessionId: string
  actorId: string
  actorType: 'empresa' | 'empleado'
  reason: string
  note?: string | null
  externalRefundReference?: string | null
}) {
  const normalizedReason = input.reason.trim()
  if (!normalizedReason) {
    return { ok: false as const, status: 400, error: 'reason es requerido' }
  }

  type TxResult = { ok: false; status: number; error: string } | { ok: true; refundCaseId: string }

  const txResult = await withSerializableRetry(() =>
    prismaDirectUrl.$transaction<TxResult>(async (tx) => {
      const session = await lockCheckoutSession(tx, input.checkoutSessionId, input.empresaId)
      if (!session) {
        return { ok: false, status: 404, error: 'La compra original no existe' }
      }

      if (session.estado !== 'confirmada') {
        return { ok: false, status: 409, error: 'La compra todavía no está confirmada' }
      }

      const usedEntries = await tx.$queryRaw<{ id: string }[]>`
        SELECT en.id
        FROM entradas en
        JOIN eventos ev ON ev.id = en.evento_id AND ev.empresa_id = ${input.empresaId}
        WHERE en.checkout_session_id = ${input.checkoutSessionId} AND en.estado = 'usada'
        LIMIT 1
      `
      if (usedEntries.length > 0) {
        return { ok: false, status: 422, error: 'No se puede reembolsar una entrada que ya fue utilizada' }
      }

      const refundCaseId = uuidv4()
      const createdStatus: RefundManualStatus = 'requested'
      const flow = detectFlow(session.datos)
      const requestedAmount = deriveRequestedAmount(session.datos)
      const currency = deriveCurrency(session.datos)
      const normalizedNote = normalizeOptionalText(input.note)
      const normalizedExternalReference = input.externalRefundReference?.trim()
        ? input.externalRefundReference.trim()
        : null

      await tx.$executeRaw`
        INSERT INTO refund_manual_cases
        (id, empresa_id, checkout_session_id, flow, status, payment_id, payment_status, reconciliation_status,
         requested_amount, currency, request_reason, request_note, external_refund_reference,
         requester_actor_id, requester_actor_type, created_by)
        VALUES (${refundCaseId}, ${input.empresaId}, ${session.id}, ${flow}, ${createdStatus},
                ${session.payment_id}, ${session.payment_status}, ${session.reconciliation_status},
                ${requestedAmount}, ${currency}, ${normalizedReason}, ${normalizedNote},
                ${normalizedExternalReference}, ${input.actorId}, ${input.actorType}, ${input.actorId})
      `

      await insertCaseEvent(tx, {
        caseId: refundCaseId,
        eventType: 'case_requested',
        actorId: input.actorId,
        actorType: input.actorType,
        payload: {
          reason: normalizedReason,
          note: normalizedNote,
          external_refund_reference: normalizedExternalReference,
          checkout_status: session.estado,
          payment_status: session.payment_status,
          reconciliation_status: session.reconciliation_status,
          flow,
        },
      })

      return { ok: true, refundCaseId }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 15000 })
  )

  if (!txResult.ok) return txResult

  const detail = await getRefundManualCaseDetail(txResult.refundCaseId, input.empresaId)
  return { ok: true as const, status: 201, data: detail }
}

export async function createBuyerEventRefundRequest(input: {
  empresaId: string
  buyerId: string
  entryId: string
  actorId: string
  reason: string
  note?: string | null
}) {
  const normalizedReason = input.reason.trim()
  if (!normalizedReason) {
    return { ok: false as const, status: 400, error: 'reason es requerido' }
  }

  type TxResult =
    | { ok: false; status: number; error: string; existingCaseId?: string }
    | { ok: true; refundCaseId: string; automaticRefundMode: BuyerAutomaticRefundMode }

  const txResult = await withSerializableRetry(() =>
    prismaDirectUrl.$transaction<TxResult>(async (tx) => {
      const entry = await getBuyerEntryForRefund(tx, {
        empresaId: input.empresaId,
        buyerId: input.buyerId,
        entryId: input.entryId,
      })

      if (!entry) return { ok: false, status: 404, error: 'La entrada no existe o no te pertenece' }
      if (entry.entrada_estado === 'cancelada') return { ok: false, status: 409, error: 'La entrada ya fue reembolsada o cancelada' }
      if (entry.entrada_estado === 'usada') return { ok: false, status: 409, error: 'La entrada ya fue utilizada y no puede pedir reembolso' }

      // Gate del plazo del comprador: si la empresa configuro un buyer_request_window_days y la
      // entrada se compro hace mas tiempo, no podemos abrir el pedido.
      const requestWindowDays = Number(entry.empresa_request_window_days ?? 30)
      const insideRequestWindow = isWithinBuyerRequestWindow({
        windowDays: requestWindowDays,
        purchasedAt: entry.entrada_created_at,
      })
      if (!insideRequestWindow) {
        return {
          ok: false,
          status: 409,
          error: `Ya paso el plazo para pedir reembolso de esta entrada (${requestWindowDays} dias desde la compra).`,
        }
      }

      if (!resolveBuyerRefundPolicy(entry.empresa_refunds_enabled, entry.evento_refunds_enabled)) {
        return { ok: false, status: 409, error: 'Este evento no tiene solicitudes de reembolso de comprador habilitadas' }
      }

      if (!entry.checkout_session_id || entry.checkout_estado !== 'confirmada' || !entry.confirmed_at) {
        return { ok: false, status: 409, error: 'La entrada no está ligada a una compra confirmada' }
      }

      const existingOpenCase = await getOpenBuyerRefundCaseByEntry(tx, entry.entrada_id, input.empresaId)
      if (existingOpenCase) {
        return { ok: false, status: 409, error: 'Ya existe una solicitud activa para esta entrada', existingCaseId: existingOpenCase.id }
      }

      const session = await lockCheckoutSession(tx, entry.checkout_session_id, input.empresaId)
      if (!session || session.estado !== 'confirmada') {
        return { ok: false, status: 409, error: 'La compra original ya no está confirmada' }
      }

      const refundCaseId = uuidv4()
      const normalizedNote = normalizeOptionalText(input.note)
      const requestedAmount = entry.precio_pagado == null ? 0 : Number(entry.precio_pagado)
      const currency = deriveCurrency(session.datos)
      const automaticRefundModeBase = normalizeBuyerAutomaticRefundMode(entry.empresa_auto_refunds_enabled, entry.empresa_auto_refunds_scope)
      // Cool-off gate: si window > 0 y la compra fue hace más de N horas, degradamos a 'manual'
      // así el caso queda en 'requested' para revisión del organizador.
      const insideCoolOff = isWithinCoolOffWindow({
        windowHours: entry.empresa_cool_off_window_hours,
        confirmedAt: entry.confirmed_at,
      })
      const automaticRefundMode: BuyerAutomaticRefundMode = insideCoolOff ? automaticRefundModeBase : 'manual'
      const companyPolicySnapshot = Number(entry.empresa_refunds_enabled ?? 0) === 1
      const eventPolicySnapshot = Number(entry.evento_refunds_enabled ?? 0) === 1

      await tx.$executeRaw`
        INSERT INTO refund_manual_cases
        (id, empresa_id, checkout_session_id, flow, status, payment_id, payment_status, reconciliation_status,
         requested_amount, currency, request_reason, request_note, request_origin,
         requester_actor_id, requester_actor_type, requester_buyer_id, requested_event_id, requested_entry_id,
         company_policy_snapshot, event_policy_snapshot, created_by)
        VALUES (${refundCaseId}, ${input.empresaId}, ${session.id}, 'entradas', 'requested',
                ${session.payment_id}, ${session.payment_status}, ${session.reconciliation_status},
                ${requestedAmount}, ${currency}, ${normalizedReason}, ${normalizedNote}, 'buyer_event_request',
                ${input.actorId}, 'comprador', ${input.buyerId}, ${entry.evento_id}, ${entry.entrada_id},
                ${companyPolicySnapshot}, ${eventPolicySnapshot}, ${input.actorId})
      `

      const itemId = uuidv4()
      await tx.$executeRaw`
        INSERT INTO refund_manual_case_items
        (id, case_id, target_type, target_id, target_status_before, target_status_after, eligibility, block_reason, amount_snapshot)
        VALUES (${itemId}, ${refundCaseId}, 'entrada', ${entry.entrada_id}, ${entry.entrada_estado}, NULL, 'elegible', NULL, ${requestedAmount})
      `

      await insertCaseEvent(tx, {
        caseId: refundCaseId,
        eventType: 'case_requested',
        actorId: input.actorId,
        actorType: 'comprador',
        payload: {
          reason: normalizedReason,
          note: normalizedNote,
          checkout_status: session.estado,
          payment_status: session.payment_status,
          reconciliation_status: session.reconciliation_status,
          flow: 'entradas',
          request_origin: 'buyer_event_request',
          requested_entry_id: entry.entrada_id,
          requested_event_id: entry.evento_id,
          company_policy_snapshot: companyPolicySnapshot,
          event_policy_snapshot: eventPolicySnapshot,
          automatic_refund_mode: automaticRefundMode,
        },
      })

      return { ok: true, refundCaseId, automaticRefundMode }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 15000 })
  )

  if (!txResult.ok) {
    if (txResult.existingCaseId) {
      return {
        ok: false as const,
        status: txResult.status,
        error: txResult.error,
        data: await getRefundManualCaseDetail(txResult.existingCaseId, input.empresaId),
      }
    }
    return { ok: false as const, status: txResult.status, error: txResult.error }
  }

  if (shouldAutoRefundBuyerFlow(txResult.automaticRefundMode, 'entradas')) {
    await attemptAutomaticBuyerRefund({ empresaId: input.empresaId, refundCaseId: txResult.refundCaseId, flow: 'entradas' })
  }

  return { ok: true as const, status: 201, data: await getRefundManualCaseDetail(txResult.refundCaseId, input.empresaId) }
}

export async function createBuyerConsumibleRefundRequest(input: {
  empresaId: string
  buyerId: string
  actorId: string
  reason: string
  note?: string | null
  items: Array<{ venta_id: string; venta_item_id: string; quantity_requested: number }>
}) {
  const normalizedReason = input.reason.trim()
  if (!normalizedReason) {
    return { ok: false as const, status: 400, error: 'reason es requerido' }
  }

  const normalizedItems = (input.items ?? [])
    .map((item) => ({
      ventaId: typeof item?.venta_id === 'string' ? item.venta_id.trim() : '',
      ventaItemId: typeof item?.venta_item_id === 'string' ? item.venta_item_id.trim() : '',
      quantityRequested: Number(item?.quantity_requested ?? 0),
    }))
    .filter((item) => item.ventaId && item.ventaItemId && Number.isInteger(item.quantityRequested) && item.quantityRequested > 0)

  if (!normalizedItems.length) {
    return { ok: false as const, status: 400, error: 'items es requerido' }
  }

  type TxResult =
    | { ok: false; status: number; error: string; existingCaseId?: string }
    | { ok: true; refundCaseId: string; automaticRefundMode: BuyerAutomaticRefundMode }

  const txResult = await withSerializableRetry(() =>
    prismaDirectUrl.$transaction<TxResult>(async (tx) => {
      const saleId = normalizedItems[0]!.ventaId
      if (normalizedItems.some((item) => item.ventaId !== saleId)) {
        return { ok: false, status: 409, error: 'Todos los items deben pertenecer a la misma venta' }
      }

      const existingOpenCase = await getOpenBuyerConsumibleRefundCaseBySale(tx, saleId, input.empresaId)
      if (existingOpenCase) {
        return { ok: false, status: 409, error: 'Ya existe una solicitud activa para esta compra de consumibles', existingCaseId: existingOpenCase.id }
      }

      const loadedItems: Array<BuyerConsumibleVentaRow & { quantityRequested: number; executedQuantity: number; openQuantity: number }> = []
      for (const item of normalizedItems) {
        const ventaItem = await getBuyerConsumibleVentaItemForRefund(tx, {
          empresaId: input.empresaId,
          buyerId: input.buyerId,
          ventaId: item.ventaId,
          ventaItemId: item.ventaItemId,
        })

        if (!ventaItem) {
          return { ok: false, status: 404, error: 'La compra de consumibles no existe o no te pertenece' }
        }

        if (ventaItem.barra_buyer_refunds_enabled === false) {
          return { ok: false, status: 409, error: 'Esta barra no acepta solicitudes de reembolso del comprador' }
        }

        if (ventaItem.venta_estado !== 'pendiente') {
          return { ok: false, status: 409, error: 'La compra de consumibles ya no admite reembolsos de comprador' }
        }

        if (!ventaItem.checkout_session_id) {
          return { ok: false, status: 409, error: 'La compra de consumibles no está ligada a una compra confirmada' }
        }

        // Gate del plazo del comprador: si la empresa configuro un buyer_request_window_days y la
        // compra se hizo hace mas tiempo, no se puede abrir el pedido.
        const requestWindowDaysCons = Number(ventaItem.empresa_request_window_days ?? 30)
        const insideRequestWindowCons = isWithinBuyerRequestWindow({
          windowDays: requestWindowDaysCons,
          purchasedAt: ventaItem.checkout_confirmed_at,
        })
        if (!insideRequestWindowCons) {
          return {
            ok: false,
            status: 409,
            error: `Ya paso el plazo para pedir reembolso de esta compra (${requestWindowDaysCons} dias desde la compra).`,
          }
        }

        const quantities = await getConsumibleRefundQuantities(tx, item.ventaItemId)
        const eligibleQuantity = Number(ventaItem.cantidad ?? 0) - quantities.executedQuantity - quantities.openQuantity
        if (item.quantityRequested > eligibleQuantity) {
          return { ok: false, status: 409, error: getConsumibleRefundRequestStatusMessage() }
        }

        loadedItems.push({
          ...ventaItem,
          quantityRequested: item.quantityRequested,
          executedQuantity: quantities.executedQuantity,
          openQuantity: quantities.openQuantity,
        })
      }

      const session = await lockCheckoutSession(tx, String(loadedItems[0]!.checkout_session_id), input.empresaId)
      if (!session || session.estado !== 'confirmada') {
        return { ok: false, status: 409, error: 'La compra original ya no está confirmada' }
      }

      const refundCaseId = uuidv4()
      const normalizedNote = normalizeOptionalText(input.note)
      const requestedAmount = loadedItems.reduce((sum, item) => sum + Number(item.precio_unitario ?? 0) * item.quantityRequested, 0)
      const currency = deriveCurrency(session.datos)
      const automaticRefundModeBase = normalizeBuyerAutomaticRefundMode(loadedItems[0]!.empresa_auto_refunds_enabled, loadedItems[0]!.empresa_auto_refunds_scope)
      const insideCoolOff = isWithinCoolOffWindow({
        windowHours: loadedItems[0]!.empresa_cool_off_window_hours,
        confirmedAt: loadedItems[0]!.checkout_confirmed_at,
      })
      const automaticRefundMode: BuyerAutomaticRefundMode = insideCoolOff ? automaticRefundModeBase : 'manual'

      const now = new Date()
      await tx.$executeRaw`
        INSERT INTO refund_manual_cases
        (id, empresa_id, checkout_session_id, flow, status, payment_id, payment_status, reconciliation_status,
         requested_amount, currency, request_reason, request_note, request_origin,
         requester_actor_id, requester_actor_type, requester_buyer_id, requested_event_id, requested_sale_id, created_by,
         updated_at)
        VALUES (${refundCaseId}, ${input.empresaId}, ${session.id}, 'consumibles', 'requested',
                ${session.payment_id}, ${session.payment_status}, ${session.reconciliation_status},
                ${requestedAmount}, ${currency}, ${normalizedReason}, ${normalizedNote}, 'buyer_consumible_request',
                ${input.actorId}, 'comprador', ${input.buyerId}, ${loadedItems[0]!.evento_id}, ${saleId}, ${input.actorId},
                ${now})
      `

      const caseItemId = uuidv4()
      await tx.$executeRaw`
        INSERT INTO refund_manual_case_items
        (id, case_id, target_type, target_id, target_status_before, target_status_after, eligibility, block_reason, amount_snapshot)
        VALUES (${caseItemId}, ${refundCaseId}, 'consumible_venta', ${saleId}, 'pendiente', NULL, 'elegible', NULL, ${requestedAmount})
      `

      for (const item of loadedItems) {
        const childId = uuidv4()
        await tx.$executeRaw`
          INSERT INTO refund_manual_case_consumible_items
          (id, case_id, venta_id, venta_item_id, consumible_id, nombre_snapshot, quantity_original, quantity_requested,
           quantity_executed, quantity_rejected, unit_price_snapshot, amount_snapshot, status, updated_at)
          VALUES (${childId}, ${refundCaseId}, ${item.venta_id}, ${item.item_id}, ${item.consumible_id},
                  ${item.nombre}, ${Number(item.cantidad ?? 0)}, ${item.quantityRequested},
                  0, 0, ${Number(item.precio_unitario ?? 0)}, ${Number(item.precio_unitario ?? 0) * item.quantityRequested}, 'requested', ${now})
        `

        const eventPayload = JSON.stringify({ quantity_requested: item.quantityRequested, venta_item_id: item.item_id })
        await tx.$executeRaw`
          INSERT INTO refund_manual_case_consumible_item_events
          (id, case_id, consumible_case_item_id, event_type, actor_id, actor_type, payload_json)
          VALUES (${uuidv4()}, ${refundCaseId}, ${childId}, 'quantity_requested', ${input.actorId}, 'comprador', ${eventPayload})
        `
      }

      await insertCaseEvent(tx, {
        caseId: refundCaseId,
        eventType: 'case_requested',
        actorId: input.actorId,
        actorType: 'comprador',
        payload: {
          reason: normalizedReason,
          note: normalizedNote,
          flow: 'consumibles',
          request_origin: 'buyer_consumible_request',
          requested_sale_id: saleId,
          requested_event_id: loadedItems[0]!.evento_id,
          automatic_refund_mode: automaticRefundMode,
          items: loadedItems.map((item) => ({ venta_item_id: item.item_id, quantity_requested: item.quantityRequested })),
        },
      })

      return { ok: true, refundCaseId, automaticRefundMode }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 15000 })
  )

  if (!txResult.ok) {
    if (txResult.existingCaseId) {
      return {
        ok: false as const,
        status: txResult.status,
        error: txResult.error,
        data: await getRefundManualCaseDetail(txResult.existingCaseId, input.empresaId),
      }
    }
    return { ok: false as const, status: txResult.status, error: txResult.error }
  }

  if (shouldAutoRefundBuyerFlow(txResult.automaticRefundMode, 'consumibles')) {
    await attemptAutomaticBuyerRefund({ empresaId: input.empresaId, refundCaseId: txResult.refundCaseId, flow: 'consumibles' })
  }

  return { ok: true as const, status: 201, data: await getRefundManualCaseDetail(txResult.refundCaseId, input.empresaId) }
}

export async function linkRefundManualCaseItems(input: {
  caseId: string
  empresaId: string
  actorId: string
  actorType: 'empresa' | 'empleado'
  items: Array<{ target_type: 'entrada' | 'consumible_venta'; target_id: string }>
}) {
  const normalizedItems = Array.from(
    new Map(
      (input.items ?? [])
        .map((item) => ({
          target_type: item?.target_type,
          target_id: typeof item?.target_id === 'string' ? item.target_id.trim() : '',
        }))
        .filter(
          (item): item is { target_type: 'entrada' | 'consumible_venta'; target_id: string } =>
            (item.target_type === 'entrada' || item.target_type === 'consumible_venta') && Boolean(item.target_id)
        )
        .map((item) => [`${item.target_type}:${item.target_id}`, item])
    ).values()
  )

  if (normalizedItems.length === 0) {
    return { ok: false as const, status: 400, error: 'items es requerido' }
  }

  type TxResult =
    | { ok: false; status: number; error: string }
    | { ok: true; caseId: string }

  const txResult = await withSerializableRetry(() =>
    prismaDirectUrl.$transaction<TxResult>(async (tx) => {
      const refundCase = await lockRefundManualCase(tx, input.caseId, input.empresaId)
      if (!refundCase) return { ok: false, status: 404, error: 'Caso no encontrado' }

      if (!['requested', 'under_review'].includes(refundCase.status)) {
        return { ok: false, status: 409, error: 'El caso ya no permite vincular items' }
      }

      const session = await lockCheckoutSession(tx, refundCase.checkout_session_id, input.empresaId)
      if (!session) {
        return { ok: false, status: 409, error: 'La compra original ya no está disponible para revisión' }
      }

      const linkedItems: Array<{
        id: string
        case_id: string
        target_type: 'entrada' | 'consumible_venta'
        target_id: string
        target_status_before: string | null
        target_status_after: string | null
        eligibility: string
        block_reason: string | null
        amount_snapshot: number | null
      }> = []

      for (const item of normalizedItems) {
        if (refundCase.flow === 'entradas' && item.target_type !== 'entrada') {
          return { ok: false, status: 409, error: 'El caso de entradas solo admite entradas' }
        }

        if (refundCase.flow === 'consumibles' && item.target_type !== 'consumible_venta') {
          return { ok: false, status: 409, error: 'El caso de consumibles solo admite ventas de consumibles' }
        }

        if (item.target_type === 'entrada') {
          const rows = await tx.$queryRaw<EntradaLinkRow[]>`
            SELECT en.id, en.estado, en.precio_pagado, en.comprador_id
            FROM entradas en
            JOIN eventos ev ON ev.id = en.evento_id
            WHERE en.id = ${item.target_id} AND ev.empresa_id = ${input.empresaId}
            LIMIT 1
            FOR UPDATE
          `

          const entry = rows[0]
          if (!entry) {
            return { ok: false, status: 404, error: `Entrada ${item.target_id} no encontrada` }
          }

          if (session.comprador_id && entry.comprador_id !== session.comprador_id) {
            return { ok: false, status: 409, error: `La entrada ${item.target_id} no pertenece a la compra original` }
          }

          linkedItems.push({
            id: uuidv4(),
            case_id: refundCase.id,
            target_type: 'entrada',
            target_id: entry.id,
            target_status_before: entry.estado,
            target_status_after: null,
            eligibility: entry.estado === 'valida' ? 'elegible' : 'bloqueado',
            block_reason:
              entry.estado === 'usada'
                ? 'entrada_usada'
                : entry.estado === 'cancelada'
                  ? 'entrada_cancelada'
                  : null,
            amount_snapshot: entry.precio_pagado == null ? null : Number(entry.precio_pagado),
          })

          continue
        }

        const rows = await tx.$queryRaw<ConsumibleVentaLinkRow[]>`
          SELECT id, estado, total, checkout_session_id
          FROM consumibles_ventas
          WHERE id = ${item.target_id} AND empresa_id = ${input.empresaId}
          LIMIT 1
          FOR UPDATE
        `

        const sale = rows[0]
        if (!sale) {
          return { ok: false, status: 404, error: `Venta ${item.target_id} no encontrada` }
        }

        if (sale.checkout_session_id !== refundCase.checkout_session_id) {
          return { ok: false, status: 409, error: `La venta ${item.target_id} no pertenece a la compra original` }
        }

        linkedItems.push({
          id: uuidv4(),
          case_id: refundCase.id,
          target_type: 'consumible_venta',
          target_id: sale.id,
          target_status_before: sale.estado,
          target_status_after: null,
          eligibility: sale.estado === 'pendiente' ? 'elegible' : 'bloqueado',
          block_reason:
            sale.estado === 'canjeado'
              ? 'consumible_canjeado'
              : sale.estado === 'cancelado'
                ? 'consumible_cancelado'
                : null,
          amount_snapshot: Number(sale.total ?? 0),
        })
      }

      await tx.$executeRaw`DELETE FROM refund_manual_case_items WHERE case_id = ${refundCase.id}`

      for (const item of linkedItems) {
        await tx.$executeRaw`
          INSERT INTO refund_manual_case_items
          (id, case_id, target_type, target_id, target_status_before, target_status_after, eligibility, block_reason, amount_snapshot)
          VALUES (${item.id}, ${item.case_id}, ${item.target_type}, ${item.target_id},
                  ${item.target_status_before}, ${item.target_status_after},
                  ${item.eligibility}, ${item.block_reason}, ${item.amount_snapshot})
        `
      }

      const updatedAmount = getRefundAmountFromCaseItems(linkedItems)
      await tx.$executeRaw`
        UPDATE refund_manual_cases
        SET requested_amount = ${updatedAmount}
        WHERE id = ${refundCase.id} AND empresa_id = ${input.empresaId}
      `

      if (refundCase.status === 'requested') {
        await tx.$executeRaw`
          UPDATE refund_manual_cases SET status = 'under_review'
          WHERE id = ${refundCase.id} AND empresa_id = ${input.empresaId}
        `

        await insertCaseEvent(tx, {
          caseId: refundCase.id,
          eventType: 'case_under_review',
          actorId: input.actorId,
          actorType: input.actorType,
          payload: {
            previous_status: 'requested',
            next_status: 'under_review',
            reason: 'items_linked',
          },
        })
      }

      await insertCaseEvent(tx, {
        caseId: refundCase.id,
        eventType: 'case_items_linked',
        actorId: input.actorId,
        actorType: input.actorType,
        payload: {
          items: linkedItems.map((item) => ({
            target_type: item.target_type,
            target_id: item.target_id,
            eligibility: item.eligibility,
            block_reason: item.block_reason,
          })),
        },
      })

      return { ok: true, caseId: refundCase.id }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 15000 })
  )

  if (!txResult.ok) return { ok: false as const, status: txResult.status, error: txResult.error }

  return { ok: true as const, status: 200, data: await getRefundManualCaseDetail(txResult.caseId, input.empresaId) }
}

export async function approveRefundManualCase(input: {
  caseId: string
  empresaId: string
  actorId: string
  actorType: 'empresa' | 'empleado'
  reason: string
  note?: string | null
}) {
  const normalizedReason = input.reason.trim()
  if (!normalizedReason) {
    return { ok: false as const, status: 400, error: 'reason es requerido' }
  }
  const normalizedNote = input.note ? input.note.trim() || null : null

  type TxResult =
    | { ok: false; status: number; error: string }
    | { ok: true; caseId: string }

  const txResult = await withSerializableRetry(() =>
    prismaDirectUrl.$transaction<TxResult>(async (tx) => {
      const refundCase = await lockRefundManualCase(tx, input.caseId, input.empresaId)
      if (!refundCase) return { ok: false, status: 404, error: 'Caso no encontrado' }

      if (!['requested', 'under_review'].includes(refundCase.status)) {
        return { ok: false, status: 409, error: 'El caso no se puede aprobar en su estado actual' }
      }

      if (refundCase.flow === 'consumibles') {
        if (refundCase.request_origin !== 'buyer_consumible_request') {
          return { ok: false, status: 409, error: getConsumablesNonRefundableMessage() }
        }

        return { ok: false, status: 409, error: 'Los reembolsos de comprador de consumibles no usan approve; ejecutalos o resolvelos manualmente.' }
      }

      const resolvedItems = (await getCaseItemsForUpdate(tx, refundCase.id)).map(toCaseItem)
      const blockedItems = getBlockedItems(resolvedItems)

      if (resolvedItems.length === 0) {
        return { ok: false, status: 409, error: 'Vinculá items antes de aprobar el caso' }
      }

      if (blockedItems.length > 0) {
        return {
          ok: false,
          status: 409,
          error: getCaseItemsErrorMessage(blockedItems.map((item) => ({
            target_type: item.target_type,
            target_id: item.target_id,
            block_reason: item.block_reason,
          }))),
        }
      }

      await transitionRefundManualCase(tx, {
        refundCase,
        empresaId: input.empresaId,
        actorId: input.actorId,
        actorType: input.actorType,
        nextStatus: 'approved_for_manual_execution',
        eventType: 'case_approved_for_manual_execution',
        reason: normalizedReason,
        note: normalizedNote,
      })

      return { ok: true, caseId: refundCase.id }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 15000 })
  )

  if (!txResult.ok) return { ok: false as const, status: txResult.status, error: txResult.error }

  return { ok: true as const, status: 200, data: await getRefundManualCaseDetail(txResult.caseId, input.empresaId) }
}

export async function executeRefundManualCase(input: {
  caseId: string
  empresaId: string
  actorId: string
  actorType: 'empresa' | 'empleado'
  evidenceNote?: string | null
  externalRefundReference?: string | null
}) {
  const normalizedEvidenceNote = input.evidenceNote?.trim() ? input.evidenceNote.trim() : null
  const normalizedExternalReference = input.externalRefundReference?.trim()
    ? input.externalRefundReference.trim()
    : null

  // consumibleProportionalReversals carries per-sale (sourceId, refundAmount, sourceAmount)
  // for the consumibles-flow branch, where a refund can be PARTIAL (a subset of the sale's
  // quantity). It is reversed proportionally post-commit. The entradas-flow branch instead
  // fully cancels any linked consumible sale and reports its id in consumibleCancelSourceIds
  // (full reversal).
  type ConsumibleProportionalReversal = { sourceId: string; refundAmount: number; sourceAmount: number }
  type TxResult =
    | { ok: false; status: number; error: string }
    | {
        ok: true
        caseId: string
        entryCancelSourceIds: string[]
        consumibleCancelSourceIds: string[]
        consumibleProportionalReversals: ConsumibleProportionalReversal[]
        resolvedEvidenceNote: string
        resolvedExternalReference: string | null
      }

  const txResult = await withSerializableRetry(() =>
    prismaDirectUrl.$transaction<TxResult>(async (tx) => {
      const refundCase = await lockRefundManualCase(tx, input.caseId, input.empresaId)
      if (!refundCase) return { ok: false, status: 404, error: 'Caso no encontrado' }

      if (refundCase.flow === 'consumibles') {
        if (refundCase.request_origin !== 'buyer_consumible_request') {
          return { ok: false, status: 409, error: getConsumablesNonRefundableMessage() }
        }

        if (!normalizedEvidenceNote && !normalizedExternalReference) {
          return { ok: false, status: 400, error: 'La ejecución manual requiere evidencia o referencia externa' }
        }

        if (!['requested', 'under_review', 'approved_for_manual_execution'].includes(refundCase.status)) {
          return { ok: false, status: 409, error: 'El caso no se puede ejecutar en su estado actual' }
        }

        const consumibleItems = await getCaseConsumibleItemsForUpdate(tx, refundCase.id)
        if (!consumibleItems.length) {
          return { ok: false, status: 409, error: 'El caso no tiene items de consumibles para ejecutar' }
        }

        const consumiblesExecutionGuard = await guardRefundExecutionByPaymentState(tx, {
          refundCase,
          empresaId: input.empresaId,
          actorId: input.actorId,
          actorType: input.actorType,
          consumibleItems,
        })

        if (consumiblesExecutionGuard) {
          return { ok: true, caseId: refundCase.id, entryCancelSourceIds: [], consumibleCancelSourceIds: [], consumibleProportionalReversals: [], resolvedEvidenceNote: normalizedEvidenceNote ?? '', resolvedExternalReference: normalizedExternalReference }
        }

        // Mercado Pago refund for buyer-consumible cases backed by a real online payment.
        // Mirrors the ENTRADAS branch below: the MP call happens INSIDE the tx, BEFORE the DB
        // mutations, so a MP failure rolls everything back. The idempotency key
        // `refund-manual-case-{caseId}` (set inside executeAutomaticMercadoPagoRefund) makes a
        // re-run / SLA retry safe against double-refunding.
        //
        // We only attempt MP when there is a real payment_id AND the empresa's MP account is
        // ready_to_sell. Otherwise (cash/POS sale with no online payment, or account not
        // connected/ready) we keep the prior manual-evidence behavior: the operator/SLA actor
        // attests the refund out-of-band via evidence_note / external reference (already required
        // above), and we close the case as 'executed' without calling MP.
        const consumiblePaymentId = refundCase.payment_id?.trim() ?? ''
        const consumibleRefundAmount = getRefundAmountFromCaseItems(
          consumibleItems.map((item) => ({ amount_snapshot: item.amount_snapshot }))
        )

        let mpAccountReady = false
        if (consumiblePaymentId && consumibleRefundAmount > 0) {
          const paymentAccount = await getPaymentAccountByEmpresaId(input.empresaId)
          mpAccountReady = paymentAccount?.status === 'ready_to_sell'
        }

        let consumibleAutomaticRefund: AutomaticRefundResult | null = null
        if (consumiblePaymentId && consumibleRefundAmount > 0 && mpAccountReady) {
          const automaticRefund = await executeAutomaticMercadoPagoRefund({
            empresaId: input.empresaId,
            paymentId: consumiblePaymentId,
            refundCaseId: refundCase.id,
            refundAmount: consumibleRefundAmount,
          })

          if (!automaticRefund.ok) return automaticRefund

          consumibleAutomaticRefund = automaticRefund.data
        }

        // Bug fix (audit finding A): a buyer-consumible refund never restored `barra_stock`,
        // so every executed refund permanently shrank sellable stock (units paid-back to the
        // buyer stayed "sold" forever). Restore stock_actual by the REFUNDED quantity per line
        // (can be partial — not the whole sale), mirroring the full-sale-refund pattern below
        // (target_type = 'consumible_venta', ~line 2625) which does
        // `stock_actual = stock_actual + cantidad ... AND stock_ilimitado = false`.
        const consumibleSaleIdsForStock = Array.from(new Set(consumibleItems.map((item) => item.venta_id)))
        const consumibleSaleBarraRows = await tx.$queryRaw<{ id: string; barra_id: string }[]>`
          SELECT id, barra_id FROM consumibles_ventas
          WHERE id IN (${Prisma.join(consumibleSaleIdsForStock)}) AND empresa_id = ${input.empresaId}
        `
        const barraIdByVentaId = new Map(consumibleSaleBarraRows.map((row) => [row.id, row.barra_id]))

        for (const item of consumibleItems) {
          await tx.$executeRaw`
            UPDATE refund_manual_case_consumible_items
            SET status = 'executed', quantity_executed = quantity_requested, quantity_rejected = 0
            WHERE id = ${item.id} AND case_id = ${refundCase.id}
          `

          const execPayload = JSON.stringify({ quantity_executed: Number(item.quantity_requested ?? 0), venta_item_id: item.venta_item_id })
          await tx.$executeRaw`
            INSERT INTO refund_manual_case_consumible_item_events
            (id, case_id, consumible_case_item_id, event_type, actor_id, actor_type, payload_json)
            VALUES (${uuidv4()}, ${refundCase.id}, ${item.id}, 'quantity_executed', ${input.actorId}, ${input.actorType}, ${execPayload})
          `

          const stockBarraId = barraIdByVentaId.get(item.venta_id)
          const refundedQuantity = Number(item.quantity_requested ?? 0)
          if (stockBarraId && item.consumible_id && refundedQuantity > 0) {
            await tx.$executeRaw`
              UPDATE barra_stock SET stock_actual = stock_actual + ${refundedQuantity}
              WHERE barra_id = ${stockBarraId} AND consumible_id = ${item.consumible_id}
                AND stock_ilimitado = false
            `
          }
        }

        const affectedSaleIds = Array.from(new Set(consumibleItems.map((item) => item.venta_id)))
        for (const saleId of affectedSaleIds) {
          await syncBuyerConsumibleSaleState(tx, saleId, input.empresaId)
        }

        // Build per-sale proportional reversal data for the platform profit-sharing ledger.
        // A consumible refund here can be PARTIAL (a subset of the sale's quantity), so we
        // reverse the platform allocation PROPORTIONALLY to the refunded amount of each sale
        // (refundAmount / original sale total). refundAmount = sum of the executed items'
        // amount_snapshot for that sale; sourceAmount = the ORIGINAL sale total (read BEFORE
        // syncBuyerConsumibleSaleState may have zeroed/adjusted derived columns — we read the
        // immutable `total` column, which represents the gross sale amount and is not mutated
        // on partial/full refund). The actual reversal runs post-commit (mixed-driver: cannot
        // call the Prisma-native reverse fn inside this prismaDirectUrl tx).
        const refundAmountBySale = new Map<string, number>()
        for (const item of consumibleItems) {
          refundAmountBySale.set(
            item.venta_id,
            roundRefundAmount((refundAmountBySale.get(item.venta_id) ?? 0) + Number(item.amount_snapshot ?? 0))
          )
        }
        const consumibleProportionalReversals: ConsumibleProportionalReversal[] = []
        for (const saleId of affectedSaleIds) {
          const saleTotalRows = await tx.$queryRaw<{ total: number | string }[]>`
            SELECT total FROM consumibles_ventas WHERE id = ${saleId} AND empresa_id = ${input.empresaId}
          `
          const sourceAmount = Number(saleTotalRows[0]?.total ?? 0)
          const refundAmount = refundAmountBySale.get(saleId) ?? 0
          if (sourceAmount > 0 && refundAmount > 0) {
            consumibleProportionalReversals.push({ sourceId: saleId, refundAmount, sourceAmount })
          }
        }

        // When MP ran, enrich evidence/reference with the MP result (mirrors entradas). When it
        // did not run, keep the manual evidence_note / external reference unchanged.
        const consumibleResolvedEvidenceNote = consumibleAutomaticRefund
          ? (normalizedEvidenceNote
              ?? `Reembolso automático en Mercado Pago${consumibleAutomaticRefund.refundStatus ? ` (${getMercadoPagoStatusLabel(consumibleAutomaticRefund.refundStatus)})` : ''}`)
          : normalizedEvidenceNote
        const consumibleResolvedExternalReference = consumibleAutomaticRefund
          ? (consumibleAutomaticRefund.refundReference ?? normalizedExternalReference)
          : normalizedExternalReference

        await transitionRefundManualCase(tx, {
          refundCase,
          empresaId: input.empresaId,
          actorId: input.actorId,
          actorType: input.actorType,
          nextStatus: 'executed',
          eventType: 'case_executed',
          evidenceNote: consumibleResolvedEvidenceNote,
          externalRefundReference: consumibleResolvedExternalReference,
          extraPayload: consumibleAutomaticRefund
            ? {
                refund_provider: 'mercadopago',
                automatic_refund: true,
                refund_status: consumibleAutomaticRefund.refundStatus ?? undefined,
                refunded_amount: consumibleAutomaticRefund.refundedAmount ?? undefined,
                operator_external_reference: normalizedExternalReference ?? undefined,
                items: consumibleItems.map((item) => ({
                  venta_item_id: item.venta_item_id,
                  quantity_executed: Number(item.quantity_requested ?? 0),
                })),
              }
            : {
                manual_execution: true,
                items: consumibleItems.map((item) => ({
                  venta_item_id: item.venta_item_id,
                  quantity_executed: Number(item.quantity_requested ?? 0),
                })),
              },
          resolved: true,
        })

        return { ok: true, caseId: refundCase.id, entryCancelSourceIds: [], consumibleCancelSourceIds: [], consumibleProportionalReversals, resolvedEvidenceNote: consumibleResolvedEvidenceNote ?? '', resolvedExternalReference: consumibleResolvedExternalReference }
      }

      if (!['requested', 'under_review', 'approved_for_manual_execution'].includes(refundCase.status)) {
        return { ok: false, status: 409, error: 'El caso no está en un estado válido para ejecutar el reembolso' }
      }

      const caseItems = await getCaseItemsForUpdate(tx, refundCase.id)
      if (caseItems.length === 0) {
        return { ok: false, status: 409, error: 'El caso no tiene items vinculados para ejecutar' }
      }

      const executionGuard = await guardRefundExecutionByPaymentState(tx, {
        refundCase,
        empresaId: input.empresaId,
        actorId: input.actorId,
        actorType: input.actorType,
        caseItems,
      })

      if (executionGuard) {
        return { ok: true, caseId: refundCase.id, entryCancelSourceIds: [], consumibleCancelSourceIds: [], consumibleProportionalReversals: [], resolvedEvidenceNote: normalizedEvidenceNote ?? '', resolvedExternalReference: normalizedExternalReference }
      }

      const blockedItems = getBlockedItems(caseItems)
      if (blockedItems.length > 0) {
        return {
          ok: false,
          status: 409,
          error: getCaseItemsErrorMessage(blockedItems.map((item) => ({
            target_type: item.target_type,
            target_id: item.target_id,
            block_reason: item.block_reason,
          }))),
        }
      }

      if (!refundCase.payment_id?.trim()) {
        return { ok: false, status: 409, error: 'El caso no tiene payment_id asociado para ejecutar el reembolso automático' }
      }

      const refundAmount = getRefundAmountFromCaseItems(caseItems)

      const automaticRefund = await executeAutomaticMercadoPagoRefund({
        empresaId: input.empresaId,
        paymentId: refundCase.payment_id,
        refundCaseId: refundCase.id,
        refundAmount,
      })

      if (!automaticRefund.ok) return automaticRefund

      const entryCancelSourceIds: string[] = []
      const consumibleCancelSourceIds: string[] = []

      for (const item of caseItems) {
        if (item.target_type === 'entrada') {
          const rows = await tx.$queryRaw<EntradaLinkRow[]>`
            SELECT en.id, en.estado, en.precio_pagado, en.comprador_id, en.asiento_id
            FROM entradas en
            JOIN eventos ev ON ev.id = en.evento_id
            WHERE en.id = ${item.target_id} AND ev.empresa_id = ${input.empresaId}
            LIMIT 1
            FOR UPDATE
          `

          const entry = rows[0]
          if (!entry) {
            return { ok: false, status: 404, error: `Entrada ${item.target_id} no encontrada` }
          }

          if (entry.estado === 'usada') {
            return { ok: false, status: 409, error: `entrada ${item.target_id} bloqueado: entrada_usada` }
          }

          if (entry.estado === 'cancelada') {
            return { ok: false, status: 409, error: `entrada ${item.target_id} bloqueado: entrada_cancelada` }
          }

          await tx.$executeRaw`UPDATE entradas SET estado = 'cancelada' WHERE id = ${item.target_id}`
          await tx.$executeRaw`
            UPDATE refund_manual_case_items SET target_status_after = 'cancelada'
            WHERE id = ${item.id} AND case_id = ${refundCase.id}
          `
          entryCancelSourceIds.push(item.target_id)

          // Seated events: free the seat in the SAME transaction as the ticket cancellation
          // so they can never get out of sync (entrada cancelada with a seat stuck 'vendido').
          if (entry.asiento_id) {
            await tx.$executeRaw`
              UPDATE asientos SET estado = 'disponible', entrada_id = NULL, checkout_session_id = NULL, reserved_until = NULL
              WHERE id = ${entry.asiento_id} AND estado = 'vendido'
            `
          }

          continue
        }

        // Inline cancelPendingConsumableSale logic — inlined to run within the active Prisma tx for atomicity
        const saleRows = await tx.$queryRaw<{ estado: string; barra_id: string }[]>`
          SELECT estado, barra_id FROM consumibles_ventas
          WHERE id = ${item.target_id} AND empresa_id = ${input.empresaId}
          FOR UPDATE
        `

        if (!saleRows.length) {
          return { ok: false, status: 404, error: `consumible_venta ${item.target_id} no encontrado` }
        }

        if (saleRows[0].estado !== 'pendiente') {
          return {
            ok: false,
            status: 409,
            error: saleRows[0].estado === 'canjeado'
              ? `consumible_venta ${item.target_id} bloqueado: consumible_canjeado`
              : `consumible_venta ${item.target_id} bloqueado: consumible_cancelado`,
          }
        }

        const ventaItemRows = await tx.$queryRaw<{ consumible_id: string; cantidad: number }[]>`
          SELECT consumible_id, cantidad FROM consumibles_venta_items WHERE venta_id = ${item.target_id}
        `

        const saleTotal = await tx.$queryRaw<{ total: number }[]>`
          SELECT total FROM consumibles_ventas WHERE id = ${item.target_id} AND empresa_id = ${input.empresaId}
        `
        const totalOriginal = Number(saleTotal[0]?.total ?? 0)

        await tx.$executeRaw`
          UPDATE consumibles_ventas
          SET estado = 'cancelado', neto_empresa_amount = 0, owner_fee_amount = 0, mp_fee_amount = 0,
              refunded_amount = ${totalOriginal}, resuelto_at = NOW()
          WHERE id = ${item.target_id} AND empresa_id = ${input.empresaId}
        `

        for (const vi of ventaItemRows) {
          // Los ítems con stock_ilimitado nunca se descontaron → tampoco se restauran.
          await tx.$executeRaw`
            UPDATE barra_stock SET stock_actual = stock_actual + ${vi.cantidad}
            WHERE barra_id = ${saleRows[0].barra_id} AND consumible_id = ${vi.consumible_id}
              AND stock_ilimitado = false
          `
        }

        await tx.$executeRaw`
          UPDATE refund_manual_case_items SET target_status_after = 'cancelado'
          WHERE id = ${item.id} AND case_id = ${refundCase.id}
        `
        consumibleCancelSourceIds.push(item.target_id)
      }

      const resolvedEvidenceNote = normalizedEvidenceNote
        ?? `Reembolso automático en Mercado Pago${automaticRefund.data.refundStatus ? ` (${getMercadoPagoStatusLabel(automaticRefund.data.refundStatus)})` : ''}`
      const resolvedExternalReference = automaticRefund.data.refundReference ?? normalizedExternalReference

      await transitionRefundManualCase(tx, {
        refundCase,
        empresaId: input.empresaId,
        actorId: input.actorId,
        actorType: input.actorType,
        nextStatus: 'executed',
        eventType: 'case_executed',
        evidenceNote: resolvedEvidenceNote,
        externalRefundReference: resolvedExternalReference,
        extraPayload: {
          refund_provider: 'mercadopago',
          automatic_refund: true,
          refund_status: automaticRefund.data.refundStatus ?? undefined,
          refunded_amount: automaticRefund.data.refundedAmount ?? undefined,
          operator_external_reference: normalizedExternalReference ?? undefined,
        },
        resolved: true,
      })

      return { ok: true, caseId: refundCase.id, entryCancelSourceIds, consumibleCancelSourceIds, consumibleProportionalReversals: [], resolvedEvidenceNote, resolvedExternalReference }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 15000 })
  )

  if (!txResult.ok) return { ok: false as const, status: txResult.status, error: txResult.error }

  // Post-commit platform profit-sharing reversal — uses the Prisma-native path (no executor
  // arg = prisma module-level client). Kept OUTSIDE the prismaDirectUrl tx on purpose
  // (mixed-driver: the reverse fns own their own Prisma client). All reversals are idempotent:
  //  - reversePlatformAllocationsForSources skips allocations that already have ANY reversal row
  //    (LEFT JOIN ... reversal.id IS NULL), so an SLA retry / re-run can't double-reverse.
  //  - reversePlatformAllocationsProportionally skips allocations that already have a reversal row
  //    keyed by the SAME (reversal_reference_type, reversal_reference_id) — here
  //    ('refund_manual_case', caseId), which is stable across re-runs — so it is also re-run safe.

  // ENTRADAS-flow case: entradas are all-or-nothing (a cancelled entrada → full allocation
  // reversal). Any consumible sale linked to an entradas-flow case is FULLY cancelled too
  // (estado='cancelado', refunded_amount = total), so a full reversal is also correct there.
  if (txResult.entryCancelSourceIds.length > 0) {
    await reversePlatformAllocationsForSources({
      sourceType: 'entrada',
      sourceIds: txResult.entryCancelSourceIds,
      empresaId: input.empresaId,
      reason: 'manual_refund_executed',
      referenceType: 'refund_manual_case',
      referenceId: txResult.caseId,
    })
  }

  if (txResult.consumibleCancelSourceIds.length > 0) {
    await reversePlatformAllocationsForSources({
      sourceType: 'consumible_venta',
      sourceIds: txResult.consumibleCancelSourceIds,
      empresaId: input.empresaId,
      reason: 'manual_refund_executed',
      referenceType: 'refund_manual_case',
      referenceId: txResult.caseId,
    })
  }

  // CONSUMIBLES-flow case: refunds can be PARTIAL (a subset of the sale's quantity), so the
  // platform allocation must be reversed PROPORTIONALLY to the refunded amount of each sale
  // (full reversal happens automatically when refundAmount >= sourceAmount, since the fn clamps
  // ratio to 1). Reverse per-sale; failures are swallowed best-effort and can be retried (the
  // reversal is idempotent on the (reference_type, reference_id) pair above).
  for (const reversal of txResult.consumibleProportionalReversals) {
    await reversePlatformAllocationsProportionally({
      sourceType: 'consumible_venta',
      sourceId: reversal.sourceId,
      refundAmount: reversal.refundAmount,
      sourceAmount: reversal.sourceAmount,
      empresaId: input.empresaId,
      reason: 'manual_refund_executed',
      referenceType: 'refund_manual_case',
      referenceId: txResult.caseId,
    }).catch(() => {
      // best-effort: reversal is idempotent (keyed by reference_type+reference_id) and retriable
    })
  }

  return { ok: true as const, status: 200, data: await getRefundManualCaseDetail(txResult.caseId, input.empresaId) }
}

export async function resolveRefundManualCaseAsNonRefundable(input: {
  caseId: string
  empresaId: string
  actorId: string
  actorType: 'empresa' | 'empleado'
  reason: string
  note?: string | null
}) {
  const normalizedReason = input.reason.trim()
  if (!normalizedReason) {
    return { ok: false as const, status: 400, error: 'reason es requerido' }
  }

  const normalizedNote = normalizeOptionalText(input.note)

  type TxResult =
    | { ok: false; status: number; error: string }
    | { ok: true; caseId: string }

  const txResult = await withSerializableRetry(() =>
    prismaDirectUrl.$transaction<TxResult>(async (tx) => {
      const refundCase = await lockRefundManualCase(tx, input.caseId, input.empresaId)
      if (!refundCase) return { ok: false, status: 404, error: 'Caso no encontrado' }

      if (refundCase.flow !== 'consumibles') {
        return { ok: false, status: 409, error: 'Solo los casos de consumibles pueden cerrarse como no reembolsables en este MVP' }
      }

      if (!['requested', 'under_review', 'approved_for_manual_execution'].includes(refundCase.status)) {
        return { ok: false, status: 409, error: 'El caso no se puede cerrar como no reembolsable en su estado actual' }
      }

      if (refundCase.request_origin === 'buyer_consumible_request') {
        const consumibleItems = await getCaseConsumibleItemsForUpdate(tx, refundCase.id)
        for (const item of consumibleItems) {
          await tx.$executeRaw`
            UPDATE refund_manual_case_consumible_items
            SET status = 'resolved_non_refundable', quantity_rejected = 0
            WHERE id = ${item.id} AND case_id = ${refundCase.id}
          `
        }
      }

      await transitionRefundManualCase(tx, {
        refundCase,
        empresaId: input.empresaId,
        actorId: input.actorId,
        actorType: input.actorType,
        nextStatus: 'resolved_non_refundable',
        eventType: 'case_resolved_non_refundable',
        reason: normalizedReason,
        note: normalizedNote,
        evidenceNote: normalizedNote,
        resolved: true,
      })

      return { ok: true, caseId: refundCase.id }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 15000 })
  )

  if (!txResult.ok) return { ok: false as const, status: txResult.status, error: txResult.error }

  return { ok: true as const, status: 200, data: await getRefundManualCaseDetail(txResult.caseId, input.empresaId) }
}

export async function rejectRefundManualCase(input: {
  caseId: string
  empresaId: string
  actorId: string
  actorType: 'empresa' | 'empleado'
  reason: string
  note?: string | null
  evidenceNote?: string | null
  externalRefundReference?: string | null
}) {
  const normalizedReason = input.reason.trim()
  if (!normalizedReason) {
    return { ok: false as const, status: 400, error: 'reason es requerido' }
  }

  const normalizedNote = normalizeOptionalText(input.note)
  const normalizedEvidenceNote = normalizeOptionalText(input.evidenceNote)
  const normalizedExternalReference = normalizeOptionalText(input.externalRefundReference)

  if (!normalizedEvidenceNote && !normalizedExternalReference) {
    return { ok: false as const, status: 400, error: 'El rechazo manual requiere evidencia o referencia externa' }
  }

  type TxResult =
    | { ok: false; status: number; error: string }
    | { ok: true; caseId: string }

  const txResult = await withSerializableRetry(() =>
    prismaDirectUrl.$transaction<TxResult>(async (tx) => {
      const refundCase = await lockRefundManualCase(tx, input.caseId, input.empresaId)
      if (!refundCase) return { ok: false, status: 404, error: 'Caso no encontrado' }

      if (!['requested', 'under_review', 'approved_for_manual_execution'].includes(refundCase.status)) {
        return { ok: false, status: 409, error: 'El caso no se puede rechazar en su estado actual' }
      }

      await rejectRefundManualCaseWithinTransaction(tx, {
        refundCase,
        empresaId: input.empresaId,
        actorId: input.actorId,
        actorType: input.actorType,
        reason: normalizedReason,
        note: normalizedNote,
        evidenceNote: normalizedEvidenceNote,
        externalRefundReference: normalizedExternalReference,
      })

      return { ok: true, caseId: refundCase.id }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 15000 })
  )

  if (!txResult.ok) return { ok: false as const, status: txResult.status, error: txResult.error }

  return { ok: true as const, status: 200, data: await getRefundManualCaseDetail(txResult.caseId, input.empresaId) }
}
