import { Router, Request, Response } from 'express'
import rateLimit from 'express-rate-limit'
import { verifyInternal, requireAuth } from '../middleware/auth'
import { getActorEmpresaId, requirePermissionMiddleware } from '../lib/authz'
import { logServerError } from '../lib/safe-log'
import { logEmpleadoActividad } from '../lib/empleado-actividad'
import {
  buildEscanearWorkbookBuffer,
  buildEscanearExportFilename,
  buildEscanearCsvExportFilename,
  ESCANEAR_EXPORT_COLUMNS,
  ESCANEAR_EXPORT_CONTENT_TYPE,
} from '../lib/escanear-export-workbook'
import { safeCsvCell } from '../lib/csv-escape'
import { prisma, prismaDirectUrl } from '../lib/prisma'
import { Prisma } from '@prisma/client'

// Stricter rate limit for the cache export endpoint (bulk QR + DNI data)
const cacheExportRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes de caché, esperá unos minutos antes de reintentar' },
})

const router = Router()

type ScanInput = {
  codigo: string
  evento_id: string
}

function readScanInput(body: unknown): ScanInput | null {
  if (!body || typeof body !== 'object') return null
  const codigo = (body as Record<string, unknown>).codigo
  const evento_id = (body as Record<string, unknown>).evento_id
  if (typeof codigo !== 'string' || !codigo.trim()) return null
  if (typeof evento_id !== 'string' || !evento_id.trim()) return null
  return { codigo: codigo.trim(), evento_id: evento_id.trim() }
}

function resolveActorIdentity(user: NonNullable<Request['user']>) {
  const userId = String((user as { id?: unknown }).id ?? '') || null
  const rawName = (user as { nombre?: unknown }).nombre
  const rawEmail = (user as { email?: unknown }).email
  const userName =
    (typeof rawName === 'string' && rawName.trim()) ||
    (typeof rawEmail === 'string' && rawEmail.trim()) ||
    null
  return { userId, userName }
}

/**
 * POST /escanear
 *
 * Validación + marcado de entrada en UN ÚNICO UPDATE atómico. El WHERE incluye
 * `estado = 'valida'` lo que serializa naturalmente las carreras: si dos scanners
 * escanean la misma entrada simultáneamente, solo uno tiene affectedRows = 1.
 *
 * Comparativa con flujo anterior:
 *   Antes: BEGIN + SELECT FOR UPDATE + (rollback|UPDATE+COMMIT)  = 3-5 queries
 *   Ahora: UPDATE atómico + SELECT minimal display                = 2 queries
 *
 * Sin transaction, sin row lock prolongado.
 */
