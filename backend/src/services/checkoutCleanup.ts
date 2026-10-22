import { prismaDirectUrl } from '../lib/prisma'
import { Prisma } from '@prisma/client'
import { logEvent, logServerError, logServerInfo } from '../lib/safe-log'
import { expireOverdueWaitlists, promoteNextForCategoria } from '../lib/waitlist'
import { sendWaitlistPromotedEmail } from '../lib/waitlist-email'

const EXPIRED_CHECKOUT_BATCH_SIZE = 100

export function resolveExpiredCheckoutBatchSize(batchSize: number) {
  if (!Number.isFinite(batchSize)) {
    return EXPIRED_CHECKOUT_BATCH_SIZE
  }

  return Math.min(EXPIRED_CHECKOUT_BATCH_SIZE, Math.max(1, Math.trunc(batchSize)))
}

type CheckoutItem = {
  categoriaId: string
  cantidad: number
}

type ConsumibleCheckoutItem = {
  barraId: string
  consumibleId: string
  cantidad: number
}

type CheckoutAddonItem = {
  id: string
  cantidad: number
}

type CheckoutFlow = 'entradas' | 'consumibles' | 'mixto'

type CheckoutSessionData = {
  flow?: 'entradas' | 'consumibles'
  items: Array<CheckoutItem | ConsumibleCheckoutItem>
  addons?: CheckoutAddonItem[]
  seat_reservation_id?: string | null
}

// Fase 3 — checkout mixto (entradas+addons+consumibles en un solo carrito). Este
// archivo mantiene su PROPIA copia de tipos (desacoplada de routes/tenant.ts) por
// diseño, así que necesita su propio branch 'mixto' — de lo contrario cualquier
// sesión 'mixto' abandonada nunca liberaría su stock (mismo bug que ya existía acá
// para 'consumibles' antes de que este archivo aprendiera esa forma).
// Solo necesita cantidades para restaurar stock — no fee ni marketplaceFee.
type MixtoCheckoutSessionData = {
  flow: 'mixto'
  itemsEntradas: CheckoutItem[]
  addons?: CheckoutAddonItem[]
  itemsConsumibles: ConsumibleCheckoutItem[]
}

export type CheckoutCleanupSessionRow = {
  id: string
  comprador_id: string
  empresa_id: string
  datos: string | CheckoutSessionData | MixtoCheckoutSessionData | CheckoutItem[]
  estado?: 'reservada' | 'confirmada' | 'expirada' | 'cancelada'
  expires_at?: string | Date | null
  confirmed_at?: string | Date | null
}

function parseCheckoutSessionData(
  raw: string | CheckoutSessionData | MixtoCheckoutSessionData | CheckoutItem[],
): CheckoutSessionData | MixtoCheckoutSessionData {
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw

  if (Array.isArray(parsed)) {
    return { flow: 'entradas', items: parsed }
  }

  if (parsed?.flow === 'mixto') {
    return {
      flow: 'mixto',
      itemsEntradas: Array.isArray(parsed?.itemsEntradas) ? parsed.itemsEntradas : [],
      addons: Array.isArray(parsed?.addons) ? parsed.addons : undefined,
      itemsConsumibles: Array.isArray(parsed?.itemsConsumibles) ? parsed.itemsConsumibles : [],
    }
  }

  return {
    flow: parsed?.flow === 'consumibles' ? 'consumibles' : 'entradas',
    items: Array.isArray(parsed?.items) ? parsed.items : [],
    seat_reservation_id: typeof parsed?.seat_reservation_id === 'string' ? parsed.seat_reservation_id : null,
  }
}

function getCheckoutFlow(sessionData: CheckoutSessionData | MixtoCheckoutSessionData): CheckoutFlow {
  if (sessionData.flow === 'mixto') return 'mixto'
  return sessionData.flow === 'consumibles' ? 'consumibles' : 'entradas'
}

function parseCheckoutItems(raw: string | CheckoutSessionData | MixtoCheckoutSessionData | CheckoutItem[]): CheckoutItem[] {
  const sessionData = parseCheckoutSessionData(raw)
  if (sessionData.flow === 'mixto') return sessionData.itemsEntradas
  return sessionData.items as CheckoutItem[]
}

function parseConsumibleCheckoutItems(raw: string | CheckoutSessionData | MixtoCheckoutSessionData | CheckoutItem[]): ConsumibleCheckoutItem[] {
  const sessionData = parseCheckoutSessionData(raw)
  if (sessionData.flow === 'mixto') return sessionData.itemsConsumibles
  return getCheckoutFlow(sessionData) === 'consumibles' ? (sessionData.items as ConsumibleCheckoutItem[]) : []
}

