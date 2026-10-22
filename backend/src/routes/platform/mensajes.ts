import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import { prisma } from '../../lib/prisma'
import { requireAuth } from '../../middleware/auth'
import { requireSuperAdminMiddleware } from '../../lib/authz'
import { actorFromRequest, logAuditEvent } from '../../lib/audit-log'
import { createPlatformHandler } from './shared'

const router = Router()

router.get(
  '/',
  requireAuth,
  requireSuperAdminMiddleware,
  createPlatformHandler('platform mensajes list', async (req, res) => {
    const activoParam = req.query.activo

    const where: Record<string, unknown> = {}
    if (activoParam === '1') where['activo'] = true
    if (activoParam === '0') where['activo'] = false

    const messages = await prisma.platformMessage.findMany({
      where,
      orderBy: { created_at: 'desc' },
      take: 200,
      select: {
        id: true,
        titulo: true,
        cuerpo: true,
        tipo: true,
        target_type: true,
        target_empresa_id: true,
        activo: true,
        expires_at: true,
        created_by: true,
        created_at: true,
      },
    })

    return res.json({ data: { messages } })
  })
)

router.post(
  '/',
  requireAuth,
  requireSuperAdminMiddleware,
  createPlatformHandler('platform mensajes create', async (req, res) => {
    const body = req.body as Record<string, unknown>
    const titulo = typeof body.titulo === 'string' ? body.titulo.trim() : ''
    const cuerpo = typeof body.cuerpo === 'string' ? body.cuerpo.trim() : ''
    const tipo = body.tipo
    const target_type = body.target_type
    const target_empresa_id = typeof body.target_empresa_id === 'string' ? body.target_empresa_id.trim() || null : null
    const expires_at = typeof body.expires_at === 'string' ? body.expires_at.trim() || null : null

    if (!titulo || !cuerpo) {
      return res.status(400).json({ error: 'titulo y cuerpo son requeridos' })
    }

    if (tipo !== 'info' && tipo !== 'warning' && tipo !== 'critical') {
      return res.status(400).json({ error: 'tipo debe ser info, warning o critical' })
    }

    if (target_type !== 'all' && target_type !== 'empresa') {
      return res.status(400).json({ error: 'target_type debe ser all o empresa' })
    }

    if (target_type === 'empresa' && !target_empresa_id) {
      return res.status(400).json({ error: 'target_empresa_id es requerido cuando target_type es empresa' })
    }

    const id = randomUUID()
    const created_by = req.user!.id

    await prisma.platformMessage.create({
      data: {
        id,
        titulo,
        cuerpo,
        tipo: tipo as never,
        target_type: target_type as never,
        target_empresa_id,
        activo: true,
        expires_at: expires_at ? new Date(expires_at) : null,
        created_by: String(created_by),
      },
    })

    void logAuditEvent({
      actor: actorFromRequest(req),
      action: 'platform.message.created',
      entityType: 'platform_message',
      entityId: id,
      entityLabel: titulo,
      payload: { tipo, target_type, target_empresa_id },
      ipAddress: req.requestMeta?.ip ?? null,
    })

    return res.status(201).json({ data: { id, titulo, cuerpo, tipo, target_type, target_empresa_id, activo: 1, expires_at } })
  })
)

router.patch(
  '/:messageId',
  requireAuth,
  requireSuperAdminMiddleware,
  createPlatformHandler('platform mensajes patch', async (req, res) => {
    const { messageId } = req.params
    const message = await prisma.platformMessage.findUnique({
      where: { id: messageId },
      select: { id: true, titulo: true, activo: true },
    })
    if (!message) {
      return res.status(404).json({ error: 'Mensaje no encontrado' })
    }

    const body = req.body as Record<string, unknown>
    const data: Record<string, unknown> = {}

    if (typeof body.activo === 'boolean') {
      data['activo'] = body.activo
    }

    if (typeof body.titulo === 'string') {
      data['titulo'] = body.titulo.trim()
    }

    if (typeof body.cuerpo === 'string') {
      data['cuerpo'] = body.cuerpo.trim()
    }

    if (typeof body.tipo === 'string' && ['info', 'warning', 'critical'].includes(body.tipo)) {
      data['tipo'] = body.tipo as never
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'No hay campos para actualizar' })
    }

    await prisma.platformMessage.update({
      where: { id: messageId },
      data,
    })

    void logAuditEvent({
      actor: actorFromRequest(req),
      action: 'platform.message.updated',
      entityType: 'platform_message',
      entityId: messageId,
      entityLabel: message.titulo ?? messageId,
      payload: body,
      ipAddress: req.requestMeta?.ip ?? null,
    })

    return res.json({ data: { messageId, updated: true } })
  })
)

router.delete(
  '/:messageId',
  requireAuth,
  requireSuperAdminMiddleware,
  createPlatformHandler('platform mensajes delete', async (req, res) => {
    const { messageId } = req.params
    const message = await prisma.platformMessage.findUnique({
      where: { id: messageId },
      select: { id: true, titulo: true },
    })
    if (!message) {
      return res.status(404).json({ error: 'Mensaje no encontrado' })
    }

    await prisma.platformMessage.delete({ where: { id: messageId } })
    await prisma.platformMessageDismissal.deleteMany({ where: { message_id: messageId } })

    void logAuditEvent({
      actor: actorFromRequest(req),
      action: 'platform.message.deleted',
      entityType: 'platform_message',
      entityId: messageId,
      entityLabel: message.titulo ?? messageId,
      payload: null,
      ipAddress: req.requestMeta?.ip ?? null,
    })

    return res.json({ data: { messageId, deleted: true } })
  })
)

export default router