router.post(
  '/',
  verifyInternal,
  requireAuth,
  requirePermissionMiddleware('escanear'),
  async (req: Request, res: Response) => {
    try {
      const empresaId = getActorEmpresaId(req.user!)
      if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })

      const input = readScanInput(req.body)
      if (!input) {
        return res.status(400).json({ error: 'Faltan datos' })
      }

      const { userId: actorUserId, userName: actorUserName } = resolveActorIdentity(req.user!)

      // Query 1: UPDATE atómico. WHERE estado='valida' garantiza idempotencia
      // y serialización contra escaneos concurrentes.
      type UpdateResult = { affectedRows: number }[]
      const updateRows = await prismaDirectUrl.$queryRaw<UpdateResult>`
        WITH updated AS (
          UPDATE entradas en
          SET estado = 'usada',
              usada_at = NOW(),
              used_by_user_id = ${actorUserId},
              used_by_user_name = ${actorUserName}
          FROM eventos ev
          WHERE ev.id = en.evento_id
            AND (en.qr_code = ${input.codigo} OR en.clave_corta = ${input.codigo})
            AND en.evento_id = ${input.evento_id}
            AND ev.empresa_id = ${empresaId}
            AND en.estado = 'valida'
          RETURNING 1 AS affected
        )
        SELECT COUNT(*)::int AS "affectedRows" FROM updated`

      const affectedRows = Number(updateRows[0]?.affectedRows ?? 0)

      // Fallback to physical pre-printed tickets (`ticket_fisicos`) when the
      // code isn't a digital `entradas` row. Same atomic UPDATE pattern guards
      // against double-redemption (the WHERE estado IN (...) makes the second
      // scanner see 0 rows updated).
      if (affectedRows === 0) {
        const fisicoUpdate = await prismaDirectUrl.$queryRaw<UpdateResult>`
          WITH updated AS (
            UPDATE ticket_fisicos tf
            SET estado = 'usada',
                usada_at = NOW(),
                used_by_user_id = ${actorUserId},
                used_by_user_name = ${actorUserName}
            FROM eventos ev
            WHERE ev.id = tf.evento_id
              AND (tf.qr_code = ${input.codigo} OR tf.clave_corta = ${input.codigo})
              AND tf.evento_id = ${input.evento_id}
              AND ev.empresa_id = ${empresaId}
              AND tf.estado IN ('disponible', 'vendido')
            RETURNING 1 AS affected
          )
          SELECT COUNT(*)::int AS "affectedRows" FROM updated`

        if (Number(fisicoUpdate[0]?.affectedRows ?? 0) === 1) {
          type FisicoDisplayRow = {
            numero_secuencia: number
            lote_id: string
            categoria_nombre: string | null
            evento_nombre: string | null
          }
          const fisicoRows = await prisma.$queryRaw<FisicoDisplayRow[]>`
            SELECT tf.numero_secuencia, tf.lote_id,
                   ec.nombre AS categoria_nombre,
                   ev.nombre AS evento_nombre
            FROM ticket_fisicos tf
            INNER JOIN eventos ev ON ev.id = tf.evento_id
            LEFT JOIN entrada_categorias ec ON ec.id = tf.categoria_id
            WHERE (tf.qr_code = ${input.codigo} OR tf.clave_corta = ${input.codigo})
              AND tf.evento_id = ${input.evento_id}
              AND ev.empresa_id = ${empresaId}
            LIMIT 1`

          if (empresaId && actorUserId) {
            await logEmpleadoActividad({
              empresaId,
              empleadoId: actorUserId,
              tipo: 'escaneo',
              descripcion: 'Ticket físico escaneado',
              metadata: { evento_id: input.evento_id, codigo: input.codigo, tipo: 'fisico' },
            })
          }

          return res.status(200).json({
            ok: true,
            tipo: 'fisico',
            categoria: fisicoRows[0]?.categoria_nombre ?? null,
            evento: fisicoRows[0]?.evento_nombre ?? null,
            numero_secuencia: fisicoRows[0]?.numero_secuencia ?? null,
          })
        }

        // Check if the physical ticket exists but is already used / annulled.
        type FisicoExistingRow = {
          estado: string
          numero_secuencia: number
          usada_at: string | null
          used_by_user_name: string | null
        }
        const fisicoExisting = await prisma.$queryRaw<FisicoExistingRow[]>`
          SELECT tf.estado, tf.numero_secuencia, tf.usada_at, tf.used_by_user_name
          FROM ticket_fisicos tf
          INNER JOIN eventos ev ON ev.id = tf.evento_id
          WHERE (tf.qr_code = ${input.codigo} OR tf.clave_corta = ${input.codigo})
            AND tf.evento_id = ${input.evento_id}
            AND ev.empresa_id = ${empresaId}
          LIMIT 1`

        if (fisicoExisting[0]) {
          const existing = fisicoExisting[0]
          if (existing.estado === 'usada') {
            if (empresaId && actorUserId) {
              void logEmpleadoActividad({
                empresaId,
                empleadoId: actorUserId,
                tipo: 'escaneo_fallido',
                descripcion: 'Ticket físico ya utilizado',
                metadata: { evento_id: input.evento_id, codigo: input.codigo, motivo: 'ya_usada', tipo: 'fisico' },
              })
            }
            return res.status(200).json({
              ok: false,
              tipo: 'fisico',
              motivo: 'Ticket físico ya utilizado',
              numero_secuencia: existing.numero_secuencia,
              usada_at: existing.usada_at ?? null,
              used_by_user_name: existing.used_by_user_name ?? null,
            })
          }
          if (existing.estado === 'anulada') {
            if (empresaId && actorUserId) {
              void logEmpleadoActividad({
                empresaId,
                empleadoId: actorUserId,
                tipo: 'escaneo_fallido',
                descripcion: 'Ticket físico anulado',
                metadata: { evento_id: input.evento_id, codigo: input.codigo, motivo: 'anulada', tipo: 'fisico' },
              })
            }
            return res.status(200).json({
              ok: false,
              tipo: 'fisico',
              motivo: 'Ticket físico anulado',
              numero_secuencia: existing.numero_secuencia,
            })
          }
        }
        // Fallback adicional: addon_ventas (parking, meet&greet, merch).
        // Mismo patrón atómico que entradas/tickets físicos.
        const addonUpdate = await prismaDirectUrl.$queryRaw<UpdateResult>`
          WITH updated AS (
            UPDATE evento_addon_ventas av
            SET estado = 'usada',
                usada_at = NOW(),
                used_by_user_id = ${actorUserId},
                used_by_user_name = ${actorUserName}
            FROM eventos ev
            WHERE ev.id = av.evento_id
              AND (av.qr_code = ${input.codigo} OR av.clave_corta = ${input.codigo})
              AND av.evento_id = ${input.evento_id}
              AND ev.empresa_id = ${empresaId}
              AND av.estado = 'valida'
            RETURNING 1 AS affected
          )
          SELECT COUNT(*)::int AS "affectedRows" FROM updated`

        if (Number(addonUpdate[0]?.affectedRows ?? 0) === 1) {
          type AddonDisplayRow = {
            nombre: string
            evento_nombre: string | null
          }
          const addonRows = await prisma.$queryRaw<AddonDisplayRow[]>`
            SELECT ad.nombre, ev.nombre AS evento_nombre
            FROM evento_addon_ventas av
            INNER JOIN evento_addons ad ON ad.id = av.addon_id
            INNER JOIN eventos ev ON ev.id = av.evento_id
            WHERE (av.qr_code = ${input.codigo} OR av.clave_corta = ${input.codigo})
              AND av.evento_id = ${input.evento_id}
              AND ev.empresa_id = ${empresaId}
            LIMIT 1`

          if (empresaId && actorUserId) {
            await logEmpleadoActividad({
              empresaId,
              empleadoId: actorUserId,
              tipo: 'escaneo',
              descripcion: 'Addon escaneado',
              metadata: { evento_id: input.evento_id, codigo: input.codigo, tipo: 'addon' },
            })
          }

          return res.status(200).json({
            ok: true,
            tipo: 'addon',
            categoria: addonRows[0]?.nombre ?? null,
            evento: addonRows[0]?.evento_nombre ?? null,
          })
        }

        // Diagnostic for addon that exists but is 'usada' or 'cancelada'
        type AddonExistingRow = { estado: string; usada_at: string | null; used_by_user_name: string | null; nombre: string }
        const addonExisting = await prisma.$queryRaw<AddonExistingRow[]>`
          SELECT av.estado, av.usada_at, av.used_by_user_name, ad.nombre
          FROM evento_addon_ventas av
          INNER JOIN evento_addons ad ON ad.id = av.addon_id
          INNER JOIN eventos ev ON ev.id = av.evento_id
          WHERE (av.qr_code = ${input.codigo} OR av.clave_corta = ${input.codigo})
            AND av.evento_id = ${input.evento_id}
            AND ev.empresa_id = ${empresaId}
          LIMIT 1`

        if (addonExisting[0]) {
          const existing = addonExisting[0]
          if (existing.estado === 'usada') {
            return res.status(200).json({
              ok: false,
              tipo: 'addon',
              motivo: 'Adicional ya utilizado',
              categoria: existing.nombre,
              usada_at: existing.usada_at ?? null,
              used_by_user_name: existing.used_by_user_name ?? null,
            })
          }
        }
        // Falls through to digital-ticket diagnostics below
      }

      // Query 2: traer datos de display (success) o diagnóstico (fail).
      type EntradaRow = {
        estado: string
        usada_at: string | null
        used_by_user_name: string | null
        categoria_nombre: string | null
        evento_nombre: string | null
        comprador_nombre: string | null
        comprador_dni: string | null
        asiento_id: string | null
        asiento_fila: string | null
        asiento_numero: number | null
      }
      const rows = await prisma.$queryRaw<EntradaRow[]>`
        SELECT en.estado,
               en.usada_at,
               en.used_by_user_name,
               ec.nombre AS categoria_nombre,
               ev.nombre AS evento_nombre,
               c.nombre AS comprador_nombre,
               c.dni AS comprador_dni,
               en.asiento_id,
               a.fila AS asiento_fila,
               a.numero AS asiento_numero
        FROM entradas en
        INNER JOIN eventos ev ON ev.id = en.evento_id
        LEFT JOIN entrada_categorias ec ON ec.id = en.categoria_id
        LEFT JOIN compradores c ON c.id = en.comprador_id
        LEFT JOIN asientos a ON a.id = en.asiento_id
        WHERE (en.qr_code = ${input.codigo} OR en.clave_corta = ${input.codigo})
          AND en.evento_id = ${input.evento_id}
          AND ev.empresa_id = ${empresaId}
        LIMIT 1`

      const entrada = rows[0]

      // Caso 1: UPDATE no modificó nada (affectedRows = 0)
      if (affectedRows === 0) {
        if (!entrada) {
          if (empresaId && actorUserId) {
            void logEmpleadoActividad({
              empresaId,
              empleadoId: actorUserId,
              tipo: 'escaneo_fallido',
              descripcion: 'Código no encontrado',
              metadata: { evento_id: input.evento_id, codigo: input.codigo, motivo: 'no_encontrada' },
            })
          }
          return res.status(200).json({ ok: false, motivo: 'Entrada no encontrada' })
        }

        if (entrada.estado === 'usada') {
          if (empresaId && actorUserId) {
            void logEmpleadoActividad({
              empresaId,
              empleadoId: actorUserId,
              tipo: 'escaneo_fallido',
              descripcion: 'Entrada ya utilizada',
              metadata: { evento_id: input.evento_id, codigo: input.codigo, motivo: 'ya_usada' },
            })
          }
          return res.status(200).json({
            ok: false,
            motivo: 'Entrada ya utilizada',
            comprador: entrada.comprador_nombre,
            categoria: entrada.categoria_nombre,
            usada_at: entrada.usada_at ?? null,
            used_by_user_name: entrada.used_by_user_name ?? null,
          })
        }

        if (entrada.estado === 'cancelada') {
          if (empresaId && actorUserId) {
            void logEmpleadoActividad({
              empresaId,
              empleadoId: actorUserId,
              tipo: 'escaneo_fallido',
              descripcion: 'Entrada cancelada',
              metadata: { evento_id: input.evento_id, codigo: input.codigo, motivo: 'cancelada' },
            })
          }
          return res.status(200).json({ ok: false, motivo: 'Entrada cancelada' })
        }

        // Estado inesperado (futuro: 'reembolsada', etc.)
        return res.status(200).json({
          ok: false,
          motivo: `Entrada en estado ${String(entrada.estado)}`,
        })
      }

      // Caso 2: éxito — affectedRows = 1
      if (empresaId && actorUserId) {
        await logEmpleadoActividad({
          empresaId,
          empleadoId: actorUserId,
          tipo: 'escaneo',
          descripcion: `Entrada escaneada en evento`,
          metadata: { evento_id: input.evento_id, codigo: input.codigo },
        })
      }

      return res.status(200).json({
        ok: true,
        comprador: entrada?.comprador_nombre ?? null,
        dni: entrada?.comprador_dni ?? null,
        categoria: entrada?.categoria_nombre ?? null,
        evento: entrada?.evento_nombre ?? null,
        asiento_id: entrada?.asiento_id ?? null,
        asiento_fila: entrada?.asiento_fila ?? null,
        asiento_numero: entrada?.asiento_numero ?? null,
      })
    } catch {
      logServerError('escanear post')
      return res.status(500).json({ error: 'Error interno del servidor' })
    }
  },
)