function parseCheckoutAddons(raw: string | CheckoutSessionData | MixtoCheckoutSessionData | CheckoutItem[]): CheckoutAddonItem[] {
  const sessionData = parseCheckoutSessionData(raw)
  const addons = sessionData.flow === 'mixto'
    ? sessionData.addons
    : (getCheckoutFlow(sessionData) === 'entradas' ? sessionData.addons : undefined)
  if (!Array.isArray(addons)) return []
  return addons.filter(
    (entry): entry is CheckoutAddonItem =>
      typeof entry?.id === 'string' && Number.isFinite(Number(entry?.cantidad ?? 0))
  )
}

// Accepts a Prisma interactive transaction client so it can be called both from
// cancelarReserva (tenant.ts) and from the cleanup batch below.
export async function releaseStockForCheckoutSession(
  tx: Prisma.TransactionClient,
  session: CheckoutCleanupSessionRow,
) {
  const sessionData = parseCheckoutSessionData(session.datos)

  if (getCheckoutFlow(sessionData) === 'consumibles') {
    const items = parseConsumibleCheckoutItems(session.datos)
    const stockNecesario = new Map<string, { barraId: string; consumibleId: string; cantidad: number }>()

    for (const item of items) {
      const key = `${item.barraId}::${item.consumibleId}`
      const current = stockNecesario.get(key) ?? { barraId: item.barraId, consumibleId: item.consumibleId, cantidad: 0 }
      current.cantidad += Number(item.cantidad ?? 0)
      stockNecesario.set(key, current)
    }

    for (const item of stockNecesario.values()) {
      // Los ítems con stock_ilimitado nunca se descontaron → tampoco se restauran.
      await tx.$executeRaw`
        UPDATE barra_stock
        SET stock_actual = stock_actual + ${item.cantidad}
        WHERE barra_id = ${item.barraId} AND consumible_id = ${item.consumibleId}
          AND stock_ilimitado = false
      `
      logEvent('stock_restored', { barra_id: item.barraId, consumible_id: item.consumibleId, quantity: item.cantidad, source: 'checkout_expiry_consumibles', session_id: session.id })
    }

    return
  }

  if (getCheckoutFlow(sessionData) === 'mixto') {
    // Fase 3: 'mixto' reserva stock de barra_stock Y entrada_categorias/evento_addons
    // en la MISMA sesión — hay que liberar AMBOS o quedaría un stock-leak permanente
    // en uno de los dos dominios. Mismo código que los branches 'consumibles' y
    // 'entradas' de arriba/abajo, pero leyendo itemsConsumibles/itemsEntradas.
    // NO libera asientos numerados — fuera de scope v1 (el tipo mixto no trae
    // seat_reservation_id, así que no hay nada que liberar acá).
    const consumibleItems = parseConsumibleCheckoutItems(session.datos)
    const stockNecesarioConsumibles = new Map<string, { barraId: string; consumibleId: string; cantidad: number }>()

    for (const item of consumibleItems) {
      const key = `${item.barraId}::${item.consumibleId}`
      const current = stockNecesarioConsumibles.get(key) ?? { barraId: item.barraId, consumibleId: item.consumibleId, cantidad: 0 }
      current.cantidad += Number(item.cantidad ?? 0)
      stockNecesarioConsumibles.set(key, current)
    }

    for (const item of stockNecesarioConsumibles.values()) {
      // Los ítems con stock_ilimitado nunca se descontaron → tampoco se restauran.
      await tx.$executeRaw`
        UPDATE barra_stock
        SET stock_actual = stock_actual + ${item.cantidad}
        WHERE barra_id = ${item.barraId} AND consumible_id = ${item.consumibleId}
          AND stock_ilimitado = false
      `
      logEvent('stock_restored', { barra_id: item.barraId, consumible_id: item.consumibleId, quantity: item.cantidad, source: 'checkout_expiry_mixto', session_id: session.id })
    }

    const entradaItems = parseCheckoutItems(session.datos)
    const stockNecesarioEntradas = new Map<string, number>()

    for (const item of entradaItems) {
      stockNecesarioEntradas.set(item.categoriaId, (stockNecesarioEntradas.get(item.categoriaId) ?? 0) + Number(item.cantidad ?? 0))
    }

    for (const [categoriaId, cantidad] of stockNecesarioEntradas.entries()) {
      await tx.$executeRaw`
        UPDATE entrada_categorias
        SET stock_disponible = stock_disponible + ${cantidad}
        WHERE id = ${categoriaId}
      `
      logEvent('stock_restored', { categoria_id: categoriaId, quantity: cantidad, source: 'checkout_expiry_mixto', session_id: session.id })
    }

    const addonsMixto = parseCheckoutAddons(session.datos)
    const addonsAgregadosMixto = new Map<string, number>()
    for (const addon of addonsMixto) {
      addonsAgregadosMixto.set(addon.id, (addonsAgregadosMixto.get(addon.id) ?? 0) + Number(addon.cantidad ?? 0))
    }

    for (const [addonId, cantidad] of addonsAgregadosMixto.entries()) {
      if (cantidad <= 0) continue
      await tx.$executeRaw`
        UPDATE evento_addons
        SET stock_disponible = stock_disponible + ${cantidad}
        WHERE id = ${addonId}
      `
      logEvent('addon_stock_restored', { addon_id: addonId, quantity: cantidad, source: 'checkout_expiry_mixto', session_id: session.id })
    }

    return
  }

  const items = parseCheckoutItems(session.datos)
  const stockNecesario = new Map<string, number>()

  for (const item of items) {
    stockNecesario.set(item.categoriaId, (stockNecesario.get(item.categoriaId) ?? 0) + Number(item.cantidad ?? 0))
  }

  for (const [categoriaId, cantidad] of stockNecesario.entries()) {
    await tx.$executeRaw`
      UPDATE entrada_categorias
      SET stock_disponible = stock_disponible + ${cantidad}
      WHERE id = ${categoriaId}
    `
    logEvent('stock_restored', { categoria_id: categoriaId, quantity: cantidad, source: 'checkout_expiry', session_id: session.id })
  }

  // Addons reservados en la session también deben devolverse al stock disponible
  // si el checkout expira sin confirmar — mismo patrón que entradas.
  const addons = parseCheckoutAddons(session.datos)
  const addonsAgregados = new Map<string, number>()
  for (const addon of addons) {
    addonsAgregados.set(addon.id, (addonsAgregados.get(addon.id) ?? 0) + Number(addon.cantidad ?? 0))
  }

  // Loop simple: cleanup corre cada 30s en prod; un batch UPDATE con VALUES
  // ahorraría ~50ms por sesión expirada pero introduce riesgo de runtime error
  // si la sintaxis Prisma.join falla — y un cleanup roto = stock leak permanente.
  // El caso real son 1-3 addons por sesión, así que N round-trips es despreciable.
  for (const [addonId, cantidad] of addonsAgregados.entries()) {
    if (cantidad <= 0) continue
    await tx.$executeRaw`
      UPDATE evento_addons
      SET stock_disponible = stock_disponible + ${cantidad}
      WHERE id = ${addonId}
    `
    logEvent('addon_stock_restored', { addon_id: addonId, quantity: cantidad, source: 'checkout_expiry', session_id: session.id })
  }

  // Seated events: release any reserved seats linked to this checkout session's seat_reservation_id.
  const seatReservationId = (sessionData as CheckoutSessionData).seat_reservation_id
  if (seatReservationId) {
    const result = await tx.$executeRaw`
      UPDATE asientos
      SET estado = 'disponible', checkout_session_id = NULL, reserved_until = NULL
      WHERE checkout_session_id = ${seatReservationId} AND estado = 'reservado'
    `
    logEvent('seats_released', { seat_reservation_id: seatReservationId, rows_updated: Number(result), source: 'checkout_expiry', session_id: session.id })
  }
}

