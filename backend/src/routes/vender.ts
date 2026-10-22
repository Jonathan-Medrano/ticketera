import { Router, Request, Response } from 'express'
import { verifyInternal, requireAuth } from '../middleware/auth'
import { randomUUID as uuidv4 } from 'node:crypto'
import { getActorEmpresaId, requirePermission, requireUserType } from '../lib/authz'
import { logServerError } from '../lib/safe-log'
import { generateSecureShortCode } from '../lib/secure-code'
import { logEmpleadoActividad } from '../lib/empleado-actividad'
import { prisma, prismaDirectUrl } from '../lib/prisma'
import { roundMoney } from '../lib/money'
import { Prisma } from '@prisma/client'
import {
  dispatchBuyerPurchaseDelivery,
  type CheckoutSessionRow,
  type DeliveryConsumibleReceipt,
} from './tenant'

// Mismo patrón de validación de email usado en el resto del backend (pos.ts, marketing.ts).
const EMAIL_REGEX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

// El dispatch de email va DESPUÉS del commit de la venta y nunca debe bloquear la
// respuesta. Esperamos el resultado para dar feedback real, pero si Resend se cuelga
// cortamos con este timeout y reportamos "fallido" (la venta ya está hecha).
const EMAIL_DISPATCH_TIMEOUT_MS = 12_000

type EmailEnvioEstado = 'enviado' | 'fallido' | 'omitido' | 'no_solicitado'
type EmailEnvioResult = { estado: EmailEnvioEstado; email: string | null }

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('email_dispatch_timeout')), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

// Despacha el comprobante de consumibles por email reusando TODA la infra del flujo
// online (dispatchBuyerPurchaseDelivery, flow 'consumibles'): mismos templates + Resend.
// checkout_session_id sintética "pos-cons:<venta_id>" (columna plana en
// delivery_dispatch_attempts, NO FK) → sin migración. Nunca lanza: cualquier fallo se
// reporta como estado, jamás revierte la venta (que ya está commiteada).
async function dispatchPosConsumibleEmail(params: {
  empresaId: string
  email: string
  ventaId: string
  qrCode: string
  claveCorta: string
  total: number
  barraNombre: string
}): Promise<EmailEnvioResult> {
  const { empresaId, email, ventaId, qrCode, claveCorta, total, barraNombre } = params
  try {
    const empresa = await prisma.empresa.findFirst({ where: { id: empresaId }, select: { slug: true } })
    const slug = empresa?.slug ?? ''
    if (!slug) return { estado: 'fallido', email }

    const checkoutSessionId = `pos-cons:${ventaId}`

    // Idempotencia: si ya despachamos email OK para esta venta, no reenviar (doble click).
    const already = await prisma.deliveryDispatchAttempt.findFirst({
      where: { checkout_session_id: checkoutSessionId, channel: 'email', status: 'sent' },
      select: { id: true },
    })
    if (already) return { estado: 'omitido', email }

    const session: CheckoutSessionRow = {
      id: checkoutSessionId,
      comprador_id: '',
      empresa_id: empresaId,
      datos: [],
      email,
      comprador_nombre: undefined,
      phone_e164: null,
      phone_verified_at: null,
      delivery_preference: 'email',
    }
    const ventas: DeliveryConsumibleReceipt[] = [{ qrCode, claveCorta, barra: barraNombre, total }]

    const dispatchResult = await withTimeout(
      dispatchBuyerPurchaseDelivery({ slug, flow: 'consumibles', session, entradas: [], ventas }),
      EMAIL_DISPATCH_TIMEOUT_MS,
    )
    const ok = dispatchResult.attempts.some((a) => a.channel === 'email' && a.status === 'sent')
    return { estado: ok ? 'enviado' : 'fallido', email }
  } catch (err) {
    logServerError('consumibles venta email dispatch', err)
    return { estado: 'fallido', email }
  }
}