/**
 * GET /escanear/stats?evento_id=...
 *
 * Stats en vivo para el escaneo de un evento. Frontend hace polling cada N
 * segundos para mostrar progreso ("X de Y entradas usadas", actividad última hora).
 *
 * Una query única con agregaciones — barato, indexado por evento_id + estado.
 */
router.get(
  '/stats',
  verifyInternal,
  requireAuth,
  requirePermissionMiddleware('escanear'),
  async (req: Request, res: Response) => {
    try {
      const empresaId = getActorEmpresaId(req.user!)
      if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })

      const eventoId = typeof req.query.evento_id === 'string' ? req.query.evento_id.trim() : ''
      if (!eventoId) {
        return res.status(400).json({ error: 'evento_id es requerido' })
      }

      // Validar que el evento pertenece a la empresa del actor
      const evento = await prisma.evento.findFirst({
        where: { id: eventoId, empresa_id: empresaId },
        select: { id: true, nombre: true },
      })
      if (!evento) {
        return res.status(404).json({ error: 'Evento no encontrado' })
      }

      type StatsRow = {
        total: number
        validas: number
        usadas: number
        canceladas: number
        usadas_ultima_hora: number
        usadas_ultimos_5_min: number
        ultima_usada_at: string | null
      }
      const statsRows = await prisma.$queryRaw<StatsRow[]>`
        SELECT
          COUNT(*)::int AS total,
          SUM(CASE WHEN estado = 'valida' THEN 1 ELSE 0 END)::int AS validas,
          SUM(CASE WHEN estado = 'usada' THEN 1 ELSE 0 END)::int AS usadas,
          SUM(CASE WHEN estado = 'cancelada' THEN 1 ELSE 0 END)::int AS canceladas,
          SUM(CASE WHEN estado = 'usada' AND usada_at >= NOW() - INTERVAL '1 hour' THEN 1 ELSE 0 END)::int AS usadas_ultima_hora,
          SUM(CASE WHEN estado = 'usada' AND usada_at >= NOW() - INTERVAL '5 minutes' THEN 1 ELSE 0 END)::int AS usadas_ultimos_5_min,
          MAX(usada_at) AS ultima_usada_at
        FROM entradas
        WHERE evento_id = ${eventoId}`
      const stats = statsRows[0] ?? {}

      const total = Number(stats.total ?? 0)
      const validas = Number(stats.validas ?? 0)
      const usadas = Number(stats.usadas ?? 0)
      const canceladas = Number(stats.canceladas ?? 0)
      // "Pendientes" = todas las que aún podrían escanearse (válidas no canceladas)
      const pendientes = validas
      // Porcentaje de check-in: usadas / (total - canceladas)
      const escaneables = total - canceladas
      const porcentajeCheckIn = escaneables > 0 ? Math.round((usadas / escaneables) * 100) : 0

      return res.json({
        data: {
          evento: { id: String(evento.id), nombre: String(evento.nombre) },
          total,
          validas,
          usadas,
          canceladas,
          pendientes,
          porcentaje_check_in: porcentajeCheckIn,
          usadas_ultima_hora: Number(stats.usadas_ultima_hora ?? 0),
          usadas_ultimos_5_min: Number(stats.usadas_ultimos_5_min ?? 0),
          ultima_usada_at: stats.ultima_usada_at ?? null,
          server_time: new Date().toISOString(),
        },
      })
    } catch {
      logServerError('escanear stats')
      return res.status(500).json({ error: 'Error interno del servidor' })
    }
  },
)

