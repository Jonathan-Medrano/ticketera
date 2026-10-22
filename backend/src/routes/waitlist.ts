// Waitlist routes — lista de espera de eventos agotados.
//
// Comprador autenticado (tenant público):
//   POST   /api/tenant/:slug/waitlist          — registrarse
//   GET    /api/tenant/:slug/waitlist/me       — ver mis entradas en lista
//   DELETE /api/tenant/:slug/waitlist/:id      — cancelar
//
// Dashboard empresa (internal):
//   GET    /api/dashboard/waitlist?evento_id=X — listar para un evento

import { Router, type Request, type Response } from 'express'
import { logServerError } from '../lib/safe-log'
import { actorFromRequest, logAuditEvent } from '../lib/audit-log'
import { getActorEmpresaId } from '../lib/authz'
import { safeMsg } from '../lib/http-error'
import { prisma } from '../lib/prisma'
import {
  cancelWaitlist,
  getPositionInCategoria,
  listWaitlistByComprador,
  listWaitlistByEvento,
  registerWaitlist,
} from '../lib/waitlist'

// ============================================================
// Router público (montado bajo /api/tenant/:slug/waitlist)
// ============================================================
export const waitlistPublicRouter = Router({ mergeParams: true })

waitlistPublicRouter.post('/', async (req: Request, res: Response) => {
  try {
    if (!req.user || req.user.userType !== 'comprador' || !req.user.id) {
      return res.status(401).json({ error: 'Necesitás iniciar sesión para anotarte en la lista de espera' })
    }
    const slug = req.params.slug
    const empresa = await prisma.empresa.findFirst({
      where: { slug: slug.toLowerCase(), activa: true, tenant_public_disabled: false, suspendido: false },
      select: { id: true, nombre: true },
    })
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' })
    if (req.user.empresa_slug !== slug) return res.status(403).json({ error: 'Comprador no pertenece a esta empresa' })

    const body = (req.body ?? {}) as Record<string, unknown>
    const eventoId = typeof body.evento_id === 'string' ? body.evento_id : null
    const categoriaId = typeof body.categoria_id === 'string' ? body.categoria_id : null
    const fechaId = typeof body.fecha_id === 'string' ? body.fecha_id : null
    const cantidad = Number(body.cantidad ?? 1)
    if (!eventoId || !categoriaId) return res.status(400).json({ error: 'evento_id y categoria_id son obligatorios' })

    const entry = await registerWaitlist({
      empresaId: empresa.id,
      eventoId,
      categoriaId,
      fechaId,
      compradorId: req.user.id,
      cantidadSolicitada: Math.floor(cantidad),
    })
    const posicion = await getPositionInCategoria(categoriaId, req.user.id)

    return res.status(201).json({ data: { entry, posicion } })
  } catch (err) {
    logServerError('waitlist register', err)
    return res.status(400).json({ error: safeMsg(err, 'Error registrando en lista de espera') })
  }
})

waitlistPublicRouter.get('/me', async (req: Request, res: Response) => {
  try {
    if (!req.user || req.user.userType !== 'comprador' || !req.user.id) {
      return res.status(401).json({ error: 'No autorizado' })
    }
    const slug = req.params.slug
    const empresa = await prisma.empresa.findFirst({
      where: { slug: slug.toLowerCase(), activa: true },
      select: { id: true },
    })
    if (!empresa) return res.json({ data: { entries: [] } })

    const entries = await listWaitlistByComprador(req.user.id, empresa.id)

    // Adjuntar nombre evento + categoría + posición
    const eventoIds = Array.from(new Set(entries.map((e) => e.evento_id)))
    const categoriaIds = Array.from(new Set(entries.map((e) => e.categoria_id)))
    const [eventos, categorias] = await Promise.all([
      prisma.evento.findMany({ where: { id: { in: eventoIds } }, select: { id: true, nombre: true } }),
      prisma.entradaCategoria.findMany({ where: { id: { in: categoriaIds } }, select: { id: true, nombre: true } }),
    ])
    const eventoMap = new Map(eventos.map((e) => [e.id, e.nombre]))
    const categoriaMap = new Map(categorias.map((c) => [c.id, c.nombre]))

    const enriched = await Promise.all(
      entries.map(async (e) => ({
        ...e,
        evento_nombre: eventoMap.get(e.evento_id) ?? '',
        categoria_nombre: categoriaMap.get(e.categoria_id) ?? '',
        posicion: e.estado === 'esperando' ? await getPositionInCategoria(e.categoria_id, req.user!.id) : null,
      })),
    )

    return res.json({ data: { entries: enriched } })
  } catch (err) {
    logServerError('waitlist list mine', err)
    return res.status(500).json({ error: 'Error listando waitlist' })
  }
})

waitlistPublicRouter.delete('/:id', async (req: Request, res: Response) => {
  try {
    if (!req.user || req.user.userType !== 'comprador' || !req.user.id) {
      return res.status(401).json({ error: 'No autorizado' })
    }
    const entry = await cancelWaitlist(req.params.id, req.user.id)
    return res.json({ data: { entry } })
  } catch (err) {
    logServerError('waitlist cancel', err)
    return res.status(400).json({ error: safeMsg(err, 'Error cancelando') })
  }
})

// ============================================================
// Router admin (montado bajo /api/dashboard/waitlist)
// ============================================================
export const waitlistAdminRouter = Router()

waitlistAdminRouter.get('/', async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'No autorizado' })
    const empresaId = getActorEmpresaId(req.user)
    if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })

    const eventoId = typeof req.query.evento_id === 'string' ? req.query.evento_id : null
    if (!eventoId) return res.status(400).json({ error: 'evento_id es obligatorio' })

    const entries = await listWaitlistByEvento(empresaId, eventoId)

    // Stats
    const stats = entries.reduce(
      (acc, e) => {
        acc.total += 1
        acc[e.estado] = (acc[e.estado] ?? 0) + 1
        return acc
      },
      { total: 0 } as Record<string, number>,
    )

    return res.json({ data: { entries, stats } })
  } catch (err) {
    logServerError('waitlist admin list', err)
    return res.status(500).json({ error: 'Error listando waitlist admin' })
  }
})

// Endpoint admin para borrar/limpiar manualmente (uso administrativo)
waitlistAdminRouter.delete('/:id', async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'No autorizado' })
    const empresaId = getActorEmpresaId(req.user)
    if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })

    const entry = await prisma.waitlistEntry.findFirst({ where: { id: req.params.id, empresa_id: empresaId } })
    if (!entry) return res.status(404).json({ error: 'Entry no encontrado' })

    await prisma.waitlistEntry.update({
      where: { id: req.params.id },
      data: { estado: 'cancelado', cancelado_at: new Date() },
    })

    void logAuditEvent({
      actor: actorFromRequest(req),
      action: 'waitlist.cancelled_by_admin',
      entityType: 'waitlist_entry',
      entityId: req.params.id,
      entityLabel: `${entry.categoria_id} · comprador ${entry.comprador_id}`,
      payload: { evento_id: entry.evento_id, estado_previo: entry.estado },
      ipAddress: req.requestMeta?.ip ?? null,
    })

    return res.status(204).send()
  } catch (err) {
    logServerError('waitlist admin cancel', err)
    return res.status(400).json({ error: safeMsg(err, 'Error cancelando') })
  }
})
