import { randomUUID } from 'node:crypto'
import { Router, Request, Response } from 'express'
import { requireAuth, verifyInternal } from '../middleware/auth'
import { prisma } from '../lib/prisma'
import { getActorEmpresaId, requirePermissionMiddleware } from '../lib/authz'
import { logServerError } from '../lib/safe-log'

// Fase A de sitio-venta-editor-plantillas-bloques: plantillas guardables por
// empresa. `snapshot` es JSON opaco con el mismo shape que SitioVentaForm del
// frontend — el backend deliberadamente NO valida su estructura interna (cambia
// con el tiempo del lado del frontend), solo que sea un objeto JSON válido.

const router = Router()

const MAX_NOMBRE_LENGTH = 60
// Tope defensivo contra abuso/storage runaway — no es un límite de producto.
const MAX_TEMPLATES_POR_EMPRESA = 50

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

router.get('/', verifyInternal, requireAuth, requirePermissionMiddleware('ver_configuracion'), async (req: Request, res: Response) => {
  try {
    const empresaId = getActorEmpresaId(req.user!)
    if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })

    const templates = await prisma.empresaSitioTemplate.findMany({
      where: { empresa_id: empresaId },
      select: { id: true, nombre: true, snapshot: true, created_at: true, updated_at: true },
      orderBy: { created_at: 'desc' },
    })

    return res.json({ data: templates })
  } catch (error) {
    logServerError('sitio-venta-templates get', error)
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

router.post('/', verifyInternal, requireAuth, requirePermissionMiddleware('editar_configuracion'), async (req: Request, res: Response) => {
  try {
    const empresaId = getActorEmpresaId(req.user!)
    if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })

    const body = req.body as Record<string, unknown>

    const nombre = typeof body.nombre === 'string' ? body.nombre.trim() : ''
    if (!nombre) {
      return res.status(400).json({ error: 'El nombre de la plantilla es obligatorio' })
    }
    if (nombre.length > MAX_NOMBRE_LENGTH) {
      return res.status(400).json({ error: `El nombre de la plantilla no puede superar los ${MAX_NOMBRE_LENGTH} caracteres` })
    }

    if (!isPlainObject(body.snapshot)) {
      return res.status(400).json({ error: 'snapshot debe ser un objeto JSON válido' })
    }

    const existingCount = await prisma.empresaSitioTemplate.count({ where: { empresa_id: empresaId } })
    if (existingCount >= MAX_TEMPLATES_POR_EMPRESA) {
      return res.status(409).json({ error: `Alcanzaste el máximo de ${MAX_TEMPLATES_POR_EMPRESA} plantillas guardadas. Borrá alguna para poder guardar una nueva.` })
    }

    const template = await prisma.empresaSitioTemplate.create({
      data: {
        id: randomUUID(),
        empresa_id: empresaId,
        nombre,
        snapshot: body.snapshot as Record<string, unknown> & object,
      },
      select: { id: true, nombre: true, snapshot: true, created_at: true, updated_at: true },
    })

    return res.status(201).json({ data: template })
  } catch (error) {
    logServerError('sitio-venta-templates post', error)
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

router.delete('/:id', verifyInternal, requireAuth, requirePermissionMiddleware('editar_configuracion'), async (req: Request, res: Response) => {
  try {
    const empresaId = getActorEmpresaId(req.user!)
    if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })

    const { id } = req.params
    if (!id || typeof id !== 'string') {
      return res.status(400).json({ error: 'id de plantilla inválido' })
    }

    // Scoping por empresa_id en el WHERE del delete (no solo por id) — evita que
    // una empresa borre la plantilla de otra empresa por IDOR. deleteMany en vez
    // de delete porque delete-by-id-only lanzaría P2025 sin distinguir "no existe"
    // de "existe pero es de otra empresa", y acá no queremos filtrar esa info.
    const deleted = await prisma.empresaSitioTemplate.deleteMany({
      where: { id, empresa_id: empresaId },
    })

    if (deleted.count === 0) {
      return res.status(404).json({ error: 'Plantilla no encontrada' })
    }

    return res.json({ ok: true })
  } catch (error) {
    logServerError('sitio-venta-templates delete', error)
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

export default router