/**
 * GET /escanear/export?evento_id=...&format=xlsx|csv&escaneador=...&desde=...&hasta=...
 *
 * Exporta el historial de escaneos de un evento en formato Excel o CSV.
 * Requiere permiso 'exportar'. Máximo 20.000 filas.
 */
router.get(
  '/export',
  verifyInternal,
  requireAuth,
  requirePermissionMiddleware('exportar'),
  async (req: Request, res: Response) => {
    try {
      const user = req.user!
      const empresaId = getActorEmpresaId(user)
      if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })

      const eventoId = typeof req.query.evento_id === 'string' && req.query.evento_id.trim()
        ? req.query.evento_id.trim() : null
      const escaneador = typeof req.query.escaneador === 'string' && req.query.escaneador.trim()
        ? req.query.escaneador.trim() : null
      const desde = typeof req.query.desde === 'string' && req.query.desde.trim()
        ? req.query.desde.trim() : null
      const hasta = typeof req.query.hasta === 'string' && req.query.hasta.trim()
        ? req.query.hasta.trim() : null
      const format = req.query.format === 'xlsx' ? 'xlsx' : 'csv'

      type ExportRow = {
        fecha_escaneo: string | null
        hora_escaneo: string | null
        comprador_nombre: string | null
        comprador_apellido: string | null
        comprador_dni: string | null
        categoria: string | null
        evento: string | null
        clave_corta: string | null
        escaneado_por: string | null
      }

      // Build conditional filter clauses using Prisma.sql for safe parameterization
      const eventoFilter = eventoId ? Prisma.sql`AND en.evento_id = ${eventoId}` : Prisma.empty
      const escaneadorFilter = escaneador
        ? Prisma.sql`AND en.used_by_user_name ILIKE ${'%' + escaneador + '%'}`
        : Prisma.empty
      const desdeFilter = desde ? Prisma.sql`AND en.usada_at >= ${desde}::timestamptz` : Prisma.empty
      const hastaFilter = hasta
        ? Prisma.sql`AND en.usada_at < (${hasta}::timestamptz + INTERVAL '1 day')`
        : Prisma.empty

      const rows = await prisma.$queryRaw<ExportRow[]>`
        SELECT
          TO_CHAR(en.usada_at AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD')     AS fecha_escaneo,
          TO_CHAR(en.usada_at AT TIME ZONE 'America/Argentina/Buenos_Aires', 'HH24:MI:SS')     AS hora_escaneo,
          c.nombre                                AS comprador_nombre,
          c.apellido                              AS comprador_apellido,
          c.dni                                   AS comprador_dni,
          ec.nombre                               AS categoria,
          ev.nombre                               AS evento,
          en.clave_corta,
          en.used_by_user_name                    AS escaneado_por
        FROM entradas en
        INNER JOIN eventos ev ON ev.id = en.evento_id
        LEFT JOIN entrada_categorias ec ON ec.id = en.categoria_id
        LEFT JOIN compradores c ON c.id = en.comprador_id
        WHERE ev.empresa_id = ${empresaId}
          AND en.estado = 'usada'
          AND en.usada_at IS NOT NULL
          ${eventoFilter}
          ${escaneadorFilter}
          ${desdeFilter}
          ${hastaFilter}
        ORDER BY en.usada_at DESC
        LIMIT 20000`

      const exportRows = rows.map((r) => ({
        fecha_escaneo: r.fecha_escaneo ? String(r.fecha_escaneo).slice(0, 10) : '',
        hora_escaneo: r.hora_escaneo ? String(r.hora_escaneo).slice(0, 8) : '',
        comprador_nombre: r.comprador_nombre ?? '',
        comprador_apellido: r.comprador_apellido ?? '',
        comprador_dni: r.comprador_dni ?? '',
        categoria: r.categoria ?? '',
        evento: r.evento ?? '',
        clave_corta: r.clave_corta ?? '',
        escaneado_por: r.escaneado_por ?? '',
      }))

      if (format === 'xlsx') {
        const buffer = await buildEscanearWorkbookBuffer(exportRows, [...ESCANEAR_EXPORT_COLUMNS])
        res.setHeader('Content-Type', ESCANEAR_EXPORT_CONTENT_TYPE)
        res.setHeader('Content-Disposition', `attachment; filename="${buildEscanearExportFilename()}"`)
        return res.status(200).send(buffer)
      }

      // CSV — usa safeCsvCell para prevenir formula injection en campos del usuario
      const labels: Record<string, string> = {
        fecha_escaneo: 'Fecha', hora_escaneo: 'Hora',
        comprador_nombre: 'Nombre', comprador_apellido: 'Apellido',
        comprador_dni: 'DNI', categoria: 'Categoría',
        evento: 'Evento', clave_corta: 'Clave corta',
        escaneado_por: 'Escaneado por',
      }
      const header = ESCANEAR_EXPORT_COLUMNS.map((col) => safeCsvCell(labels[col] ?? col)).join(',')

      const csvRows = exportRows.map((r) =>
        ESCANEAR_EXPORT_COLUMNS.map((col) => safeCsvCell(r[col as keyof typeof r])).join(',')
      )

      const csv = [header, ...csvRows].join('\n')
      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader('Content-Disposition', `attachment; filename="${buildEscanearCsvExportFilename()}"`)
      return res.status(200).send(csv)
    } catch {
      logServerError('escanear export')
      return res.status(500).json({ error: 'Error interno del servidor' })
    }
  }
)

