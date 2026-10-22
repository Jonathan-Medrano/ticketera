import { Router, type Request, type Response } from 'express'
import { logServerError } from '../lib/safe-log'
import { safeMsg } from '../lib/http-error'
import { actorFromRequest, logAuditEvent } from '../lib/audit-log'
import { getActorEmpresaId, requirePermission } from '../lib/authz'
import { prisma } from '../lib/prisma'
import {
  crearVentaPresencial,
  listEventosDisponiblesParaPOS,
  MEDIOS_PAGO_PRESENCIAL,
  type CrearVentaPresencialResult,
  type MedioPagoPresencial,
} from '../lib/pos'
import {
  dispatchBuyerPurchaseDelivery,
  type CheckoutSessionRow,
  type DeliveryEntryReceipt,
} from './tenant'

const router = Router()

// Mismo patrón de validación de email usado en el resto del backend
// (routes/marketing.ts, routes/sitio-venta.ts).
const EMAIL_REGEX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

// El dispatch de email va DESPUÉS del commit de la venta y nunca debe bloquear la
// respuesta. Esperamos el resultado para dar feedback real, pero si Resend se cuelga
// no tumbamos el request: cortamos con este timeout y reportamos "fallido".
const EMAIL_DISPATCH_TIMEOUT_MS = 12_000

type EmailEnvioEstado = 'enviado' | 'fallido' | 'omitido' | 'no_solicitado'
type EmailEnvioResult = { estado: EmailEnvioEstado; email: string | null }

function empresaIdFromReq(req: Request): string | null {
  if (!req.user) return null
  return getActorEmpresaId(req.user) ?? null
}

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

// Despacha la entrada por email reusando TODA la infra del flujo online
// (dispatchBuyerPurchaseDelivery en tenant.ts): mismos templates + Resend.
// Construye una checkout_session_id SINTÉTICA "pos:<entrada_principal>" — columna
// plana en delivery_dispatch_attempts (NO FK), así no rompe integridad ni requiere
// migración. Nunca lanza: cualquier fallo se reporta como estado, jamás revierte la venta.
async function dispatchPosEntradaEmail(params: {
  empresaId: string
  email: string
  compradorNombre: string | null
  venta: CrearVentaPresencialResult
}): Promise<EmailEnvioResult> {
  const { empresaId, email, compradorNombre, venta } = params
  const entradaPrincipalId = venta.entradas[0]?.id
  if (!entradaPrincipalId) return { estado: 'fallido', email }

  try {
    // El dispatcher necesita el slug del tenant para armar action URLs / email.
    const empresa = await prisma.empresa.findFirst({
      where: { id: empresaId },
      select: { slug: true },
    })
    const slug = empresa?.slug ?? ''
    if (!slug) return { estado: 'fallido', email }

    const checkoutSessionId = `pos:${entradaPrincipalId}`

    // Idempotencia: si ya despachamos email OK para esta venta, no reenviar
    // (protege doble click / retry del cajero sobre la MISMA venta).
    const already = await prisma.deliveryDispatchAttempt.findFirst({
      where: { checkout_session_id: checkoutSessionId, channel: 'email', status: 'sent' },
      select: { id: true },
    })
    if (already) return { estado: 'omitido', email }

    const session: CheckoutSessionRow = {
      id: checkoutSessionId,
      comprador_id: venta.comprador_id,
      empresa_id: empresaId,
      datos: [],
      email,
      comprador_nombre: compradorNombre ?? undefined,
      phone_e164: null,
      phone_verified_at: null,
      delivery_preference: 'email',
    }

    const entradas: DeliveryEntryReceipt[] = venta.entradas.map((e) => ({
      qrCode: e.qr_code,
      claveCorta: e.clave_corta,
      categoria: venta.categoria_nombre,
      evento: venta.evento_nombre,
    }))

    const dispatchResult = await withTimeout(
      dispatchBuyerPurchaseDelivery({ slug, flow: 'entradas', session, entradas, ventas: [] }),
      EMAIL_DISPATCH_TIMEOUT_MS,
    )

    const ok = dispatchResult.attempts.some((a) => a.channel === 'email' && a.status === 'sent')
    return { estado: ok ? 'enviado' : 'fallido', email }
  } catch (err) {
    // No exponemos detalles internos de Resend al front; solo logueamos server-side.
    logServerError('pos venta email dispatch', err)
    return { estado: 'fallido', email }
  }
}

// GET /api/dashboard/pos/eventos — lista eventos+categorias+stock para el selector
router.get('/eventos', async (req: Request, res: Response) => {
  try {
    const empresaId = empresaIdFromReq(req)
    if (!empresaId) return res.status(403).json({ error: 'Sin contexto de empresa' })
    if (!requirePermission(req.user!, 'ver_entradas', res)) return
    const data = await listEventosDisponiblesParaPOS(empresaId)
    return res.json({ data })
  } catch (err) {
    logServerError('pos eventos', err)
    return res.status(500).json({ error: 'Error listando eventos' })
  }
})

