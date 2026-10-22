import { Router, type Request, type Response } from 'express'
import { logServerError } from '../lib/safe-log'
import { safeMsg } from '../lib/http-error'
import { actorFromRequest, logAuditEvent } from '../lib/audit-log'
import { getActorEmpresaId } from '../lib/authz'
import { prisma } from '../lib/prisma'
import {
  demoCreateCompra,
  demoCreateConsumibleVenta,
  demoCreateRefundCase,
  demoCreateReconciliacionCase,
} from '../lib/demo-data'

const router = Router()

function empresaIdFromReq(req: Request): string | null {
  if (!req.user) return null
  return getActorEmpresaId(req.user) ?? null
}

// Guard middleware-style helper — verifica que la empresa tenga es_prueba=true
async function ensureEmpresaEsPrueba(empresaId: string) {
  const empresa = await prisma.empresa.findUnique({
    where: { id: empresaId },
    select: { es_prueba: true, activa: true, nombre: true },
  })
  if (!empresa || !empresa.activa) throw new Error('Empresa no encontrada o inactiva')
  if (!empresa.es_prueba) {
    throw new Error('Solo disponible para cuentas de prueba (empresa.es_prueba=true)')
  }
  return empresa
}

// GET /api/dashboard/demo-data/status — chequea si el feature está disponible
router.get('/status', async (req: Request, res: Response) => {
  try {
    const empresaId = empresaIdFromReq(req)
    if (!empresaId) return res.status(403).json({ error: 'Sin contexto de empresa' })
    const empresa = await prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { es_prueba: true, nombre: true },
    })
    return res.json({
      data: {
        habilitado: empresa?.es_prueba === true,
        empresa_nombre: empresa?.nombre ?? null,
      },
    })
  } catch (err) {
    logServerError('demo-data status', err)
    return res.status(500).json({ error: 'Error consultando status' })
  }
})

router.post('/compra', async (req: Request, res: Response) => {
  try {
    const empresaId = empresaIdFromReq(req)
    if (!empresaId) return res.status(403).json({ error: 'Sin contexto de empresa' })
    await ensureEmpresaEsPrueba(empresaId)

    const result = await demoCreateCompra({ empresaId })

    void logAuditEvent({
      actor: actorFromRequest(req),
      action: 'demo.compra.generada',
      entityType: 'demo_data',
      entityId: result.checkout_session_id,
      entityLabel: `${result.cantidad}x ${result.categoria.nombre} · ${result.comprador.nombre}`,
      payload: { evento_id: result.evento.id, total: result.total, comprador_email: result.comprador.email },
      ipAddress: req.requestMeta?.ip ?? null,
    })

    return res.status(201).json({ data: result })
  } catch (err) {
    logServerError('demo compra', err)
    return res.status(400).json({ error: safeMsg(err, 'Error generando compra demo') })
  }
})

router.post('/consumible', async (req: Request, res: Response) => {
  try {
    const empresaId = empresaIdFromReq(req)
    if (!empresaId) return res.status(403).json({ error: 'Sin contexto de empresa' })
    await ensureEmpresaEsPrueba(empresaId)

    const result = await demoCreateConsumibleVenta({ empresaId })

    void logAuditEvent({
      actor: actorFromRequest(req),
      action: 'demo.consumible.generado',
      entityType: 'demo_data',
      entityId: result.venta_id,
      entityLabel: `${result.items.length} items · ${result.barra.nombre} · $${result.total}`,
      payload: { barra_id: result.barra.id, evento_id: result.evento.id, total: result.total },
      ipAddress: req.requestMeta?.ip ?? null,
    })

    return res.status(201).json({ data: result })
  } catch (err) {
    logServerError('demo consumible', err)
    return res.status(400).json({ error: safeMsg(err, 'Error generando consumible demo') })
  }
})

router.post('/reembolso', async (req: Request, res: Response) => {
  try {
    const empresaId = empresaIdFromReq(req)
    if (!empresaId) return res.status(403).json({ error: 'Sin contexto de empresa' })
    await ensureEmpresaEsPrueba(empresaId)
    const userId = req.user?.id ?? ''
    if (!userId) return res.status(403).json({ error: 'Usuario no identificado' })

    const result = await demoCreateRefundCase({ empresaId, actorUserId: userId })

    void logAuditEvent({
      actor: actorFromRequest(req),
      action: 'demo.reembolso.generado',
      entityType: 'demo_data',
      entityId: result.refund_case_id,
      entityLabel: `Caso refund · $${result.amount}`,
      payload: { checkout_session_id: result.checkout_session_id, amount: result.amount },
      ipAddress: req.requestMeta?.ip ?? null,
    })

    return res.status(201).json({ data: result })
  } catch (err) {
    logServerError('demo reembolso', err)
    return res.status(400).json({ error: safeMsg(err, 'Error generando reembolso demo') })
  }
})

router.post('/reconciliacion', async (req: Request, res: Response) => {
  try {
    const empresaId = empresaIdFromReq(req)
    if (!empresaId) return res.status(403).json({ error: 'Sin contexto de empresa' })
    await ensureEmpresaEsPrueba(empresaId)

    const result = await demoCreateReconciliacionCase({ empresaId })

    void logAuditEvent({
      actor: actorFromRequest(req),
      action: 'demo.reconciliacion.generada',
      entityType: 'demo_data',
      entityId: result.checkout_session_id,
      entityLabel: `Caso reconciliación · $${result.amount}`,
      payload: { payment_id: result.payment_id, amount: result.amount, note: result.reconciliation_note },
      ipAddress: req.requestMeta?.ip ?? null,
    })

    return res.status(201).json({ data: result })
  } catch (err) {
    logServerError('demo reconciliacion', err)
    return res.status(400).json({ error: safeMsg(err, 'Error generando reconciliación demo') })
  }
})

export default router