router.get(
  '/cache',
  cacheExportRateLimit,
  verifyInternal,
  requireAuth,
  requirePermissionMiddleware('escanear'),
  async (req: Request, res: Response) => {
    try {
      const empresaId = getActorEmpresaId(req.user!)
      if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })

      const eventoId = typeof req.query.evento_id === 'string' ? req.query.evento_id.trim() : ''
      if (!eventoId) {
        return res.status(400).json({ error: 'evento_id es requerido' })
      }

      const evento = await prisma.evento.findFirst({
        where: { id: eventoId, empresa_id: empresaId },
        select: { id: true },
      })
      if (!evento) {
        return res.status(404).json({ error: 'Evento no encontrado' })
      }

      type CountRow = { total: number }
      const countRows = await prisma.$queryRaw<CountRow[]>`
        SELECT COUNT(*)::int AS total FROM entradas WHERE evento_id = ${eventoId}`
      if (Number(countRows[0]?.total ?? 0) > 5000) {
        return res.status(400).json({ error: 'Evento demasiado grande para exportar. Usá paginación.' })
      }

      type CacheRow = {
        qr_code: string
        clave_corta: string
        comprador: string | null
        dni: string | null
        categoria: string | null
        estado: string
      }
      const rows = await prisma.$queryRaw<CacheRow[]>`
        SELECT en.qr_code, en.clave_corta,
               c.nombre AS comprador, c.dni,
               ec.nombre AS categoria,
               en.estado
        FROM entradas en
        LEFT JOIN entrada_categorias ec ON ec.id = en.categoria_id
        LEFT JOIN compradores c ON c.id = en.comprador_id
        WHERE en.evento_id = ${eventoId}
        ORDER BY en.created_at ASC`

      return res.json({
        data: rows.map((r) => ({
          qr_code: r.qr_code,
          clave_corta: r.clave_corta,
          comprador: r.comprador ?? null,
          dni: r.dni || null,
          categoria: r.categoria ?? null,
          estado: r.estado,
        })),
        evento_id: eventoId,
        generado_at: new Date().toISOString(),
        total: rows.length,
      })
    } catch {
      logServerError('escanear cache')
      return res.status(500).json({ error: 'Error interno del servidor' })
    }
  },
)

export default router