// POST /api/dashboard/pos/venta — registra una venta presencial
router.post('/venta', async (req: Request, res: Response) => {
  try {
    const empresaId = empresaIdFromReq(req)
    if (!empresaId) return res.status(403).json({ error: 'Sin contexto de empresa' })
    if (!requirePermission(req.user!, 'ver_entradas', res)) return

    const body = (req.body ?? {}) as Record<string, unknown>
    const eventoId = typeof body.evento_id === 'string' ? body.evento_id : null
    const categoriaId = typeof body.categoria_id === 'string' ? body.categoria_id : null
    const fechaId = typeof body.fecha_id === 'string' ? body.fecha_id : null
    const cantidad = Number(body.cantidad)
    const medioPagoRaw = typeof body.medio_pago === 'string' ? body.medio_pago : ''
    const precioCobrado =
      body.precio_cobrado === null || body.precio_cobrado === undefined ? null : Number(body.precio_cobrado)

    if (!eventoId || !categoriaId) {
      return res.status(400).json({ error: 'evento_id y categoria_id son obligatorios' })
    }
    if (!Number.isFinite(cantidad) || cantidad < 1) {
      return res.status(400).json({ error: 'cantidad inválida' })
    }
    if (precioCobrado !== null && (!Number.isFinite(precioCobrado) || precioCobrado < 1)) {
      return res.status(400).json({ error: 'precio_cobrado debe ser mayor a $0' })
    }
    if (!(MEDIOS_PAGO_PRESENCIAL as readonly string[]).includes(medioPagoRaw)) {
      return res.status(400).json({ error: `medio_pago inválido. Valores: ${MEDIOS_PAGO_PRESENCIAL.join(', ')}` })
    }

    const userId = req.user?.id ?? ''
    if (!userId) return res.status(403).json({ error: 'Usuario no identificado' })

    // Entrega por email (opcional). La venta NUNCA se bloquea por el email.
    const enviarEmail = body.enviar_email === true
    const compradorNombre = typeof body.comprador_nombre === 'string' ? body.comprador_nombre : null
    const compradorEmail = typeof body.comprador_email === 'string' ? body.comprador_email.trim().toLowerCase() : ''
    const compradorEmailValido = EMAIL_REGEX.test(compradorEmail)

    const result = await crearVentaPresencial({
      empresaId,
      eventoId,
      categoriaId,
      fechaId,
      cantidad: Math.floor(cantidad),
      medioPago: medioPagoRaw as MedioPagoPresencial,
      precioCobrado,
      vendidoByUserId: userId,
      compradorNombre,
      compradorApellido: typeof body.comprador_apellido === 'string' ? body.comprador_apellido : null,
      compradorEmail: typeof body.comprador_email === 'string' ? body.comprador_email : null,
      compradorDni: typeof body.comprador_dni === 'string' ? body.comprador_dni : null,
      compradorTelefono: typeof body.comprador_telefono === 'string' ? body.comprador_telefono : null,
    })

    // --- Envío de entrada por email (post-commit, fuera de la tx serializable) ---
    let emailEnvio: EmailEnvioResult = { estado: 'no_solicitado', email: null }
    if (enviarEmail) {
      if (!compradorEmailValido) {
        // Se pidió pero el email falta o es inválido → la venta queda igual, envío omitido.
        emailEnvio = { estado: 'omitido', email: null }
      } else {
        emailEnvio = await dispatchPosEntradaEmail({
          empresaId,
          email: compradorEmail,
          compradorNombre,
          venta: result,
        })
      }
    }

    void logAuditEvent({
      actor: actorFromRequest(req),
      action: 'pos.venta.creada',
      entityType: 'venta_pos',
      entityId: result.entradas[0]?.id ?? '',
      entityLabel: `${result.cantidad}x ${result.medio_pago} · $${result.precio_total}`,
      payload: {
        evento_id: result.evento_id,
        categoria_id: result.categoria_id,
        cantidad: result.cantidad,
        precio_unitario: result.precio_unitario,
        precio_total: result.precio_total,
        medio_pago: result.medio_pago,
        email_envio: emailEnvio.estado,
      },
      ipAddress: req.requestMeta?.ip ?? null,
    })

    return res.status(201).json({ data: { ...result, email_envio: emailEnvio } })
  } catch (err) {
    logServerError('pos venta', err)
    return res.status(400).json({ error: safeMsg(err, 'Error registrando venta') })
  }
})

export default router