// Recorre los categoria_ids cuyo stock fue restaurado y trata de promover al
// siguiente waitlist. Se ejecuta DESPUÉS del commit del cleanup (fuera de la tx)
// para no extender el lock — la promoción tiene su propia tx Serializable.
async function tryPromoteWaitlistsForCategorias(categoriaIds: Iterable<string>): Promise<void> {
  for (const categoriaId of new Set(categoriaIds)) {
    try {
      const result = await promoteNextForCategoria(categoriaId)
      if (result.promoted && result.entry) {
        logEvent('waitlist_promoted', {
          waitlist_entry_id: result.entry.id,
          categoria_id: categoriaId,
          comprador_id: result.entry.comprador_id,
          cantidad: result.entry.cantidad_solicitada,
          source: 'checkout_cleanup',
        })
        // Send email best-effort
        if (result.entry.comprador_email) {
          const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://ticketera.com'
          // Get empresa slug for URL
          const empresaRow = await prismaDirectUrl.empresa.findUnique({
            where: { id: result.entry.empresa_id },
            select: { slug: true, nombre: true },
          }).catch(() => null)
          const checkoutUrl = empresaRow?.slug
            ? `${baseUrl}/t/${empresaRow.slug}/evento/${result.entry.evento_id}?wl=${result.entry.id}`
            : baseUrl
          void sendWaitlistPromotedEmail({
            toEmail: result.entry.comprador_email,
            compradorNombre: result.entry.comprador_nombre,
            eventoNombre: result.entry.evento_nombre,
            categoriaNombre: result.entry.categoria_nombre,
            cantidadSolicitada: result.entry.cantidad_solicitada,
            checkoutUrl,
            expiresAt: result.entry.expires_at ? new Date(result.entry.expires_at) : new Date(Date.now() + 15 * 60 * 1000),
            empresaNombre: empresaRow?.nombre ?? 'el organizador',
            empresaSlug: empresaRow?.slug ?? '',
          })
        }
      }
    } catch (err) {
      logServerError(`waitlist promote failed for categoria ${categoriaId}`, err)
    }
  }
}

