import { Router, Request, Response } from 'express'
import { verifyInternal, requireAuth } from '../middleware/auth'
import { prisma } from '../lib/prisma'
import { randomUUID as uuidv4 } from 'node:crypto'
import { getActorEmpresaId, requirePermissionMiddleware, requireAnyPermission } from '../lib/authz'
import { logServerError } from '../lib/safe-log'

const router = Router()

const TIPOS_VALIDOS = ['porcentaje', 'monto_fijo', 'precio_especial'] as const
const HARD_LIMIT = 500
const DEFAULT_PAGE_SIZE = 25
const MAX_PROMO_VALUE = 1_000_000
const MAX_PROMO_MIN_QTY = 1000

function parsePromotionValue(value: unknown, fieldName: string) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${fieldName} debe ser mayor a 0`)
  }
  if (parsed > MAX_PROMO_VALUE) {
    throw new Error(`${fieldName} supera el máximo permitido`)
  }
  return Math.round((parsed + Number.EPSILON) * 100) / 100
}

function parsePromotionMinQuantity(value: unknown) {
  const parsed = value === undefined || value === null || value === '' ? 1 : Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error('cantidad_minima debe ser un entero mayor a 0')
  }
  if (parsed > MAX_PROMO_MIN_QTY) {
    throw new Error('cantidad_minima supera el máximo permitido')
  }
  return parsed
}

// GET /consumibles/promociones — lista
router.get('/', verifyInternal, requireAuth, requirePermissionMiddleware('ver_consumibles'), async (req: Request, res: Response) => {
  const user = req.user!
  const empresaId = getActorEmpresaId(user)
  if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })

  const eventoId = req.query.evento_id as string | undefined
  const activa = req.query.activa as string | undefined
  const busqueda = typeof req.query.busqueda === 'string' ? req.query.busqueda.trim() : ''
  const page = Math.max(1, Number(req.query.page) || 1)
  const requestedPageSize = Number(req.query.pageSize) || DEFAULT_PAGE_SIZE
  const pageSize = Math.min(HARD_LIMIT, Math.max(1, requestedPageSize))
  const sortBy = typeof req.query.sortBy === 'string' ? req.query.sortBy.trim() : 'alta'
  const sortDir = req.query.sortDir === 'asc' ? 'asc' : 'desc'

  const sortMap: Record<string, string> = {
    nombre: `nombre ${sortDir}`,
    tipo: `tipo ${sortDir}`,
    valor: `valor ${sortDir}`,
    estado: `activa ${sortDir}`,
    vigencia: `COALESCE(fecha_inicio, created_at) ${sortDir}, COALESCE(fecha_fin, created_at) ${sortDir}`,
    alta: `created_at ${sortDir}`,
  }

  const orderClause = sortMap[sortBy] ?? `created_at ${sortDir}`

  const pgCondiciones: string[] = ['empresa_id = $1']
  const pgValores: unknown[] = [empresaId]
  let pgIdx = 2

  if (eventoId) {
    pgCondiciones.push(`evento_id = $${pgIdx}`)
    pgValores.push(eventoId)
    pgIdx++
  }
  if (activa === '1' || activa === '0') {
    pgCondiciones.push(`activa = $${pgIdx}`)
    pgValores.push(activa === '1')
    pgIdx++
  }

  if (busqueda) {
    pgCondiciones.push(`(nombre ILIKE $${pgIdx} OR descripcion ILIKE $${pgIdx})`)
    pgValores.push(`%${busqueda}%`)
    pgIdx++
  }

  try {
    const pgWhereClause = pgCondiciones.join(' AND ')

    const countRows = await prisma.$queryRawUnsafe<{ total: bigint }[]>(
      `SELECT COUNT(*) as total
       FROM consumibles_promociones
       WHERE ${pgWhereClause}`,
      ...pgValores
    )

    const total = Number(countRows[0]?.total ?? 0n)
    const totalPages = Math.max(1, Math.ceil(total / pageSize))
    const currentPage = Math.min(page, totalPages)
    const offset = (currentPage - 1) * pageSize

    const pgLimitIdx = pgIdx
    const pgOffsetIdx = pgIdx + 1
    const promociones = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT *
       FROM consumibles_promociones
       WHERE ${pgWhereClause}
       ORDER BY ${orderClause}
       LIMIT $${pgLimitIdx} OFFSET $${pgOffsetIdx}`,
      ...pgValores, pageSize, offset
    )

    return res.json({
      data: { promociones },
      pagination: {
        page: currentPage,
        pageSize,
        total,
        totalPages,
      },
    })
  } catch {
    logServerError('promociones list')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// POST /consumibles/promociones — crear (con validación consumible_ids)
router.post('/', verifyInternal, requireAuth, async (req: Request, res: Response) => {
  const user = req.user!
  const empresaId = getActorEmpresaId(user)
  if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })
  if (!requireAnyPermission(user, ['gestionar_consumibles', 'gestionar_promociones'], res)) return

  try {
    const {
      nombre,
      descripcion,
      tipo,
      valor,
      consumible_ids,
      cantidad_minima,
      evento_id,
      fecha_inicio,
      fecha_fin,
    } = req.body

    if (!nombre) {
      return res.status(400).json({ error: 'El nombre es obligatorio' })
    }
    if (!tipo || !TIPOS_VALIDOS.includes(tipo)) {
      return res.status(400).json({ error: 'Tipo de promoción no válido' })
    }
    const valorNormalizado = parsePromotionValue(valor, 'El valor')
    const cantidadMinima = parsePromotionMinQuantity(cantidad_minima)
    if (!Array.isArray(consumible_ids) || consumible_ids.length === 0) {
      return res.status(400).json({ error: 'consumible_ids no puede estar vacío' })
    }

    if (evento_id !== undefined && evento_id !== null) {
      const eventoRows = await prisma.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id FROM eventos WHERE id = $1 AND empresa_id = $2`,
        evento_id, empresaId
      )
      if (!eventoRows.length) {
        return res.status(400).json({ error: 'evento_id no pertenece a tu empresa' })
      }
    }

    const idsValidos = consumible_ids.filter(
      (cid: unknown) => typeof cid === 'string' && (cid as string).trim().length > 0
    )
    if (idsValidos.length !== consumible_ids.length) {
      return res.status(400).json({ error: 'consumible_ids contiene valores no válidos' })
    }

    const consumiblesCheck = await prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM consumibles WHERE id = ANY($1::text[]) AND empresa_id = $2 AND activo = true`,
      idsValidos, empresaId
    )
    if (consumiblesCheck.length !== idsValidos.length) {
      return res.status(400).json({
        error: 'Uno o más consumibles no existen o no pertenecen a tu empresa',
      })
    }

    if (fecha_inicio !== undefined && fecha_inicio !== null) {
      if (isNaN(new Date(fecha_inicio).getTime())) {
        return res.status(400).json({ error: 'Fecha inválida' })
      }
    }
    if (fecha_fin !== undefined && fecha_fin !== null) {
      if (isNaN(new Date(fecha_fin).getTime())) {
        return res.status(400).json({ error: 'Fecha inválida' })
      }
    }
    if (
      fecha_inicio !== undefined && fecha_inicio !== null &&
      fecha_fin !== undefined && fecha_fin !== null &&
      new Date(fecha_fin) <= new Date(fecha_inicio)
    ) {
      return res.status(400).json({ error: 'fecha_fin debe ser posterior a fecha_inicio' })
    }

    const id = uuidv4()

    await prisma.$executeRawUnsafe(
      `INSERT INTO consumibles_promociones
         (id, empresa_id, evento_id, nombre, descripcion, tipo, valor, consumible_ids, cantidad_minima, activa, fecha_inicio, fecha_fin)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, $10, $11)`,
      id,
      empresaId,
      evento_id ?? null,
      nombre,
      descripcion ?? null,
      tipo,
      valorNormalizado,
      JSON.stringify(idsValidos),
      cantidadMinima,
      fecha_inicio ?? null,
      fecha_fin ?? null,
    )

    return res.status(201).json({ ok: true, id })
  } catch (error) {
    if (error instanceof Error && (error.message.startsWith('El valor') || error.message.startsWith('cantidad_minima'))) {
      return res.status(400).json({ error: error.message })
    }
    logServerError('promociones create')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// PUT /consumibles/promociones/:id — editar
router.put('/:id', verifyInternal, requireAuth, async (req: Request, res: Response) => {
  const user = req.user!
  const empresaId = getActorEmpresaId(user)
  if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })
  if (!requireAnyPermission(user, ['gestionar_consumibles', 'gestionar_promociones'], res)) return

  const { id } = req.params

  try {
    const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM consumibles_promociones WHERE id = $1 AND empresa_id = $2`,
      id, empresaId
    )

    if (!rows.length) return res.status(404).json({ error: 'No encontrado' })

    const body = req.body
    // Build Postgres positional SET clause ($1, $2, ...)
    const pgSetParts: string[] = []
    const pgSetValores: unknown[] = []
    let pgSetIdx = 1

    if (body.nombre !== undefined) {
      pgSetParts.push(`nombre = $${pgSetIdx++}`)
      pgSetValores.push(body.nombre)
    }
    if (body.descripcion !== undefined) {
      pgSetParts.push(`descripcion = $${pgSetIdx++}`)
      pgSetValores.push(body.descripcion ?? null)
    }
    if (body.tipo !== undefined) {
      if (!TIPOS_VALIDOS.includes(body.tipo)) {
        return res.status(400).json({ error: 'Tipo de promoción no válido' })
      }
      pgSetParts.push(`tipo = $${pgSetIdx++}`)
      pgSetValores.push(body.tipo)
    }
    if (body.valor !== undefined) {
      const valorNormalizado = parsePromotionValue(body.valor, 'El valor')
      pgSetParts.push(`valor = $${pgSetIdx++}`)
      pgSetValores.push(valorNormalizado)
    }
    if (body.consumible_ids !== undefined) {
      if (!Array.isArray(body.consumible_ids) || body.consumible_ids.length === 0) {
        return res.status(400).json({ error: 'consumible_ids debe ser un array no vacío' })
      }
      const idsValidos = body.consumible_ids.filter(
        (cid: unknown) => typeof cid === 'string' && (cid as string).trim().length > 0
      )
      if (idsValidos.length !== body.consumible_ids.length) {
        return res.status(400).json({ error: 'consumible_ids contiene valores no válidos' })
      }
      const consumiblesCheck2 = await prisma.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id FROM consumibles WHERE id = ANY($1::text[]) AND empresa_id = $2 AND activo = true`,
        idsValidos, empresaId
      )
      if (consumiblesCheck2.length !== idsValidos.length) {
        return res.status(400).json({
          error: 'Uno o más consumibles no existen o no pertenecen a tu empresa',
        })
      }
      pgSetParts.push(`consumible_ids = $${pgSetIdx++}`)
      pgSetValores.push(JSON.stringify(idsValidos))
    }
    if (body.cantidad_minima !== undefined) {
      const cantidadMinima = parsePromotionMinQuantity(body.cantidad_minima)
      pgSetParts.push(`cantidad_minima = $${pgSetIdx++}`)
      pgSetValores.push(cantidadMinima)
    }
    if (body.activa !== undefined) {
      pgSetParts.push(`activa = $${pgSetIdx++}`)
      pgSetValores.push(Boolean(body.activa))
    }
    if (body.fecha_inicio !== undefined) {
      if (body.fecha_inicio !== null && isNaN(new Date(body.fecha_inicio).getTime())) {
        return res.status(400).json({ error: 'Fecha inválida' })
      }
      pgSetParts.push(`fecha_inicio = $${pgSetIdx++}`)
      pgSetValores.push(body.fecha_inicio ?? null)
    }
    if (body.fecha_fin !== undefined) {
      if (body.fecha_fin !== null && isNaN(new Date(body.fecha_fin).getTime())) {
        return res.status(400).json({ error: 'Fecha inválida' })
      }
      pgSetParts.push(`fecha_fin = $${pgSetIdx++}`)
      pgSetValores.push(body.fecha_fin ?? null)
    }
    if (
      body.fecha_inicio !== undefined && body.fecha_inicio !== null &&
      body.fecha_fin !== undefined && body.fecha_fin !== null &&
      new Date(body.fecha_fin) <= new Date(body.fecha_inicio)
    ) {
      return res.status(400).json({ error: 'fecha_fin debe ser posterior a fecha_inicio' })
    }
    if (body.evento_id !== undefined) {
      if (body.evento_id !== null) {
        const eventoRows2 = await prisma.$queryRawUnsafe<{ id: string }[]>(
          `SELECT id FROM eventos WHERE id = $1 AND empresa_id = $2`,
          body.evento_id, empresaId
        )
        if (!eventoRows2.length) {
          return res.status(400).json({ error: 'evento_id no pertenece a tu empresa' })
        }
      }
      pgSetParts.push(`evento_id = $${pgSetIdx++}`)
      pgSetValores.push(body.evento_id ?? null)
    }

    if (!pgSetParts.length) {
      return res.status(400).json({ error: 'No se enviaron campos para actualizar' })
    }

    await prisma.$executeRawUnsafe(
      `UPDATE consumibles_promociones SET ${pgSetParts.join(', ')} WHERE id = $${pgSetIdx} AND empresa_id = $${pgSetIdx + 1}`,
      ...pgSetValores, id, empresaId
    )

    return res.json({ ok: true })
  } catch (error) {
    if (error instanceof Error && (error.message.startsWith('El valor') || error.message.startsWith('cantidad_minima'))) {
      return res.status(400).json({ error: error.message })
    }
    logServerError('promociones update')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// DELETE /consumibles/promociones/:id — eliminar
router.delete('/:id', verifyInternal, requireAuth, async (req: Request, res: Response) => {
  const user = req.user!
  const empresaId = getActorEmpresaId(user)

  if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })
  if (!requireAnyPermission(user, ['gestionar_consumibles', 'gestionar_promociones'], res)) return

  const { id } = req.params

  try {
    const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM consumibles_promociones WHERE id = $1 AND empresa_id = $2`,
      id, empresaId
    )

    if (!rows.length) return res.status(404).json({ error: 'No encontrado' })

    await prisma.$executeRawUnsafe(
      `DELETE FROM consumibles_promociones WHERE id = $1 AND empresa_id = $2`,
      id, empresaId
    )

    return res.json({ ok: true })
  } catch {
    logServerError('promociones delete')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

export default router