// Topes anti-abuso para ventas de consumibles (POS). Altos a propósito:
// no deben romper ventas legítimas grandes, solo frenar valores absurdos.
const MAX_CANTIDAD_POR_ITEM = 10000
const MAX_CANTIDAD_TOTAL_VENTA = 50000

// Medios de pago del POS de barra. Naming alineado con el POS de entradas
// (entradas.medio_pago_presencial) para que el historial de ambos POS sea consistente.
// monto_recibido / vuelto SOLO aplican a efectivo; en tarjeta/transferencia van NULL.
const MEDIOS_PAGO_VALIDOS = ['efectivo', 'tarjeta_manual', 'transferencia'] as const
type MedioPagoConsumible = (typeof MEDIOS_PAGO_VALIDOS)[number]

const router = Router()

type ItemInput = { consumible_id: string; cantidad: number }

type StockRow = {
  bs_id: string
  consumible_id: string
  stock_actual: number
  precio_override: number | null
  nombre: string
  precio_base: number
  stock_ilimitado: boolean
  agotado: boolean
}

type PromoRow = {
  id: string
  tipo: 'porcentaje' | 'monto_fijo' | 'precio_especial'
  valor: number
  consumible_ids: string
  cantidad_minima: number
  evento_id: string | null
}

// Strategy A — retry on P2034 serialization failure (high-contention POS)
async function withSerializableRetry<T>(fn: () => Promise<T>, retries = 3, backoffMs = 50): Promise<T> {
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

// POST /consumibles/vender — TRANSACCIÓN COMPLEJA con FOR UPDATE (Strategy A: prismaDirectUrl)
router.post('/', verifyInternal, requireAuth, async (req: Request, res: Response) => {
  const user = req.user!
  const empresaId = getActorEmpresaId(user)

  if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })
  if (!requireUserType(user, ['empresa', 'empleado'], res)) return
  if (!requirePermission(user, 'vender_consumibles', res)) return

  const { barra_id, evento_id, items, promocion_id, medio_pago, monto_recibido } = req.body

  if (!barra_id || !evento_id || !items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'barra_id, evento_id e items son requeridos' })
  }

  // Entrega por email (opcional, opt-in). La venta NUNCA se bloquea por el email.
  const enviarEmail = req.body?.enviar_email === true
  const compradorEmail =
    typeof req.body?.comprador_email === 'string' ? req.body.comprador_email.trim().toLowerCase() : ''

  // Cobro (opcional). medio_pago es opcional para no romper integraciones existentes;
  // si viene, debe ser uno de los válidos.
  let medioPago: MedioPagoConsumible | null = null
  if (medio_pago !== undefined && medio_pago !== null && medio_pago !== '') {
    if (typeof medio_pago !== 'string' || !MEDIOS_PAGO_VALIDOS.includes(medio_pago as MedioPagoConsumible)) {
      return res.status(400).json({ error: 'medio_pago inválido' })
    }
    medioPago = medio_pago as MedioPagoConsumible
  }

  // monto_recibido SOLO tiene sentido en efectivo (ayuda visual para calcular el vuelto).
  // En tarjeta/transferencia se ignora y queda NULL.
  let montoRecibido: number | null = null
  if (medioPago === 'efectivo' && monto_recibido !== undefined && monto_recibido !== null && monto_recibido !== '') {
    const n = Number(monto_recibido)
    if (!Number.isFinite(n) || n < 0) {
      return res.status(400).json({ error: 'monto_recibido inválido' })
    }
    montoRecibido = roundMoney(n)
  }

  let cantidadTotalVenta = 0
  for (const item of items as ItemInput[]) {
    if (!item.consumible_id || !Number.isInteger(item.cantidad) || item.cantidad <= 0) {
      return res.status(400).json({
        error: 'Cada item debe tener consumible_id y cantidad entera mayor a 0',
      })
    }
    if (item.cantidad > MAX_CANTIDAD_POR_ITEM) {
      return res.status(400).json({
        error: `La cantidad por ítem no puede superar ${MAX_CANTIDAD_POR_ITEM}`,
      })
    }
    cantidadTotalVenta += item.cantidad
  }

  if (cantidadTotalVenta > MAX_CANTIDAD_TOTAL_VENTA) {
    return res.status(400).json({
      error: `La cantidad total de la venta no puede superar ${MAX_CANTIDAD_TOTAL_VENTA}`,
    })
  }

  // Pre-tx: validate barra ownership (read-only — pooler is fine)
  const barra = await prisma.barra.findFirst({
    where: { id: barra_id, empresa_id: empresaId, evento_id },
    select: { id: true, nombre: true },
  })
  if (!barra) {
    return res.status(400).json({ error: 'Barra no encontrada o no pertenece a este evento' })
  }

  // TxResult captures the outcome from inside the Serializable transaction
  type TxResult =
    | {
        ok: true
        ventaId: string
        qrCode: string
        claveCorta: string
        total: number
        medioPago: MedioPagoConsumible | null
        montoRecibido: number | null
        vuelto: number | null
      }
    | { ok: false; status: number; error: string }

  let txResult: TxResult | null = null

  try {
    await withSerializableRetry(() =>
      prismaDirectUrl.$transaction(async (tx) => {
        txResult = null // reset on retry

        const consumibleIds = [...new Set((items as ItemInput[]).map((item) => item.consumible_id))]

        // FOR UPDATE Site 1 — batch lock barra_stock rows (Strategy A)
        const allStockRows = await tx.$queryRaw<StockRow[]>`
          SELECT bs.id AS bs_id, bs.consumible_id, bs.stock_actual, bs.precio_override::float AS precio_override,
                 c.nombre, c.precio::float AS precio_base, bs.stock_ilimitado, bs.agotado
          FROM barra_stock bs
          JOIN consumibles c ON c.id = bs.consumible_id
          WHERE bs.barra_id = ${barra_id}
            AND bs.consumible_id = ANY(${consumibleIds}::text[])
            AND bs.activo = true
          FOR UPDATE`

        const stockMap = new Map<string, StockRow>()
        for (const row of allStockRows) {
          stockMap.set(row.consumible_id, row)
        }

        const stockItems: Array<{
          consumible_id: string
          cantidad: number
          bs_id: string
          nombre: string
          precio: number
          subtotal: number
          stock_ilimitado: boolean
        }> = []

        for (const item of items as ItemInput[]) {
          const row = stockMap.get(item.consumible_id)
          if (!row) {
            txResult = {
              ok: false,
              status: 400,
              error: `consumible ${item.consumible_id} no disponible en esta barra`,
            }
            return
          }
          // agotado: kill-switch manual — bloquea la venta sin importar el número de stock.
          if (row.agotado) {
            txResult = { ok: false, status: 400, error: `${row.nombre} está agotado` }
            return
          }
          // Solo se valida stock si el consumible NO es ilimitado.
          if (!row.stock_ilimitado && row.stock_actual < item.cantidad) {
            txResult = { ok: false, status: 400, error: `stock insuficiente para ${row.nombre}` }
            return
          }
          stockItems.push({
            consumible_id: item.consumible_id,
            cantidad: item.cantidad,
            bs_id: row.bs_id,
            nombre: row.nombre,
            precio: Number(row.precio_override ?? row.precio_base),
            subtotal: 0,
            stock_ilimitado: row.stock_ilimitado,
          })
        }

        // Promo lookup (inside tx, read-only — no lock needed)
        let promo: PromoRow | null = null
        let promocionIdFinal: string | null = promocion_id ?? null

        if (promocion_id) {
          const promoRows = await tx.$queryRaw<PromoRow[]>`
            SELECT id, tipo, valor::float AS valor, consumible_ids, cantidad_minima, evento_id
            FROM consumibles_promociones
            WHERE id = ${promocion_id}
              AND empresa_id = ${empresaId}
              AND activa = true
              AND (fecha_inicio IS NULL OR fecha_inicio <= NOW())
              AND (fecha_fin IS NULL OR fecha_fin >= NOW())`

          if (promoRows.length) {
            promo = promoRows[0]
            if (promo.evento_id && String(promo.evento_id) !== String(evento_id)) {
              promo = null
              promocionIdFinal = null
            }
            const totalCantidad = stockItems.reduce((acc, i) => acc + i.cantidad, 0)
            if (promo && totalCantidad < promo.cantidad_minima) {
              promo = null
              promocionIdFinal = null
            }
          } else {
            promocionIdFinal = null
          }
        }

        // consumible_ids define a QUÉ productos aplica la promo (UI: "Consumibles incluidos
        // (ninguno = todos)"). Se parsea para TODOS los tipos, no solo precio_especial.
        // Lista vacía = aplica a todos los ítems del carrito.
        let idsPromo: string[] = []
        if (promo) {
          try {
            idsPromo = JSON.parse(promo.consumible_ids)
          } catch {
            idsPromo = []
          }
        }
        const promoAplicaATodos = idsPromo.length === 0
        const esElegible = (consumibleId: string) =>
          promoAplicaATodos || idsPromo.includes(consumibleId)

        for (const item of stockItems) {
          if (promo?.tipo === 'precio_especial' && esElegible(item.consumible_id)) {
            item.precio = Number(promo.valor)
          }
          item.subtotal = item.precio * item.cantidad
        }

        const subtotalBruto = stockItems.reduce((acc, i) => acc + i.subtotal, 0)
        // porcentaje/monto_fijo: el descuento se calcula SOLO sobre los ítems elegibles
        // de la promo, no sobre el carrito completo.
        const subtotalElegible = promo
          ? stockItems.reduce((acc, i) => acc + (esElegible(i.consumible_id) ? i.subtotal : 0), 0)
          : subtotalBruto

        let descuento = 0
        if (promo) {
          if (promo.tipo === 'porcentaje') {
            descuento = subtotalElegible * (Number(promo.valor) / 100)
          } else if (promo.tipo === 'monto_fijo') {
            descuento = subtotalElegible >= Number(promo.valor) ? Number(promo.valor) : 0
          }
          // precio_especial: descuento ya absorbido en precio por item
        }

        const total = subtotalBruto - descuento

        if (descuento < 0) {
          txResult = { ok: false, status: 400, error: 'El descuento calculado no puede ser negativo' }
          return
        }
        if (descuento > subtotalBruto) {
          txResult = { ok: false, status: 400, error: 'El descuento no puede superar el total de la venta' }
          return
        }
        if (total < 0) {
          txResult = { ok: false, status: 400, error: 'El total de la venta no puede ser negativo' }
          return
        }

        // FOR UPDATE Site 2 — decrement barra_stock for each item.
        // Los ítems con stock_ilimitado NO se descuentan (no se cuenta su stock).
        for (const item of stockItems) {
          if (item.stock_ilimitado) continue
          await tx.$executeRaw`
            UPDATE barra_stock
            SET stock_actual = stock_actual - ${item.cantidad}
            WHERE id = ${item.bs_id}`
        }

        // Cobro: el vuelto es ayuda visual, NO bloquea la venta. Si monto_recibido < total
        // (pago parcial / mixto: parte tarjeta + parte efectivo, etc.) NO frenamos: el vuelto
        // queda en 0 (no hay nada que devolver) pero igual persistimos lo que el cajero recibió.
        // Solo aplica a efectivo; en tarjeta/transferencia ambos quedan NULL.
        const montoRecibidoFinal = medioPago === 'efectivo' ? montoRecibido : null
        const vueltoFinal =
          medioPago === 'efectivo' && montoRecibidoFinal !== null
            ? roundMoney(Math.max(0, montoRecibidoFinal - total))
            : null

        const ventaId = uuidv4()
        const qrCode = uuidv4()

        // INSERT consumibles_ventas with clave_corta uniqueness retry loop
        let claveCorta = ''
        let ventaInsertada = false
        for (let intento = 0; intento < 10; intento++) {
          const candidata = generateSecureShortCode()
          try {
            await tx.$executeRaw`
              INSERT INTO consumibles_ventas
              (id, barra_id, evento_id, empresa_id, usuario_id, qr_code, clave_corta, total, descuento, promocion_id, estado, medio_pago, monto_recibido, vuelto)
              VALUES (
                ${ventaId}, ${barra_id}, ${evento_id}, ${empresaId}, ${user.id},
                ${qrCode}, ${candidata},
                ${roundMoney(total)}, ${roundMoney(descuento)},
                ${promocionIdFinal}, 'pendiente',
                ${medioPago}, ${montoRecibidoFinal}, ${vueltoFinal}
              )`
            claveCorta = candidata
            ventaInsertada = true
            break
          } catch (error) {
            // P2002 = unique constraint violation in Prisma (Postgres duplicate key)
            const isDup =
              typeof error === 'object' &&
              error !== null &&
              'code' in error &&
              (error as { code?: string }).code === 'P2002'
            if (isDup) continue
            throw error
          }
        }

        if (!ventaInsertada) {
          txResult = { ok: false, status: 500, error: 'No se pudo generar código único, intentá de nuevo' }
          return
        }

        // INSERT consumibles_venta_items (one per item — Prisma typed)
        await tx.consumiblesVentaItem.createMany({
          data: stockItems.map((item) => ({
            id: uuidv4(),
            venta_id: ventaId,
            consumible_id: item.consumible_id,
            nombre_snapshot: item.nombre,
            precio_unitario: new Prisma.Decimal(roundMoney(item.precio)),
            cantidad: item.cantidad,
            subtotal: new Prisma.Decimal(roundMoney(item.subtotal)),
          })),
        })

        txResult = {
          ok: true,
          ventaId,
          qrCode,
          claveCorta,
          total: roundMoney(total),
          medioPago,
          montoRecibido: montoRecibidoFinal,
          vuelto: vueltoFinal,
        }
      }, {
        isolationLevel: 'Serializable',
        maxWait: 5000,
        timeout: 15000,
      })
    )
  } catch {
    logServerError('vender post')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }

  if (!txResult) {
    logServerError('vender post')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }

  if (!(txResult as TxResult).ok) {
    const r = txResult as { ok: false; status: number; error: string }
    return res.status(r.status).json({ error: r.error })
  }

  const r = txResult as {
    ok: true
    ventaId: string
    qrCode: string
    claveCorta: string
    total: number
    medioPago: MedioPagoConsumible | null
    montoRecibido: number | null
    vuelto: number | null
  }

  if (user.userType === 'empleado') {
    await logEmpleadoActividad({
      empresaId,
      empleadoId: user.id,
      tipo: 'venta_consumibles',
      descripcion: `Venta de ${items.length} producto(s) en barra`,
      metadata: { barra_id, evento_id, items_count: items.length },
    })
  }

  // --- Envío del comprobante por email (post-commit, fuera de la tx). Nunca bloquea. ---
  let emailEnvio: EmailEnvioResult = { estado: 'no_solicitado', email: null }
  if (enviarEmail) {
    if (!EMAIL_REGEX.test(compradorEmail)) {
      // Se pidió pero el email falta o es inválido → la venta queda igual, envío omitido.
      emailEnvio = { estado: 'omitido', email: null }
    } else {
      emailEnvio = await dispatchPosConsumibleEmail({
        empresaId,
        email: compradorEmail,
        ventaId: r.ventaId,
        qrCode: r.qrCode,
        claveCorta: r.claveCorta,
        total: r.total,
        barraNombre: barra.nombre,
      })
    }
  }

  return res.json({
    ok: true,
    id: r.ventaId,
    qr_code: r.qrCode,
    clave_corta: r.claveCorta,
    total: r.total,
    medio_pago: r.medioPago,
    monto_recibido: r.montoRecibido,
    vuelto: r.vuelto,
    email_envio: emailEnvio,
  })
})

export default router