// Cleanup batch: acquires a pg advisory lock so only one backend instance runs the
// cleanup at a time (replaces MySQL GET_LOCK which is not available in Postgres).
async function cleanupExpiredCheckoutReservationBatch(batchSize: number): Promise<{ cleaned: number; categoriaIds: string[] }> {
  const safeBatchSize = resolveExpiredCheckoutBatchSize(batchSize)

  return prismaDirectUrl.$transaction(async (tx) => {
    // pg_advisory_xact_lock is released automatically at transaction end.
    // Key 8823 is arbitrary but stable (chosen to not collide with other locks).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(8823)`

    // FOR UPDATE locks each expired row so concurrent cleaners skip them.
    const expiredSessions = await tx.$queryRaw<CheckoutCleanupSessionRow[]>`
      SELECT id, comprador_id, empresa_id, datos, estado, expires_at, confirmed_at
      FROM checkout_sessions
      WHERE estado = 'reservada' AND expires_at IS NOT NULL AND expires_at < NOW()
      ORDER BY expires_at ASC, id ASC
      LIMIT ${safeBatchSize}
      FOR UPDATE SKIP LOCKED
    `

    if (!expiredSessions.length) return { cleaned: 0, categoriaIds: [] as string[] }

    let cleaned = 0
    const categoriaIdsLiberadas = new Set<string>()
    for (const session of expiredSessions) {
      const result = await tx.$executeRaw`
        UPDATE checkout_sessions
        SET estado = 'expirada'
        WHERE id = ${session.id} AND estado = 'reservada'
      `

      // result is the number of rows affected in Postgres via $executeRaw
      if (Number(result) !== 1) continue

      await releaseStockForCheckoutSession(tx, session)
      cleaned += 1

      // Track categoria_ids cuyo stock se liberó para intentar promover waitlist DESPUÉS del commit.
      // Solo tiene sentido para la porción de ENTRADAS ('entradas' o la mitad-entradas de 'mixto') —
      // parseCheckoutItems ya devuelve itemsEntradas para 'mixto'. Para 'consumibles' puro NO hay
      // categoria_id (item.categoriaId sería undefined pese al cast), así que ni se intenta.
      const sessionFlow = getCheckoutFlow(parseCheckoutSessionData(session.datos))
      if (sessionFlow === 'entradas' || sessionFlow === 'mixto') {
        const items = parseCheckoutItems(session.datos)
        for (const item of items) categoriaIdsLiberadas.add(item.categoriaId)
      }
    }

    return { cleaned, categoriaIds: Array.from(categoriaIdsLiberadas) }
  }, {
    isolationLevel: 'Serializable',
    maxWait: 5000,
    timeout: 30000,
  })
}

export async function cleanupExpiredCheckoutReservations(batchSize = EXPIRED_CHECKOUT_BATCH_SIZE): Promise<number> {
  const safeBatchSize = resolveExpiredCheckoutBatchSize(batchSize)
  let totalCleaned = 0
  const totalCategoriaIds = new Set<string>()

  while (true) {
    const batch = await cleanupExpiredCheckoutReservationBatch(safeBatchSize)
    totalCleaned += batch.cleaned
    for (const c of batch.categoriaIds) totalCategoriaIds.add(c)
    if (batch.cleaned < safeBatchSize) break
  }

  // Después de liberar stock por expiración, intentar promover waitlists
  if (totalCategoriaIds.size > 0) {
    await tryPromoteWaitlistsForCategorias(totalCategoriaIds)
  }

  // También expirar waitlists 'asignados' vencidos (15 min sin comprar) y promover los siguientes
  try {
    const expiredResult = await expireOverdueWaitlists()
    if (expiredResult.expired > 0) {
      logServerInfo(`[Waitlist cleanup] Expirados: ${expiredResult.expired}, stock restaurado: ${expiredResult.restoredStock}`)
    }
  } catch (err) {
    logServerError('waitlist expire overdue', err)
  }

  logServerInfo(`[Checkout cleanup] Reservas expiradas liberadas: ${totalCleaned}`)
  return totalCleaned
}

export { EXPIRED_CHECKOUT_BATCH_SIZE }
