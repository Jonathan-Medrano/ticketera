import { Router, Request, Response } from 'express'
import { verifyInternal, requireAuth } from '../middleware/auth'
import { randomUUID as uuidv4 } from 'node:crypto'
import { getActorEmpresaId, requirePermission, requireAnyPermission } from '../lib/authz'
import { logServerError } from '../lib/safe-log'
import { buildBarrasResumenWorkbookBuffer, buildBarraStockWorkbookBuffer, BARRAS_EXPORT_CONTENT_TYPE } from '../lib/barras-export-workbook'
import { safeCsvCell } from '../lib/csv-escape'
import { prisma, prismaDirectUrl } from '../lib/prisma'

const router = Router()
const MAX_BARRA_STOCK = 100000
const MAX_BARRA_PRICE_OVERRIDE = 1_000_000

type RestockRow = {
  id: string
  estado: 'pendiente' | 'resuelto'
}

const BARRA_DELETE_BLOCKED_ERROR = 'No se puede eliminar la barra porque tiene referencias activas o históricas. Desactivala en su lugar.'

async function verificarPertenencia(barraId: string, empresaId: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM barras WHERE id = ${barraId} AND empresa_id = ${empresaId}
  `
  return rows.length > 0
}

async function hasBarraReferences(barraId: string, empresaId: string) {
  const [stockRows, alertRows, saleRows] = await Promise.all([
    prisma.$queryRaw<Array<{ total: bigint }>>`
      SELECT COUNT(*) as total FROM barra_stock bs
      JOIN barras b ON b.id = bs.barra_id
      WHERE bs.barra_id = ${barraId} AND b.empresa_id = ${empresaId}
    `,
    prisma.$queryRaw<Array<{ total: bigint }>>`
      SELECT COUNT(*) as total FROM barra_restock_alertas WHERE barra_id = ${barraId} AND empresa_id = ${empresaId}
    `,
    prisma.$queryRaw<Array<{ total: bigint }>>`
      SELECT COUNT(*) as total FROM consumibles_ventas WHERE barra_id = ${barraId} AND empresa_id = ${empresaId}
    `,
  ])

  return Number(stockRows[0]?.total ?? 0) > 0
    || Number(alertRows[0]?.total ?? 0) > 0
    || Number(saleRows[0]?.total ?? 0) > 0
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

function parseOptionalBoolean(value: unknown, fieldName: string): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') {
    throw new Error(`${fieldName} debe ser un booleano`)
  }
  return value
}

// GET /consumibles/barras — por evento_id query param
router.get('/', verifyInternal, requireAuth, async (req: Request, res: Response) => {
  const user = req.user!
  const empresaId = getActorEmpresaId(user)

  if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })
  if (!requirePermission(user, 'ver_consumibles', res)) return

  const eventoId = req.query.evento_id as string
  const soloActivas = req.query.solo_activas === '1' || req.query.solo_activas === 'true'

  if (!eventoId) {
    return res.status(400).json({ error: 'evento_id es requerido' })
  }

    try {
      const rows = soloActivas
        ? await prisma.$queryRaw<Array<Record<string, unknown>>>`
            SELECT
              b.*,
              COUNT(bs.id) as total_items,
              COALESCE(SUM(CASE WHEN bs.activo = true THEN 1 ELSE 0 END), 0) as items_activos,
              COALESCE(SUM(CASE WHEN bs.activo = true AND bs.stock_actual <= 0 THEN 1 ELSE 0 END), 0) as sin_stock_items,
              COALESCE(SUM(CASE WHEN bs.activo = true AND bs.stock_actual > 0 AND bs.stock_inicial > 0 AND bs.stock_actual <= (bs.stock_inicial * 0.2) THEN 1 ELSE 0 END), 0) as low_stock_items
            FROM barras b
            LEFT JOIN barra_stock bs ON bs.barra_id = b.id
            WHERE b.evento_id = ${eventoId} AND b.empresa_id = ${empresaId} AND b.activa = true
            GROUP BY b.id
            ORDER BY sin_stock_items DESC, low_stock_items DESC, b.activa DESC, b.nombre ASC
          `
        : await prisma.$queryRaw<Array<Record<string, unknown>>>`
            SELECT
              b.*,
              COUNT(bs.id) as total_items,
              COALESCE(SUM(CASE WHEN bs.activo = true THEN 1 ELSE 0 END), 0) as items_activos,
              COALESCE(SUM(CASE WHEN bs.activo = true AND bs.stock_actual <= 0 THEN 1 ELSE 0 END), 0) as sin_stock_items,
              COALESCE(SUM(CASE WHEN bs.activo = true AND bs.stock_actual > 0 AND bs.stock_inicial > 0 AND bs.stock_actual <= (bs.stock_inicial * 0.2) THEN 1 ELSE 0 END), 0) as low_stock_items
            FROM barras b
            LEFT JOIN barra_stock bs ON bs.barra_id = b.id
            WHERE b.evento_id = ${eventoId} AND b.empresa_id = ${empresaId}
            GROUP BY b.id
            ORDER BY sin_stock_items DESC, low_stock_items DESC, b.activa DESC, b.nombre ASC
          `

    return res.json({ data: rows })
  } catch {
    logServerError('barras list')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// POST /consumibles/barras — crear
router.post('/', verifyInternal, requireAuth, async (req: Request, res: Response) => {
  const user = req.user!
  const empresaId = getActorEmpresaId(user)

  if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })
  if (!requirePermission(user, 'gestionar_consumibles', res)) return

  try {
    const { evento_id, nombre, buyer_consumible_refunds_enabled } = req.body

    if (!evento_id || typeof nombre !== 'string' || nombre.trim().length === 0) {
      return res.status(400).json({ error: 'evento_id y nombre son requeridos' })
    }
    if (nombre.trim().length > 100) {
      return res.status(400).json({ error: 'El nombre del bar no puede superar los 100 caracteres' })
    }

    // Validar que el evento existe y pertenece a esta empresa
    const eventoCheck = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM eventos WHERE id = ${evento_id} AND empresa_id = ${empresaId}
    `
    if (!eventoCheck.length) {
      return res.status(400).json({ error: 'Evento no existe o no pertenece a tu empresa' })
    }

    const id = uuidv4()
    const refundsEnabled = buyer_consumible_refunds_enabled !== false

    await prisma.$executeRaw`
      INSERT INTO barras (id, evento_id, empresa_id, nombre, buyer_consumible_refunds_enabled)
      VALUES (${id}, ${evento_id}, ${empresaId}, ${nombre}, ${refundsEnabled})
    `

    return res.status(201).json({ ok: true, data: { id } })
  } catch {
    logServerError('barras create')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// ─── CSV helpers (usados por ambos exports) ────────────────────────────────

function toCsvBarras(rows: Array<Record<string, unknown>>, columns: string[]) {
  const header = columns.map(safeCsvCell).join(',')
  const body = rows.map((row) => columns.map((col) => safeCsvCell(row[col])).join(',')).join('\n')
  return body ? `${header}\n${body}\n` : `${header}\n`
}

// GET /consumibles/barras/export — resumen de barras por evento (Export A)
// IMPORTANTE: declarado ANTES de /:id para que Express no lo capture como param
router.get('/export', verifyInternal, requireAuth, async (req: Request, res: Response) => {
  const user = req.user!
  const empresaId = getActorEmpresaId(user)
  if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })
  if (!requireAnyPermission(user, ['ver_consumibles', 'exportar'], res)) return

  const eventoId = typeof req.query.evento_id === 'string' ? req.query.evento_id.trim() : ''
  const formato = req.query.formato === 'csv' ? 'csv' : 'xlsx'

  if (!eventoId) {
    return res.status(400).json({ error: 'evento_id es requerido' })
  }

  try {
    const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT
        b.id,
        b.nombre AS barra_nombre,
        b.activa,
        b.archived_at,
        COUNT(bs.id) AS total_items,
        SUM(CASE WHEN bs.activo = true THEN 1 ELSE 0 END) AS items_activos,
        SUM(CASE WHEN bs.activo = true AND bs.stock_actual <= 0 THEN 1 ELSE 0 END) AS sin_stock,
        SUM(CASE WHEN bs.activo = true AND bs.stock_inicial > 0 AND bs.stock_actual::numeric / bs.stock_inicial::numeric <= 0.2 THEN 1 ELSE 0 END) AS low_stock
      FROM barras b
      LEFT JOIN barra_stock bs ON bs.barra_id = b.id
      WHERE b.evento_id = ${eventoId} AND b.empresa_id = ${empresaId}
      GROUP BY b.id, b.nombre, b.activa, b.archived_at
      ORDER BY b.nombre ASC
      LIMIT 500
    `

    if (formato === 'xlsx') {
      const buffer = await buildBarrasResumenWorkbookBuffer(rows)
      res.setHeader('Content-Type', BARRAS_EXPORT_CONTENT_TYPE)
      res.setHeader('Content-Disposition', `attachment; filename="barras-resumen-${eventoId}.xlsx"`)
      return res.status(200).send(buffer)
    }

    const csvColumns = ['barra_nombre', 'activa', 'total_items', 'items_activos', 'sin_stock', 'low_stock', 'archived_at']
    const csvRows = rows.map((row) => ({
      barra_nombre: row.barra_nombre ?? '',
      activa: row.activa ? 'Activa' : 'Inactiva',
      total_items: Number(row.total_items ?? 0),
      items_activos: Number(row.items_activos ?? 0),
      sin_stock: Number(row.sin_stock ?? 0),
      low_stock: Number(row.low_stock ?? 0),
      archived_at: row.archived_at ? String(row.archived_at).slice(0, 10) : '',
    }))
    const csv = toCsvBarras(csvRows, csvColumns)
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="barras-resumen-${eventoId}.csv"`)
    return res.status(200).send(csv)
  } catch {
    logServerError('barras export resumen')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// GET /consumibles/barras/:id/stock
router.get('/:id/stock', verifyInternal, requireAuth, async (req: Request, res: Response) => {
  const user = req.user!
  const empresaId = getActorEmpresaId(user)

  if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })
  if (!requirePermission(user, 'ver_consumibles', res)) return

  const barraId = req.params.id
  const soloActivos = req.query.solo_activos === '1' || req.query.solo_activos === 'true'

  try {
    const pertenece = await verificarPertenencia(barraId, empresaId)
    if (!pertenece) {
      return res.status(404).json({ error: 'Barra no encontrada' })
    }

    const rows = soloActivos
      ? await prisma.$queryRaw<Array<Record<string, unknown>>>`
          SELECT
            bs.id,
            bs.consumible_id,
            c.nombre,
            c.descripcion,
            c.categoria,
            c.imagen_url,
            c.precio AS precio_base,
            bs.precio_override,
            bs.stock_inicial,
            bs.stock_actual,
            bs.activo,
            bs.stock_ilimitado,
            bs.agotado,
            ra.id as restock_alerta_id,
            CASE WHEN ra.id IS NULL THEN 0 ELSE 1 END as restock_pendiente
          FROM barra_stock bs
          JOIN consumibles c ON c.id = bs.consumible_id
          LEFT JOIN barra_restock_alertas ra
            ON ra.barra_stock_id = bs.id AND ra.estado = 'pendiente'
          WHERE bs.barra_id = ${barraId} AND bs.activo = true AND c.activo = true
          ORDER BY c.categoria ASC NULLS LAST, c.nombre ASC
        `
      : await prisma.$queryRaw<Array<Record<string, unknown>>>`
          SELECT
            bs.id,
            bs.consumible_id,
            c.nombre,
            c.descripcion,
            c.categoria,
            c.imagen_url,
            c.precio AS precio_base,
            bs.precio_override,
            bs.stock_inicial,
            bs.stock_actual,
            bs.activo,
            bs.stock_ilimitado,
            bs.agotado,
            ra.id as restock_alerta_id,
            CASE WHEN ra.id IS NULL THEN 0 ELSE 1 END as restock_pendiente
          FROM barra_stock bs
          JOIN consumibles c ON c.id = bs.consumible_id
          LEFT JOIN barra_restock_alertas ra
            ON ra.barra_stock_id = bs.id AND ra.estado = 'pendiente'
          WHERE bs.barra_id = ${barraId}
          ORDER BY c.categoria ASC NULLS LAST, c.nombre ASC
        `

    return res.json({ data: rows })
  } catch {
    logServerError('barras stock list')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// GET /consumibles/barras/:id/export — detalle de stock por barra (Export B)
router.get('/:id/export', verifyInternal, requireAuth, async (req: Request, res: Response) => {
  const user = req.user!
  const empresaId = getActorEmpresaId(user)
  if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })
  if (!requireAnyPermission(user, ['ver_consumibles', 'exportar'], res)) return

  const barraId = req.params.id
  const formato = req.query.formato === 'csv' ? 'csv' : 'xlsx'

  try {
    const pertenece = await verificarPertenencia(barraId, empresaId)
    if (!pertenece) {
      return res.status(404).json({ error: 'Barra no encontrada' })
    }

    // Obtener el nombre de la barra para el filename
    const barraRows = await prisma.$queryRaw<Array<{ nombre: string }>>`
      SELECT nombre FROM barras WHERE id = ${barraId} AND empresa_id = ${empresaId}
    `
    const barraName: string = barraRows[0]?.nombre ?? barraId

    const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT
        c.nombre AS consumible_nombre,
        c.descripcion,
        c.precio AS precio_base,
        bs.precio_override,
        bs.stock_inicial,
        bs.stock_actual,
        CASE
          WHEN bs.stock_inicial > 0
          THEN ROUND((bs.stock_inicial - bs.stock_actual)::numeric / bs.stock_inicial::numeric * 100, 1)
          ELSE 0
        END AS pct_consumido,
        bs.activo,
        b.nombre AS barra_nombre
      FROM barra_stock bs
      JOIN consumibles c ON c.id = bs.consumible_id
      JOIN barras b ON b.id = bs.barra_id
      WHERE bs.barra_id = ${barraId} AND b.empresa_id = ${empresaId}
      ORDER BY c.nombre ASC
    `

    if (formato === 'xlsx') {
      const buffer = await buildBarraStockWorkbookBuffer(rows, barraName)
      res.setHeader('Content-Type', BARRAS_EXPORT_CONTENT_TYPE)
      res.setHeader('Content-Disposition', `attachment; filename="barra-stock-${barraId}.xlsx"`)
      return res.status(200).send(buffer)
    }

    const csvColumns = ['consumible_nombre', 'descripcion', 'precio_base', 'precio_override', 'stock_inicial', 'stock_actual', 'pct_consumido', 'activo']
    const csvRows = rows.map((row) => ({
      consumible_nombre: row.consumible_nombre ?? '',
      descripcion: row.descripcion ?? '',
      precio_base: Number(row.precio_base ?? 0),
      precio_override: row.precio_override != null ? Number(row.precio_override) : '',
      stock_inicial: Number(row.stock_inicial ?? 0),
      stock_actual: Number(row.stock_actual ?? 0),
      pct_consumido: `${Number(row.pct_consumido ?? 0)}%`,
      activo: row.activo ? 'Sí' : 'No',
    }))
    const csv = toCsvBarras(csvRows, csvColumns)
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="barra-stock-${barraId}.csv"`)
    return res.status(200).send(csv)
  } catch {
    logServerError('barras export stock')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// POST /consumibles/barras/:id/stock/:stockId/restock — crear alerta de reposición
router.post('/:id/stock/:stockId/restock', verifyInternal, requireAuth, async (req: Request, res: Response) => {
  const user = req.user!
  const empresaId = getActorEmpresaId(user)

  if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })
  if (!requireAnyPermission(user, ['gestionar_consumibles', 'gestionar_stock_barras'], res)) return

  const barraId = req.params.id
  const stockId = req.params.stockId

  try {
    const rows = await prisma.$queryRaw<Array<{ id: string; barra_id: string; consumible_id: string; evento_id: string }>>`
      SELECT bs.id, bs.barra_id, bs.consumible_id, b.evento_id
      FROM barra_stock bs
      JOIN barras b ON b.id = bs.barra_id
      WHERE bs.id = ${stockId} AND bs.barra_id = ${barraId} AND b.empresa_id = ${empresaId}
    `

    if (!rows.length) {
      return res.status(404).json({ error: 'Stock de barra no encontrado' })
    }

    const stock = rows[0]

    const pendingRows = await prisma.$queryRaw<Array<{ id: string; estado: string }>>`
      SELECT id, estado FROM barra_restock_alertas WHERE barra_stock_id = ${stockId} AND estado = 'pendiente' LIMIT 1
    `

    if (pendingRows.length > 0) {
      return res.status(409).json({ error: 'Ya existe un pedido de reposición pendiente para este producto' })
    }

    const alertaId = uuidv4()
    const nota = typeof req.body?.nota === 'string' && req.body.nota.trim() ? req.body.nota.trim() : null

    await prisma.$executeRaw`
      INSERT INTO barra_restock_alertas (id, empresa_id, evento_id, barra_id, barra_stock_id, consumible_id, estado, nota, requested_by_user_id)
      VALUES (${alertaId}, ${empresaId}, ${stock.evento_id}, ${barraId}, ${stockId}, ${stock.consumible_id}, 'pendiente', ${nota}, ${user.id})
    `

    return res.status(201).json({ ok: true, data: { id: alertaId } })
  } catch {
    logServerError('barras restock create')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// PATCH /consumibles/barras/:id/stock/:stockId/restock/:alertaId — resolver alerta
router.patch('/:id/stock/:stockId/restock/:alertaId', verifyInternal, requireAuth, async (req: Request, res: Response) => {
  const user = req.user!
  const empresaId = getActorEmpresaId(user)

  if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })
  if (!requireAnyPermission(user, ['gestionar_consumibles', 'gestionar_stock_barras'], res)) return

  const { id: barraId, stockId, alertaId } = req.params

  try {
    const rows = await prisma.$queryRaw<Array<{ id: string; estado: string; consumible_id: string; stock_actual: number }>>`
      SELECT ra.id, ra.estado, bs.consumible_id, bs.stock_actual
      FROM barra_restock_alertas ra
      JOIN barra_stock bs ON bs.id = ra.barra_stock_id
      JOIN barras b ON b.id = ra.barra_id
      WHERE ra.id = ${alertaId} AND ra.barra_stock_id = ${stockId} AND ra.barra_id = ${barraId} AND b.empresa_id = ${empresaId}
    `

    if (!rows.length) {
      return res.status(404).json({ error: 'Alerta de reposición no encontrada' })
    }

    if (rows[0].estado === 'resuelto') {
      return res.json({ ok: true })
    }

    const { consumible_id, stock_actual } = rows[0]
    const stockActualNum = Number(stock_actual)
    const logId = uuidv4()

    await prisma.$executeRaw`
      UPDATE barra_restock_alertas
      SET estado = 'resuelto', resolved_at = NOW(), resolved_by_user_id = ${user.id}
      WHERE id = ${alertaId}
    `

    await prisma.$executeRaw`
      INSERT INTO barra_stock_logs (id, barra_stock_id, barra_id, consumible_id, empresa_id, tipo, stock_anterior, stock_nuevo, usuario_id, nota)
      VALUES (${logId}, ${stockId}, ${barraId}, ${consumible_id}, ${empresaId}, 'restock_resuelto', ${stockActualNum}, ${stockActualNum}, ${user.id}, 'Alerta de reposición resuelta')
    `

    return res.json({ ok: true })
  } catch {
    logServerError('barras restock resolve')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// POST /consumibles/barras/:id/stock — upsert
router.post('/:id/stock', verifyInternal, requireAuth, async (req: Request, res: Response) => {
  const user = req.user!
  const empresaId = getActorEmpresaId(user)

  if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })
  if (!requireAnyPermission(user, ['gestionar_consumibles', 'gestionar_stock_barras'], res)) return

  const barraId = req.params.id

  try {
    const pertenece = await verificarPertenencia(barraId, empresaId)
    if (!pertenece) {
      return res.status(404).json({ error: 'Barra no encontrada' })
    }

    const { consumible_id, stock_inicial, precio_override, stock_ilimitado } = req.body

    if (!consumible_id || stock_inicial === undefined) {
      return res.status(400).json({ error: 'consumible_id y stock_inicial son requeridos' })
    }

    // Validar que el consumible existe y pertenece a esta empresa
    const consumibleCheck = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM consumibles WHERE id = ${consumible_id} AND empresa_id = ${empresaId} AND activo = true
    `
    if (!consumibleCheck.length) {
      return res.status(400).json({ error: 'Consumible no existe o no pertenece a tu empresa' })
    }

    const id = uuidv4()
    const stockInicial = parseNonNegativeInteger(stock_inicial, 'stock_inicial', MAX_BARRA_STOCK)
    const precioOverride = parseOptionalMoney(precio_override, 'precio_override', MAX_BARRA_PRICE_OVERRIDE)
    const stockIlimitado = parseOptionalBoolean(stock_ilimitado, 'stock_ilimitado')
    // En INSERT: usar el valor provisto o default false. En UPDATE: setearlo solo si vino en el body
    // (COALESCE deja el valor existente cuando el provisto es NULL).
    const stockIlimitadoInsert = stockIlimitado ?? false
    const stockIlimitadoUpdate = stockIlimitado === undefined ? null : stockIlimitado

    // PostgreSQL ON CONFLICT upsert (replaces MySQL ON DUPLICATE KEY)
    await prisma.$executeRaw`
      INSERT INTO barra_stock (id, barra_id, consumible_id, stock_inicial, stock_actual, precio_override, stock_ilimitado)
      VALUES (${id}, ${barraId}, ${consumible_id}, ${stockInicial}, ${stockInicial}, ${precioOverride}, ${stockIlimitadoInsert})
      ON CONFLICT (barra_id, consumible_id) DO UPDATE SET
        stock_inicial = EXCLUDED.stock_inicial,
        stock_actual = GREATEST(
          0,
          EXCLUDED.stock_inicial - GREATEST(barra_stock.stock_inicial - barra_stock.stock_actual, 0)
        ),
        precio_override = EXCLUDED.precio_override,
        stock_ilimitado = COALESCE(${stockIlimitadoUpdate}::boolean, barra_stock.stock_ilimitado)
    `

    return res.status(201).json({ ok: true, data: { id } })
  } catch (error) {
    if (error instanceof Error && (error.message.includes('stock_inicial') || error.message.includes('precio_override') || error.message.includes('stock_ilimitado'))) {
      return res.status(400).json({ error: error.message })
    }
    logServerError('barras stock upsert')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// PUT /consumibles/barras/:id/stock — bulk update
router.put('/:id/stock', verifyInternal, requireAuth, async (req: Request, res: Response) => {
  const user = req.user!
  const empresaId = getActorEmpresaId(user)

  if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })
  if (!requireAnyPermission(user, ['gestionar_consumibles', 'gestionar_stock_barras'], res)) return

  const barraId = req.params.id

  const { items } = req.body

  if (!Array.isArray(items) || !items.length) {
    return res.status(400).json({ error: 'items es requerido y debe ser un array no vacío' })
  }

  for (const item of items) {
    const stockInicial = parseNonNegativeInteger(item.stock_inicial, 'stock_inicial', MAX_BARRA_STOCK)
    const stockActual = item.stock_actual !== undefined
      ? parseNonNegativeInteger(item.stock_actual, 'stock_actual', MAX_BARRA_STOCK)
      : stockInicial
    if (stockActual > stockInicial) {
      return res.status(400).json({ error: 'stock_actual no puede superar stock_inicial' })
    }
    parseOptionalMoney(item.precio_override, 'precio_override', MAX_BARRA_PRICE_OVERRIDE)
    parseOptionalBoolean(item.stock_ilimitado, 'stock_ilimitado')
  }

  try {
    // Resolve early to avoid doing it inside the transaction
    const consumibleIds: string[] = items.map((i: any) => i.consumible_id).filter(Boolean)

    // Validate barra and consumibles outside transaction first (read-only)
    const barraCheck = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM barras WHERE id = ${barraId} AND empresa_id = ${empresaId}
    `
    if (!barraCheck.length) {
      return res.status(404).json({ error: 'Barra no encontrada' })
    }

    if (consumibleIds.length) {
      const validCheck = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM consumibles WHERE id = ANY($1::text[]) AND empresa_id = $2`,
        consumibleIds,
        empresaId,
      )
      if (validCheck.length !== consumibleIds.length) {
        return res.status(400).json({ error: 'Uno o más consumibles no pertenecen a tu empresa' })
      }
    }

    // Transacción con FOR UPDATE (requiere prismaDirectUrl — direct connection)
    await prismaDirectUrl.$transaction(async (tx) => {
      const lockedRows = await tx.$queryRawUnsafe<Array<{ id: string; consumible_id: string; stock_actual: number }>>(
        `SELECT id, consumible_id, stock_actual FROM barra_stock
         WHERE barra_id = $1 AND consumible_id = ANY($2::text[])
         FOR UPDATE`,
        barraId,
        consumibleIds,
      )
      const lockedMap = new Map(
        lockedRows.map((r) => [
          String(r.consumible_id),
          { id: String(r.id), stockActualAntes: Number(r.stock_actual) },
        ])
      )

      for (const item of items) {
        if (item.consumible_id && !lockedMap.has(item.consumible_id)) {
          throw Object.assign(new Error(`No existe stock para el consumible ${item.consumible_id} en esta barra`), { statusCode: 404 })
        }
      }

      for (const item of items) {
        const { consumible_id, stock_inicial, stock_actual, precio_override, stock_ilimitado } = item
        const stockInicialParsed = parseNonNegativeInteger(stock_inicial, 'stock_inicial', MAX_BARRA_STOCK)
        const stockNuevo = stock_actual !== undefined
          ? parseNonNegativeInteger(stock_actual, 'stock_actual', MAX_BARRA_STOCK)
          : stockInicialParsed
        const precioOverrideParsed = parseOptionalMoney(precio_override, 'precio_override', MAX_BARRA_PRICE_OVERRIDE)
        const stockIlimitadoParsed = parseOptionalBoolean(stock_ilimitado, 'stock_ilimitado')
        // Setear stock_ilimitado solo cuando vino en el item (COALESCE conserva el valor existente si es NULL).
        const stockIlimitadoUpdate = stockIlimitadoParsed === undefined ? null : stockIlimitadoParsed

        await tx.$executeRaw`
          UPDATE barra_stock
          SET stock_inicial = ${stockInicialParsed}, stock_actual = ${stockNuevo}, precio_override = ${precioOverrideParsed},
              stock_ilimitado = COALESCE(${stockIlimitadoUpdate}::boolean, stock_ilimitado)
          WHERE barra_id = ${barraId} AND consumible_id = ${consumible_id}
        `

        const locked = lockedMap.get(consumible_id)
        if (locked) {
          const logId = uuidv4()
          await tx.$executeRaw`
            INSERT INTO barra_stock_logs (id, barra_stock_id, barra_id, consumible_id, empresa_id, tipo, stock_anterior, stock_nuevo, usuario_id)
            VALUES (${logId}, ${locked.id}, ${barraId}, ${consumible_id}, ${empresaId}, 'ajuste_manual', ${locked.stockActualAntes}, ${stockNuevo}, ${user.id})
          `
        }
      }
    }, { isolationLevel: 'Serializable' })

    return res.json({ ok: true })
  } catch (error) {
    if (error instanceof Error) {
      const statusCode = (error as any).statusCode
      if (statusCode === 404) return res.status(404).json({ error: error.message })
      if (error.message.includes('stock_') || error.message.includes('precio_override')) {
        return res.status(400).json({ error: error.message })
      }
    }
    logServerError('barras stock bulk update')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// PATCH /consumibles/barras/:barraId/items/:consumibleId — toggle de flags de disponibilidad
// (stock_ilimitado y/o agotado) sin tocar los números de stock.
router.patch('/:barraId/items/:consumibleId', verifyInternal, requireAuth, async (req: Request, res: Response) => {
  const user = req.user!
  const empresaId = getActorEmpresaId(user)

  if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })
  if (!requireAnyPermission(user, ['gestionar_consumibles', 'gestionar_stock_barras'], res)) return

  const { barraId, consumibleId } = req.params

  let stockIlimitado: boolean | undefined
  let agotado: boolean | undefined
  try {
    stockIlimitado = parseOptionalBoolean(req.body?.stock_ilimitado, 'stock_ilimitado')
    agotado = parseOptionalBoolean(req.body?.agotado, 'agotado')
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : 'Datos inválidos' })
  }

  if (stockIlimitado === undefined && agotado === undefined) {
    return res.status(400).json({ error: 'Indicá al menos stock_ilimitado o agotado' })
  }

  try {
    const pertenece = await verificarPertenencia(barraId, empresaId)
    if (!pertenece) {
      return res.status(404).json({ error: 'Asignación no encontrada' })
    }

    const stockIlimitadoUpdate = stockIlimitado === undefined ? null : stockIlimitado
    const agotadoUpdate = agotado === undefined ? null : agotado

    // Actualiza SOLO los flags provistos (COALESCE conserva el valor existente cuando es NULL).
    const affected = await prisma.$executeRaw`
      UPDATE barra_stock
      SET stock_ilimitado = COALESCE(${stockIlimitadoUpdate}::boolean, stock_ilimitado),
          agotado = COALESCE(${agotadoUpdate}::boolean, agotado)
      WHERE barra_id = ${barraId} AND consumible_id = ${consumibleId}
    `

    if (affected === 0) {
      return res.status(404).json({ error: 'Asignación no encontrada' })
    }

    return res.json({ ok: true })
  } catch {
    logServerError('barras stock flags toggle')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// PUT /consumibles/barras/:id — editar
router.put('/:id', verifyInternal, requireAuth, async (req: Request, res: Response) => {
  const user = req.user!
  const empresaId = getActorEmpresaId(user)

  if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })
  if (!requirePermission(user, 'gestionar_consumibles', res)) return

  const { id } = req.params

  try {
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM barras WHERE id = ${id} AND empresa_id = ${empresaId}
    `

    if (!rows.length) {
      return res.status(404).json({ error: 'Barra no encontrada' })
    }

    const { nombre, activa, buyer_consumible_refunds_enabled } = req.body

    const fields: string[] = []
    const values: unknown[] = []

    if (nombre !== undefined) {
      values.push(nombre)
      fields.push(`nombre = $${values.length}`)
    }
    if (activa !== undefined) {
      values.push(Boolean(activa))
      fields.push(`activa = $${values.length}`)
      if (activa) {
        fields.push('archived_at = NULL')
      } else {
        fields.push('archived_at = NOW()')
      }
    }
    if (buyer_consumible_refunds_enabled !== undefined) {
      values.push(Boolean(buyer_consumible_refunds_enabled))
      fields.push(`buyer_consumible_refunds_enabled = $${values.length}`)
    }

    if (!fields.length) {
      return res.status(400).json({ error: 'No hay campos para actualizar' })
    }

    values.push(id, empresaId)

    await prisma.$executeRawUnsafe(
      `UPDATE barras SET ${fields.join(', ')} WHERE id = $${values.length - 1} AND empresa_id = $${values.length}`,
      ...values
    )

    return res.json({ ok: true })
  } catch {
    logServerError('barras update')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// DELETE /consumibles/barras/:id — eliminar
router.delete('/:id', verifyInternal, requireAuth, async (req: Request, res: Response) => {
  const user = req.user!
  const empresaId = getActorEmpresaId(user)

  if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })
  if (!requirePermission(user, 'gestionar_consumibles', res)) return

  const { id } = req.params

  try {
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM barras WHERE id = ${id} AND empresa_id = ${empresaId}
    `

    if (!rows.length) {
      return res.status(404).json({ error: 'Barra no encontrada' })
    }

    const hasReferences = await hasBarraReferences(id, empresaId)
    if (hasReferences) {
      return res.status(400).json({ error: BARRA_DELETE_BLOCKED_ERROR })
    }

    await prisma.$executeRaw`DELETE FROM barras WHERE id = ${id} AND empresa_id = ${empresaId}`

    return res.json({ ok: true })
  } catch {
    logServerError('barras delete')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

export default router
