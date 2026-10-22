import { Router, type Request, type Response } from 'express'
import rateLimit from 'express-rate-limit'
import { logServerError } from '../lib/safe-log'
import { safeMsg } from '../lib/http-error'
import { actorFromRequest, logAuditEvent } from '../lib/audit-log'
import { getActorEmpresaId } from '../lib/authz'
import { prisma } from '../lib/prisma'
import { createAddon, deleteAddon, listAddonsByEvento, updateAddon, type AddonInput } from '../lib/addons'

const router = Router()

// Anti-abuso: limita creación / actualización / borrado de addons por empresa.
// GET no se limita porque es lectura idempotente y barata.
const writeRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    const empresaId = req.user ? getActorEmpresaId(req.user) ?? null : null
    return empresaId ?? req.ip ?? 'anon'
  },
  message: { error: 'Demasiadas operaciones sobre addons en poco tiempo. Esperá un minuto.' },
})

function empresaIdFromReq(req: Request): string | null {
  if (!req.user) return null
  return getActorEmpresaId(req.user) ?? null
}

async function ensureEventoEnEmpresa(eventoId: string, empresaId: string) {
  const evento = await prisma.evento.findFirst({ where: { id: eventoId, empresa_id: empresaId }, select: { id: true } })
  if (!evento) throw new Error('Evento no encontrado')
}

// GET /api/dashboard/addons?evento_id=X — listar addons de un evento (admin)
router.get('/', async (req: Request, res: Response) => {
  try {
    const empresaId = empresaIdFromReq(req)
    if (!empresaId) return res.status(403).json({ error: 'Sin contexto de empresa' })
    const eventoId = typeof req.query.evento_id === 'string' ? req.query.evento_id : null
    if (!eventoId) return res.status(400).json({ error: 'evento_id es obligatorio' })
    await ensureEventoEnEmpresa(eventoId, empresaId)
    const addons = await listAddonsByEvento(eventoId)
    return res.json({ data: { addons } })
  } catch (err) {
    logServerError('addons list', err)
    return res.status(400).json({ error: safeMsg(err, 'Error listando addons') })
  }
})

router.post('/', writeRateLimit, async (req: Request, res: Response) => {
  try {
    const empresaId = empresaIdFromReq(req)
    if (!empresaId) return res.status(403).json({ error: 'Sin contexto de empresa' })
    const body = (req.body ?? {}) as Record<string, unknown>
    const eventoId = typeof body.evento_id === 'string' ? body.evento_id : null
    if (!eventoId) return res.status(400).json({ error: 'evento_id es obligatorio' })

    const input: AddonInput = {
      nombre: typeof body.nombre === 'string' ? body.nombre : '',
      descripcion: typeof body.descripcion === 'string' ? body.descripcion : null,
      precio: Number(body.precio),
      stock: Number(body.stock),
      max_por_compra: body.max_por_compra !== undefined ? Number(body.max_por_compra) : undefined,
      activo: typeof body.activo === 'boolean' ? body.activo : undefined,
      orden_visual: body.orden_visual !== undefined ? Number(body.orden_visual) : undefined,
    }

    const addon = await createAddon({ empresaId, eventoId, ...input })

    void logAuditEvent({
      actor: actorFromRequest(req),
      action: 'addon.created',
      entityType: 'evento_addon',
      entityId: addon.id,
      entityLabel: `${addon.nombre} · ${addon.precio} · ${addon.stock} stock`,
      payload: { evento_id: eventoId },
      ipAddress: req.requestMeta?.ip ?? null,
    })

    return res.status(201).json({ data: { addon } })
  } catch (err) {
    logServerError('addons create', err)
    return res.status(400).json({ error: safeMsg(err, 'Error creando addon') })
  }
})

router.patch('/:id', writeRateLimit, async (req: Request, res: Response) => {
  try {
    const empresaId = empresaIdFromReq(req)
    if (!empresaId) return res.status(403).json({ error: 'Sin contexto de empresa' })
    const body = (req.body ?? {}) as Record<string, unknown>

    const patch: Partial<AddonInput> = {}
    if (typeof body.nombre === 'string') patch.nombre = body.nombre
    if (body.descripcion !== undefined) patch.descripcion = typeof body.descripcion === 'string' ? body.descripcion : null
    if (body.precio !== undefined) patch.precio = Number(body.precio)
    if (body.stock !== undefined) patch.stock = Number(body.stock)
    if (body.max_por_compra !== undefined) patch.max_por_compra = Number(body.max_por_compra)
    if (typeof body.activo === 'boolean') patch.activo = body.activo
    if (body.orden_visual !== undefined) patch.orden_visual = Number(body.orden_visual)

    const addon = await updateAddon(req.params.id, empresaId, patch)

    void logAuditEvent({
      actor: actorFromRequest(req),
      action: 'addon.updated',
      entityType: 'evento_addon',
      entityId: addon.id,
      entityLabel: addon.nombre,
      payload: { changedFields: Object.keys(patch) },
      ipAddress: req.requestMeta?.ip ?? null,
    })

    return res.json({ data: { addon } })
  } catch (err) {
    logServerError('addons update', err)
    return res.status(400).json({ error: safeMsg(err, 'Error actualizando addon') })
  }
})

router.delete('/:id', writeRateLimit, async (req: Request, res: Response) => {
  try {
    const empresaId = empresaIdFromReq(req)
    if (!empresaId) return res.status(403).json({ error: 'Sin contexto de empresa' })

    const existing = await prisma.eventoAddon.findFirst({
      where: { id: req.params.id, empresa_id: empresaId },
      select: { id: true, nombre: true, evento_id: true },
    })
    if (!existing) return res.status(404).json({ error: 'Addon no encontrado' })

    await deleteAddon(req.params.id, empresaId)

    void logAuditEvent({
      actor: actorFromRequest(req),
      action: 'addon.deleted',
      entityType: 'evento_addon',
      entityId: req.params.id,
      entityLabel: existing.nombre,
      payload: { evento_id: existing.evento_id },
      ipAddress: req.requestMeta?.ip ?? null,
    })

    return res.status(204).send()
  } catch (err) {
    logServerError('addons delete', err)
    return res.status(400).json({ error: safeMsg(err, 'Error eliminando addon') })
  }
})

export default router
