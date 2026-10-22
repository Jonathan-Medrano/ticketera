import { Router, Request, Response } from 'express'
import { verifyInternal, requireAuth } from '../middleware/auth'
import { randomUUID as uuidv4 } from 'node:crypto'
import { getActorEmpresaId, requirePermission, requireAnyPermission } from '../lib/authz'
import { logServerError } from '../lib/safe-log'
import { buildConsumiblesCatalogoWorkbookBuffer, CATALOGO_EXPORT_CONTENT_TYPE } from '../lib/consumibles-catalogo-workbook'
import { safeCsvCell } from '../lib/csv-escape'
import { prisma } from '../lib/prisma'
import { Prisma } from '@prisma/client'

const router = Router()
const HARD_LIMIT = 500
const DEFAULT_PAGE_SIZE = 25
const CONSUMIBLE_DELETE_BLOCKED_ERROR = 'No se puede eliminar el consumible porque tiene referencias activas o históricas. Desactivalo en su lugar.'
const MAX_CONSUMIBLE_PRICE = 1_000_000
const MAX_CONSUMIBLE_STOCK = 100000
const CONSUMIBLE_TIPO_VALUES = ['bebida_alcoholica', 'bebida_sin_alcohol', 'comida', 'otro'] as const
type ConsumibleTipo = typeof CONSUMIBLE_TIPO_VALUES[number]

function isConsumibleTipoValido(value: unknown): value is ConsumibleTipo {
  return typeof value === 'string' && (CONSUMIBLE_TIPO_VALUES as readonly string[]).includes(value)
}

function parsePositiveMoney(value: unknown, fieldName: string, max: number) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${fieldName} debe ser mayor a 0`)
  }
  if (parsed > max) {
    throw new Error(`${fieldName} supera el máximo permitido`)
  }
  return Math.round((parsed + Number.EPSILON) * 100) / 100
}

function parseNonNegativeInteger(value: unknown, fieldName: string, max: number) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${fieldName} debe ser un entero mayor o igual a 0`)
  }
  if (parsed > max) {
    throw new Error(`${fieldName} supera el máximo permitido`)
  }
  return parsed
}

function parseOptionalMoney(value: unknown, fieldName: string, max: number) {
  if (value === undefined || value === null || value === '') return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${fieldName} debe ser mayor o igual a 0`)
  }
  if (parsed > max) {
    throw new Error(`${fieldName} supera el máximo permitido`)
  }
  return Math.round((parsed + Number.EPSILON) * 100) / 100
}

// GET /consumibles — lista activos
router.get('/', verifyInternal, requireAuth, async (req: Request, res: Response) => {
  const user = req.user!
  const empresaId = getActorEmpresaId(user)
  const incluirInactivos = req.query.incluir_inactivos === '1' || req.query.incluir_inactivos === 'true'
  const page = Math.max(1, Number(req.query.page) || 1)
  const requestedPageSize = Number(req.query.pageSize) || DEFAULT_PAGE_SIZE
  const pageSize = Math.min(HARD_LIMIT, Math.max(1, requestedPageSize))
  const busqueda = typeof req.query.busqueda === 'string' ? req.query.busqueda.trim() : ''
  const estado = typeof req.query.estado === 'string' ? req.query.estado.trim() : ''
  const sortBy = typeof req.query.sortBy === 'string' ? req.query.sortBy.trim() : 'nombre'
  const sortDir = req.query.sortDir === 'desc' ? 'desc' : 'asc'

  if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })
  if (!requirePermission(user, 'ver_consumibles', res)) return

  try {
    // --- Fulltext search branch (busqueda >= 3 chars): ILIKE + pg_trgm similarity via Prisma ---
    if (busqueda && busqueda.length >= 3) {
      const ilike = `%${busqueda}%`
      const activoFilter = estado === 'activos' ? true
        : estado === 'inactivos' ? false
        : incluirInactivos ? null
        : true

      type ConsumibleRow = {
        id: string
        nombre: string
        descripcion: string | null
        categoria: string | null
        tipo: string
        precio: number
        imagen_url: string | null
        activo: boolean
        archived_at: Date | null
      }

      let countResult: Array<{ total: bigint }>
      let rows: ConsumibleRow[]

      if (activoFilter === null) {
        // no activo filter
        countResult = await prisma.$queryRaw<Array<{ total: bigint }>>`
          SELECT COUNT(*)::bigint AS total
          FROM consumibles
          WHERE empresa_id = ${empresaId}
            AND (nombre ILIKE ${ilike} OR descripcion ILIKE ${ilike})`
        const offset = (Math.min(page, Math.max(1, Math.ceil(Number(countResult[0]?.total ?? 0) / pageSize))) - 1) * pageSize
        rows = await prisma.$queryRaw<ConsumibleRow[]>`
          SELECT id, nombre, descripcion, categoria, tipo, precio, imagen_url, activo, archived_at
          FROM consumibles
          WHERE empresa_id = ${empresaId}
            AND (nombre ILIKE ${ilike} OR descripcion ILIKE ${ilike})
          ORDER BY similarity(nombre, ${busqueda}) DESC, created_at DESC
          LIMIT ${pageSize} OFFSET ${offset}`
      } else {
        const activoBool = activoFilter
        countResult = await prisma.$queryRaw<Array<{ total: bigint }>>`
          SELECT COUNT(*)::bigint AS total
          FROM consumibles
          WHERE empresa_id = ${empresaId}
            AND activo = ${activoBool}
            AND (nombre ILIKE ${ilike} OR descripcion ILIKE ${ilike})`
        const total = Number(countResult[0]?.total ?? 0)
        const totalPages = Math.max(1, Math.ceil(total / pageSize))
        const currentPage = Math.min(page, totalPages)
        const offset = (currentPage - 1) * pageSize
        rows = await prisma.$queryRaw<ConsumibleRow[]>`
          SELECT id, nombre, descripcion, categoria, tipo, precio, imagen_url, activo, archived_at
          FROM consumibles
          WHERE empresa_id = ${empresaId}
            AND activo = ${activoBool}
            AND (nombre ILIKE ${ilike} OR descripcion ILIKE ${ilike})
          ORDER BY similarity(nombre, ${busqueda}) DESC, created_at DESC
          LIMIT ${pageSize} OFFSET ${offset}`
        return res.json({
          data: rows,
          pagination: { page: currentPage, pageSize, total, totalPages },
        })
      }

      const total = Number(countResult[0]?.total ?? 0)
      const totalPages = Math.max(1, Math.ceil(total / pageSize))
      const currentPage = Math.min(page, totalPages)
      return res.json({
        data: rows,
        pagination: { page: currentPage, pageSize, total, totalPages },
      })
    }

    // --- Standard branch (no busqueda or busqueda < 3): Prisma where + $queryRaw for dynamic sort ---
    // Build Prisma where conditions
    const where: Record<string, unknown> = { empresa_id: empresaId }

    if (!incluirInactivos && estado !== 'activos' && estado !== 'inactivos') {
      where.activo = true
    }
    if (estado === 'activos') {
      where.activo = true
    } else if (estado === 'inactivos') {
      where.activo = false
    }

    if (busqueda) {
      // busqueda.length < 3 — simple ILIKE, no pg_trgm needed
      where.OR = [
        { nombre: { contains: busqueda, mode: 'insensitive' } },
        { descripcion: { contains: busqueda, mode: 'insensitive' } },
      ]
    }

    const sortMap: Record<string, Record<string, unknown>> = {
      nombre: { nombre: sortDir },
      precio: { precio: sortDir },
      estado: { activo: sortDir },
      alta: { created_at: sortDir },
    }
    const orderBy = sortMap[sortBy] ?? { nombre: sortDir }

    const total = await prisma.consumible.count({ where: where as Prisma.ConsumibleWhereInput })
    const totalPages = Math.max(1, Math.ceil(total / pageSize))
    const currentPage = Math.min(page, totalPages)
    const offset = (currentPage - 1) * pageSize

    const consumibles = await prisma.consumible.findMany({
      where: where as Prisma.ConsumibleWhereInput,
      select: { id: true, nombre: true, descripcion: true, categoria: true, tipo: true, precio: true, imagen_url: true, activo: true, archived_at: true },
      orderBy: orderBy as Prisma.ConsumibleOrderByWithRelationInput,
      skip: offset,
      take: pageSize,
    })

    return res.json({
      data: consumibles,
      pagination: {
        page: currentPage,
        pageSize,
        total,
        totalPages,
      },
    })
  } catch {
    logServerError('consumibles list')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// POST /consumibles — crear
router.post('/', verifyInternal, requireAuth, async (req: Request, res: Response) => {
  const user = req.user!
  const empresaId = getActorEmpresaId(user)

  if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })
  if (!requirePermission(user, 'gestionar_consumibles', res)) return

  try {
    const { nombre, descripcion, precio, imagen_url, categoria, tipo } = req.body

    if (!nombre) {
      return res.status(400).json({ error: 'El nombre es obligatorio' })
    }

    if (tipo !== undefined && !isConsumibleTipoValido(tipo)) {
      return res.status(400).json({ error: 'tipo inválido' })
    }

    const categoriaNorm =
      typeof categoria === 'string' && categoria.trim() ? categoria.trim().slice(0, 100) : null

    if (nombre.trim().length > 100) {
      return res.status(400).json({ error: 'El nombre no puede exceder 100 caracteres' })
    }

    if (descripcion !== undefined && descripcion !== null && String(descripcion).length > 500) {
      return res.status(400).json({ error: 'La descripción no puede exceder 500 caracteres' })
    }

    if (imagen_url !== undefined && imagen_url !== null && imagen_url !== '') {
      try {
        const parsed = new URL(imagen_url)
        if (parsed.protocol !== 'https:') {
          return res.status(400).json({ error: 'La URL de imagen debe usar HTTPS' })
        }
      } catch {
        return res.status(400).json({ error: 'URL de imagen inválida' })
      }
    }

    const precioNormalizado = parsePositiveMoney(precio, 'El precio', MAX_CONSUMIBLE_PRICE)

    const dup = await prisma.consumible.findFirst({
      where: {
        empresa_id: empresaId,
        nombre: { equals: nombre.trim(), mode: 'insensitive' },
      },
      select: { id: true },
    })
    if (dup) {
      return res.status(409).json({ error: 'Ya existe un consumible con ese nombre' })
    }

    const id = uuidv4()

    await prisma.consumible.create({
      data: {
        id,
        empresa_id: empresaId,
        nombre: nombre.trim(),
        descripcion: descripcion ?? null,
        categoria: categoriaNorm,
        tipo: tipo ?? 'otro',
        precio: precioNormalizado,
        imagen_url: imagen_url || null,
        activo: true,
      },
    })

    return res.status(201).json({ ok: true, data: { id } })
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('El precio')) {
      return res.status(400).json({ error: error.message })
    }
    logServerError('consumibles create')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// ─── CSV helpers ──────────────────────────────────────────────────────────────

function toCsvCatalogo(rows: Record<string, unknown>[]): string {
  const headers = ['Nombre', 'Descripción', 'Precio', 'Estado', 'Desactivado el', 'Creado el']
  const lines: string[] = [headers.map(safeCsvCell).join(',')]

  for (const row of rows) {
    const formatDate = (value: unknown) => {
      if (!value) return ''
      const d = new Date(value as string)
      if (isNaN(d.getTime())) return ''
      const day = String(d.getDate()).padStart(2, '0')
      const month = String(d.getMonth() + 1).padStart(2, '0')
      return `${day}/${month}/${d.getFullYear()}`
    }

    lines.push([
      safeCsvCell(row.nombre ?? ''),
      safeCsvCell(row.descripcion ?? ''),
      safeCsvCell(Number(row.precio ?? 0).toFixed(2)),
      safeCsvCell(row.activo ? 'Activo' : 'Inactivo'),
      safeCsvCell(formatDate(row.archived_at)),
      safeCsvCell(formatDate(row.created_at)),
    ].join(','))
  }

  return lines.join('\r\n')
}

// GET /consumibles/export — exportar catálogo
router.get('/export', verifyInternal, requireAuth, async (req: Request, res: Response) => {
  const user = req.user!
  const empresaId = getActorEmpresaId(user)

  if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })
  if (!requireAnyPermission(user, ['ver_consumibles', 'exportar'], res)) return

  const formato = req.query.formato === 'csv' ? 'csv' : 'xlsx'
  const incluirInactivos = req.query.incluir_inactivos === '1'
  const busqueda = typeof req.query.busqueda === 'string' ? req.query.busqueda.trim() : ''
  const estado = typeof req.query.estado === 'string' ? req.query.estado.trim() : ''

  try {
    // --- Fulltext search branch (busqueda >= 3 chars): ILIKE + pg_trgm similarity via Prisma ---
    if (busqueda && busqueda.length >= 3) {
      const ilike = `%${busqueda}%`
      const activoFilter = estado === 'activos' ? true
        : estado === 'inactivos' ? false
        : !incluirInactivos ? true
        : null

      type ExportRow = {
        id: string
        nombre: string
        descripcion: string | null
        precio: number
        activo: boolean
        imagen_url: string | null
        archived_at: Date | null
        created_at: Date
      }

      let rows: ExportRow[]

      if (activoFilter === null) {
        rows = await prisma.$queryRaw<ExportRow[]>`
          SELECT id, nombre, descripcion, precio, activo, imagen_url, archived_at, created_at
          FROM consumibles
          WHERE empresa_id = ${empresaId}
            AND (nombre ILIKE ${ilike} OR descripcion ILIKE ${ilike})
          ORDER BY similarity(nombre, ${busqueda}) DESC, nombre ASC
          LIMIT 2000`
      } else {
        rows = await prisma.$queryRaw<ExportRow[]>`
          SELECT id, nombre, descripcion, precio, activo, imagen_url, archived_at, created_at
          FROM consumibles
          WHERE empresa_id = ${empresaId}
            AND activo = ${activoFilter}
            AND (nombre ILIKE ${ilike} OR descripcion ILIKE ${ilike})
          ORDER BY similarity(nombre, ${busqueda}) DESC, nombre ASC
          LIMIT 2000`
      }

      if (formato === 'csv') {
        const csv = toCsvCatalogo(rows as unknown as Record<string, unknown>[])
        res.setHeader('Content-Type', 'text/csv; charset=utf-8')
        res.setHeader('Content-Disposition', 'attachment; filename="consumibles-catalogo.csv"')
        return res.send('﻿' + csv)
      }

      const buffer = await buildConsumiblesCatalogoWorkbookBuffer(rows as unknown as Record<string, unknown>[])
      res.setHeader('Content-Type', CATALOGO_EXPORT_CONTENT_TYPE)
      res.setHeader('Content-Disposition', 'attachment; filename="consumibles-catalogo.xlsx"')
      return res.send(buffer)
    }

    // --- Standard branch (no busqueda or busqueda < 3): Prisma findMany ---
    const exportWhere: Record<string, unknown> = { empresa_id: empresaId }

    if (!incluirInactivos && estado !== 'inactivos') {
      exportWhere.activo = true
    }
    if (estado === 'activos') {
      exportWhere.activo = true
    } else if (estado === 'inactivos') {
      exportWhere.activo = false
    }

    if (busqueda) {
      // busqueda.length < 3 — simple ILIKE
      exportWhere.OR = [
        { nombre: { contains: busqueda, mode: 'insensitive' } },
        { descripcion: { contains: busqueda, mode: 'insensitive' } },
      ]
    }

    const rows = await prisma.consumible.findMany({
      where: exportWhere as Prisma.ConsumibleWhereInput,
      select: { id: true, nombre: true, descripcion: true, precio: true, activo: true, imagen_url: true, archived_at: true, created_at: true },
      orderBy: { nombre: 'asc' },
      take: 2000,
    })

    if (formato === 'csv') {
      const csv = toCsvCatalogo(rows)
      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader('Content-Disposition', 'attachment; filename="consumibles-catalogo.csv"')
      return res.send('﻿' + csv)
    }

    const buffer = await buildConsumiblesCatalogoWorkbookBuffer(rows)
    res.setHeader('Content-Type', CATALOGO_EXPORT_CONTENT_TYPE)
    res.setHeader('Content-Disposition', 'attachment; filename="consumibles-catalogo.xlsx"')
    return res.send(buffer)
  } catch {
    logServerError('consumibles export catalogo')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// GET /consumibles/:id/barras?evento_id=...
router.get('/:id/barras', verifyInternal, requireAuth, async (req: Request, res: Response) => {
  const user = req.user!
  const empresaId = getActorEmpresaId(user)

  if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })
  if (!requirePermission(user, 'ver_consumibles', res)) return

  const { id } = req.params
  const eventoId = req.query.evento_id as string

  if (!eventoId) {
    return res.status(400).json({ error: 'evento_id es requerido' })
  }

  const page = Math.max(1, Number(req.query.page) || 1)
  const requestedPageSize = Number(req.query.pageSize) || 50
  const pageSize = Math.min(200, Math.max(1, requestedPageSize))

  try {
    const consumibleRow = await prisma.consumible.findFirst({
      where: { id, empresa_id: empresaId },
      select: { id: true, nombre: true, precio: true },
    })

    if (!consumibleRow) {
      return res.status(404).json({ error: 'Consumible no encontrado' })
    }

    const eventoRow = await prisma.evento.findFirst({
      where: { id: eventoId, empresa_id: empresaId },
      select: { id: true },
    })

    if (!eventoRow) {
      return res.status(404).json({ error: 'Evento no encontrado' })
    }

    const total = await prisma.barra.count({
      where: { evento_id: eventoId, empresa_id: empresaId },
    })

    const totalPages = Math.max(1, Math.ceil(total / pageSize))
    const currentPage = Math.min(page, totalPages)
    const offset = (currentPage - 1) * pageSize

    // LEFT JOIN with barra_stock for this consumible — use $queryRaw (pooler)
    type BarraStockRow = {
      id: string
      nombre: string
      activa: boolean
      stock_id: string | null
      asignado: number
      stock_inicial: number
      stock_actual: number
      precio_override: number | null
      stock_activo: number
      stock_ilimitado: boolean
      agotado: boolean
    }

    const rows = await prisma.$queryRaw<BarraStockRow[]>`
      SELECT
        b.id,
        b.nombre,
        b.activa,
        bs.id AS stock_id,
        CASE WHEN bs.id IS NULL THEN 0 ELSE 1 END AS asignado,
        COALESCE(bs.stock_inicial, 0) AS stock_inicial,
        COALESCE(bs.stock_actual, 0) AS stock_actual,
        bs.precio_override,
        COALESCE(bs.activo::int, 0) AS stock_activo,
        COALESCE(bs.stock_ilimitado, false) AS stock_ilimitado,
        COALESCE(bs.agotado, false) AS agotado
      FROM barras b
      LEFT JOIN barra_stock bs
        ON bs.barra_id = b.id
       AND bs.consumible_id = ${id}
      WHERE b.evento_id = ${eventoId} AND b.empresa_id = ${empresaId}
      ORDER BY b.nombre
      LIMIT ${pageSize} OFFSET ${offset}`

    return res.json({
      data: {
        consumible: consumibleRow,
        barras: rows,
        total,
        page: currentPage,
        pageSize,
      },
    })
  } catch {
    logServerError('consumibles barras coverage')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// POST /consumibles/:id/barras/asignaciones
router.post('/:id/barras/asignaciones', verifyInternal, requireAuth, async (req: Request, res: Response) => {
  const user = req.user!
  const empresaId = getActorEmpresaId(user)

  if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })
  if (!requirePermission(user, 'gestionar_consumibles', res)) return

  const { id } = req.params
  const { evento_id, barra_ids, todas, stock_inicial, precio_override, stock_ilimitado } = req.body

  if (!evento_id) {
    return res.status(400).json({ error: 'evento_id es requerido' })
  }

  if (!todas && (!Array.isArray(barra_ids) || barra_ids.length === 0)) {
    return res.status(400).json({ error: 'Seleccioná al menos una barra o usá todas = true' })
  }

  if (stock_ilimitado !== undefined && typeof stock_ilimitado !== 'boolean') {
    return res.status(400).json({ error: 'stock_ilimitado debe ser un booleano' })
  }
  const stockIlimitado: boolean = stock_ilimitado === true

  let stockInicial: number
  let precioOverride: number | null
  try {
    stockInicial = parseNonNegativeInteger(stock_inicial, 'stock_inicial', MAX_CONSUMIBLE_STOCK)
    precioOverride = parseOptionalMoney(precio_override, 'precio_override', MAX_CONSUMIBLE_PRICE)
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : 'Datos inválidos' })
  }

  try {
    const consumibleRow = await prisma.consumible.findFirst({
      where: { id, empresa_id: empresaId, activo: true },
      select: { id: true },
    })

    if (!consumibleRow) {
      return res.status(404).json({ error: 'Consumible no encontrado o inactivo' })
    }

    const eventoRow = await prisma.evento.findFirst({
      where: { id: evento_id, empresa_id: empresaId },
      select: { id: true },
    })

    if (!eventoRow) {
      return res.status(404).json({ error: 'Evento no encontrado' })
    }

    let targetBarIds: string[] = []

    if (todas) {
      const barras = await prisma.barra.findMany({
        where: { evento_id, empresa_id: empresaId },
        select: { id: true },
      })
      targetBarIds = barras.map((b) => b.id)
    } else {
      const ids = Array.from(new Set((barra_ids as unknown[]).map((value) => String(value))))
      const barras = await prisma.barra.findMany({
        where: { evento_id, empresa_id: empresaId, id: { in: ids } },
        select: { id: true },
      })
      targetBarIds = barras.map((b) => b.id)
    }

    if (!targetBarIds.length) {
      return res.status(400).json({ error: 'No hay barras válidas para asignar' })
    }

    // ON CONFLICT (barra_id, consumible_id) — upsert atómico recalculando stock_actual.
    // Postgres: stock_actual = GREATEST(0, new_stock_inicial - GREATEST(old_stock_inicial - old_stock_actual, 0))
    // Bug fix (audit finding, medio): el `findUnique` + `.update()`/`.create()` separados de
    // antes leía stock_inicial/stock_actual en JS y luego escribía ese cálculo ya viejo — una
    // venta concurrente en el medio (que decrementa stock_actual directamente en SQL) se pisaba
    // (lost update). El INSERT ... ON CONFLICT DO UPDATE es una única sentencia atómica que
    // recalcula "vendido" contra el valor ACTUAL de la fila en el momento del UPDATE, mismo
    // patrón que POST /consumibles/barras/:id/stock en barras.ts.
    for (const barraId of targetBarIds) {
      await prisma.$executeRaw`
        INSERT INTO barra_stock (id, barra_id, consumible_id, stock_inicial, stock_actual, precio_override, stock_ilimitado, activo)
        VALUES (${uuidv4()}, ${barraId}, ${id}, ${stockInicial}, ${stockInicial}, ${precioOverride}, ${stockIlimitado}, true)
        ON CONFLICT (barra_id, consumible_id) DO UPDATE SET
          stock_inicial = EXCLUDED.stock_inicial,
          stock_actual = GREATEST(
            0,
            EXCLUDED.stock_inicial - GREATEST(barra_stock.stock_inicial - barra_stock.stock_actual, 0)
          ),
          precio_override = EXCLUDED.precio_override,
          stock_ilimitado = EXCLUDED.stock_ilimitado,
          activo = true
      `
    }

    return res.status(201).json({ ok: true, data: { assigned: targetBarIds.length } })
  } catch {
    logServerError('consumibles barras assign')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// PUT /consumibles/:id — editar (incluyendo activo)
router.put('/:id', verifyInternal, requireAuth, async (req: Request, res: Response) => {
  const user = req.user!
  const empresaId = getActorEmpresaId(user)

  if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })
  if (!requirePermission(user, 'gestionar_consumibles', res)) return

  const { id } = req.params

  try {
    const existing = await prisma.consumible.findFirst({
      where: { id, empresa_id: empresaId },
      select: { id: true },
    })

    if (!existing) return res.status(404).json({ error: 'No encontrado' })

    const body = req.body
    const updateData: Record<string, unknown> = {}

    if (body.nombre !== undefined) {
      if (String(body.nombre).trim().length > 100) {
        return res.status(400).json({ error: 'El nombre no puede exceder 100 caracteres' })
      }

      const dup = await prisma.consumible.findFirst({
        where: {
          empresa_id: empresaId,
          nombre: { equals: String(body.nombre).trim(), mode: 'insensitive' },
          id: { not: id },
        },
        select: { id: true },
      })
      if (dup) {
        return res.status(409).json({ error: 'Ya existe un consumible con ese nombre' })
      }

      updateData.nombre = String(body.nombre).trim()
    }
    if (body.descripcion !== undefined) {
      if (body.descripcion !== null && String(body.descripcion).length > 500) {
        return res.status(400).json({ error: 'La descripción no puede exceder 500 caracteres' })
      }
      updateData.descripcion = body.descripcion ?? null
    }
    if (body.precio !== undefined) {
      const precioNormalizado = parsePositiveMoney(body.precio, 'El precio', MAX_CONSUMIBLE_PRICE)
      updateData.precio = precioNormalizado
    }
    if (body.imagen_url !== undefined) {
      if (body.imagen_url !== null && body.imagen_url !== '') {
        try {
          const parsed = new URL(body.imagen_url)
          if (parsed.protocol !== 'https:') {
            return res.status(400).json({ error: 'La URL de imagen debe usar HTTPS' })
          }
        } catch {
          return res.status(400).json({ error: 'URL de imagen inválida' })
        }
      }
      updateData.imagen_url = body.imagen_url === '' ? null : (body.imagen_url ?? null)
    }
    if (body.categoria !== undefined) {
      updateData.categoria =
        typeof body.categoria === 'string' && body.categoria.trim() ? body.categoria.trim().slice(0, 100) : null
    }
    if (body.tipo !== undefined) {
      if (!isConsumibleTipoValido(body.tipo)) {
        return res.status(400).json({ error: 'tipo inválido' })
      }
      updateData.tipo = body.tipo
    }
    if (body.activo !== undefined) {
      updateData.activo = Boolean(body.activo)
      updateData.archived_at = body.activo ? null : new Date()
    }

    if (!Object.keys(updateData).length) {
      return res.status(400).json({ error: 'No se enviaron campos para actualizar' })
    }

    await prisma.consumible.updateMany({
      where: { id, empresa_id: empresaId },
      data: updateData,
    })

    return res.json({ ok: true })
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('El precio')) {
      return res.status(400).json({ error: error.message })
    }
    logServerError('consumibles update')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

async function hasConsumibleReferences(consumibleId: string, empresaId: string) {
  // barra_stock: Prisma model exists, barra relation allows empresa_id filter.
  // consumibles_venta_items: Prisma model exists but no relation to consumibles_ventas defined in schema —
  //   use $queryRaw for the empresa-scoped join check.
  // barra_restock_alertas + consumibles_promociones: Prisma models added in Phase 4 A2.
  const [stockRef, saleItemResult, alertRef, promoRef] = await Promise.all([
    // barra_stock JOIN barras (empresa scoped) via $queryRaw — BarraStock has no barra relation in schema
    prisma.$queryRaw<Array<{ id: string }>>`
      SELECT bs.id FROM barra_stock bs
      JOIN barras b ON b.id = bs.barra_id
      WHERE bs.consumible_id = ${consumibleId} AND b.empresa_id = ${empresaId}
      LIMIT 1`,
    // consumibles_venta_items JOIN consumibles_ventas (empresa scoped) — $queryRaw (pooler)
    prisma.$queryRaw<Array<{ found: number }>>`
      SELECT 1 AS found
      FROM consumibles_venta_items cvi
      JOIN consumibles_ventas cv ON cv.id = cvi.venta_id
      WHERE cvi.consumible_id = ${consumibleId} AND cv.empresa_id = ${empresaId}
      LIMIT 1`,
    // barra_restock_alertas — Prisma model now available
    prisma.barraRestockAlerta.findFirst({
      where: { consumible_id: consumibleId, empresa_id: empresaId },
      select: { id: true },
    }),
    // consumibles_promociones — Prisma model now available
    // consumible_ids is a JSON-serialized array stored as TEXT; use LIKE for reference check
    prisma.$queryRaw<Array<{ found: number }>>`
      SELECT 1 AS found
      FROM consumibles_promociones
      WHERE empresa_id = ${empresaId}
        AND consumible_ids LIKE ${`%"${consumibleId}"%`}
      LIMIT 1`,
  ])

  return (stockRef as Array<{ id: string }>).length > 0
    || saleItemResult.length > 0
    || alertRef !== null
    || promoRef.length > 0
}

// DELETE /consumibles/:id — hard delete seguro
router.delete('/:id', verifyInternal, requireAuth, async (req: Request, res: Response) => {
  const user = req.user!
  const empresaId = getActorEmpresaId(user)

  if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })
  if (!requirePermission(user, 'gestionar_consumibles', res)) return

  const { id } = req.params

  try {
    const existing = await prisma.consumible.findFirst({
      where: { id, empresa_id: empresaId, activo: true },
      select: { id: true },
    })

    if (!existing) return res.status(404).json({ error: 'No encontrado' })

    const hasReferences = await hasConsumibleReferences(id, String(empresaId))
    if (hasReferences) {
      return res.status(400).json({ error: CONSUMIBLE_DELETE_BLOCKED_ERROR })
    }

    await prisma.consumible.deleteMany({
      where: { id, empresa_id: empresaId },
    })

    return res.json({ ok: true })
  } catch {
    logServerError('consumibles delete')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

export default router
