import { Router, Request, Response } from 'express'
import { verifyInternal, requireAuth } from '../middleware/auth'
import { randomUUID as uuidv4 } from 'node:crypto'
import type { Permisos } from '../lib/permisos'
import { Prisma } from '@prisma/client'
import { getActorEmpresaId, requireAnyPermission, requirePermission, requirePermissionMiddleware } from '../lib/authz'
import { logServerError } from '../lib/safe-log'
import { safeCsvCell } from '../lib/csv-escape'
import { prisma, prismaDirectUrl } from '../lib/prisma'
import { revalidateVidriera } from '../lib/revalidate-vidriera'
import {
  buildLiquidacionWorkbook,
  buildLiquidacionExportFilename,
  LIQUIDACION_EXPORT_CONTENT_TYPE,
  type LiquidacionRow,
} from '../lib/liquidacion-export-workbook'
import {
  buildEventPublicationSnapshot,
  DEFAULT_EVENT_PUBLICATION_TIMEZONE,
  type EventPublicationSource,
  formatUtcDateTimeForInput,
  formatUtcDateTimeForSql,
  isValidIanaTimeZone,
  normalizePrePublishVisibility,
  normalizePublicationMode,
  zonedLocalDateTimeToUtc,
} from '../lib/event-publication'
import { parseCheckoutSessionData, type CheckoutSessionData } from './tenant'

const router = Router()
const HARD_LIMIT = 500
const DEFAULT_PAGE_SIZE = 25
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_STOCK_INCREMENT = 10000
export const MAX_CATEGORY_PRICE = 10_000_000
// eventos.nombre y eventos.lugar son VarChar(191) en el schema (backend/prisma/schema.prisma).
// Sin este chequeo, un valor más largo pasa el trim y explota recién en el INSERT/UPDATE raw
// con un error de Postgres que llega al cliente como 500 genérico en vez de un 400 claro.
const EVENTO_TEXT_FIELD_MAX_LENGTH = 191
const EVENTO_CIUDAD_MAX_LENGTH = 100

export class EventoValidationError extends Error {}

// Señal interna para abortar el UPDATE con 409 (conflicto de estado, no input inválido) sin
// perder el mensaje — separada de EventoValidationError porque esa mapea a 400.
class TipoMapaConVentasError extends Error {}

// Señal interna para abortar el DELETE con 409 cuando hay checkout_sessions activas
// (pago en curso vía Mercado Pago, todavía no confirmado ni expirado) — separada de
// EventoValidationError porque esa mapea a 400.
class EventoCheckoutsActivosError extends Error {}

// checkout_sessions NO tiene columna evento_id — el/los evento(s) del carrito viven
// dentro del JSON `datos` (items / itemsEntradas / itemsConsumibles / addons, cada uno
// con su propio eventoId; el flow 'mixto' puede traer entradas y consumibles del mismo
// carrito). Reusamos el parser de tenant.ts en vez de reimplementar el shape del JSON.
function sessionReferencesEvento(sessionData: CheckoutSessionData, eventoId: string): boolean {
  if (sessionData.flow === 'mixto') {
    return (
      sessionData.itemsEntradas.some((item) => item.eventoId === eventoId) ||
      sessionData.itemsConsumibles.some((item) => item.eventoId === eventoId) ||
      (sessionData.addons ?? []).some((addon) => addon.eventoId === eventoId)
    )
  }
  if (sessionData.flow === 'consumibles') {
    return sessionData.items.some((item) => item.eventoId === eventoId)
  }
  return (
    sessionData.items.some((item) => item.eventoId === eventoId) ||
    (sessionData.addons ?? []).some((addon) => addon.eventoId === eventoId)
  )
}

// Strategy A — retry on P2034 serialization failure. Mismo patrón (duplicado a propósito,
// no hay export compartido) que tenant.ts / vender.ts / consumibles-redeem.ts / refund-manual.ts.
// Exported for isolated unit testing only — not intended for reuse from other modules.
export async function withSerializableRetry<T>(fn: () => Promise<T>, retries = 3, backoffMs = 100): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      const isPrismaSerializationError =
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code?: string }).code === 'P2034'
      if (isPrismaSerializationError && attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, backoffMs * (attempt + 1)))
        continue
      }
      throw err
    }
  }
  throw new Error('withSerializableRetry: unreachable')
}

async function ensureEventoConsumiblesColumns() {
  // Phase 4: column `venta_consumibles_habilitada` is now in prisma/schema.prisma
  // (model Evento). No runtime DDL needed — Prisma migrations handle it.
  // Kept as a no-op so existing callers do not need to change.
  return
}

function parsePositiveInteger(value: unknown, fieldName: string, max: number) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new EventoValidationError(`${fieldName} debe ser un entero mayor a 0`)
  }
  if (parsed > max) {
    throw new EventoValidationError(`${fieldName} supera el máximo permitido`)
  }
  return parsed
}

function parsePositivePrice(value: unknown, fieldName: string, max: number) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new EventoValidationError(`${fieldName} debe ser mayor a 0`)
  }
  if (parsed > max) {
    throw new EventoValidationError(`${fieldName} supera el máximo permitido`)
  }
  return Math.round((parsed + Number.EPSILON) * 100) / 100
}

export type EventoTandaInput = {
  id?: string
  temp_id?: string
  nombre: string
  descripcion?: string | null
  imagen_url?: string | null
  estado?: 'activa' | 'proxima' | 'inactiva' | 'agotada'
  orden?: number
  activa_desde?: string | null
}

export type EventoCategoriaInput = {
  id: string
  nombre: string
  descripcion?: string | null
  imagen_url?: string | null
  precio: number | string
  stock: number | string
  tanda_id?: string | null
  entradas_por_unidad?: number | string | null
}

export type EventoFechaInput = {
  id?: string
  fecha: string
}

export type EventoPublicationPolicyInput = {
  publicationMode: 'immediate' | 'scheduled'
  prePublishVisibility: 'hidden' | 'listado_solo' | 'detail_visible'
  publishAtUtc: string | null
  publishTimezone: string | null
  publishedLiveAt: string | null
}

function isModoFechaValido(value: unknown): value is 'unica' | 'multiple' {
  return value === 'unica' || value === 'multiple'
}

export function isTipoMapaValido(value: unknown): value is 'libre' | 'numerado' {
  return value === 'libre' || value === 'numerado'
}

function isUuid(value?: string | null) {
  return !!value && UUID_REGEX.test(value)
}

function normalizeTandas(input: unknown): EventoTandaInput[] {
  if (!Array.isArray(input)) return []

  return input
    .map((item) => {
      const tanda = item as Record<string, unknown>
      return {
        id: typeof tanda.id === 'string' ? tanda.id : undefined,
        temp_id: typeof tanda.temp_id === 'string' ? tanda.temp_id : undefined,
        nombre: typeof tanda.nombre === 'string' ? tanda.nombre.trim() : '',
        descripcion: typeof tanda.descripcion === 'string' ? tanda.descripcion.trim() : null,
        imagen_url: typeof tanda.imagen_url === 'string' ? tanda.imagen_url.trim() : null,
        estado:
          tanda.estado === 'activa' ||
          tanda.estado === 'proxima' ||
          tanda.estado === 'inactiva' ||
          tanda.estado === 'agotada'
            ? (tanda.estado as EventoTandaInput['estado'])
            : 'inactiva',
        orden: Number(tanda.orden) || 0,
        activa_desde:
          typeof tanda.activa_desde === 'string' && tanda.activa_desde.trim()
            ? tanda.activa_desde
            : null,
      }
    })
    .filter((tanda) => tanda.nombre)
}

function normalizeCategorias(input: unknown): EventoCategoriaInput[] {
  if (!Array.isArray(input)) return []

  return input.map((item) => {
    const categoria = item as Record<string, unknown>
    return {
      id: typeof categoria.id === 'string' ? categoria.id : uuidv4(),
      nombre: typeof categoria.nombre === 'string' ? categoria.nombre.trim() : '',
      descripcion: typeof categoria.descripcion === 'string' ? categoria.descripcion.trim() : null,
      imagen_url:
        typeof categoria.imagen_url === 'string' && categoria.imagen_url.trim()
          ? categoria.imagen_url.trim()
          : null,
      precio: Number.isFinite(Number(categoria.precio)) ? Number(categoria.precio) : -1,
      stock: Number.isFinite(Number(categoria.stock)) ? Number(categoria.stock) : -1,
      tanda_id:
        typeof categoria.tanda_id === 'string' && categoria.tanda_id.trim()
          ? categoria.tanda_id
          : null,
      entradas_por_unidad:
        Number.isFinite(Number(categoria.entradas_por_unidad))
          ? Math.max(1, Math.min(10, Number(categoria.entradas_por_unidad)))
          : 1,
    }
  })
}

function normalizeFechas(input: unknown): EventoFechaInput[] {
  if (!Array.isArray(input)) return []

  return input
    .map((item) => {
      const fecha = item as Record<string, unknown>
      return {
        id: typeof fecha.id === 'string' ? fecha.id : undefined,
        fecha: typeof fecha.fecha === 'string' ? fecha.fecha : '',
      }
    })
    .filter((fecha) => fecha.fecha)
}

/**
 * El form manda `fecha` como un datetime-local naive (ej. "2026-08-20T22:00"), sin
 * offset, asumiendo que representa hora de Argentina. Esta función lo interpreta
 * explícitamente como America/Argentina/Buenos_Aires y devuelve el instante UTC
 * correspondiente — mismo patrón que zonedLocalDateTimeToUtc ya usa para
 * publish_date_local/publish_time_local en normalizeEventoPublicationPolicy.
 */
export function parseEventoFechaToUtc(fechaLocal: string): Date {
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(fechaLocal.trim())
  if (!match) {
    throw new EventoValidationError('La fecha del evento no es válida')
  }

  const [, datePart, timePart] = match
  const utcDate = zonedLocalDateTimeToUtc(datePart, timePart, DEFAULT_EVENT_PUBLICATION_TIMEZONE)
  if (!utcDate) {
    throw new EventoValidationError('La fecha del evento no es válida')
  }

  return utcDate
}

/**
 * Valida que las fechas NUEVAS (sin id existente en DB) no sean pasadas. Las fechas
 * que ya existían (isUuid(fecha.id)) no se re-validan aunque ya hayan pasado — eso
 * permite seguir editando eventos ya finalizados (nombre, descripción, stock, etc.)
 * sin que el guardado se caiga por una fecha vieja que no se está tocando.
 */
/**
 * `activa_desde` de una tanda tiene el mismo problema que `fecha` tenía: llega como
 * datetime-local naive en hora AR y la columna es timestamptz. La convertimos
 * explícitamente antes de que Postgres la interprete con el timezone de sesión.
 * `null`/vacío se preserva tal cual (tanda sin activación programada).
 */
export function formatActivaDesdeForSql(activaDesde: string | null | undefined): string | null {
  if (!activaDesde || !activaDesde.trim()) return null
  return formatUtcDateTimeForSql(parseEventoFechaToUtc(activaDesde))
}

export function validateFechasNoPasadas(fechas: EventoFechaInput[]) {
  const now = Date.now()
  for (const fecha of fechas) {
    if (isUuid(fecha.id)) continue
    const utcDate = parseEventoFechaToUtc(fecha.fecha)
    if (utcDate.getTime() < now) {
      throw new EventoValidationError('La fecha del evento no puede ser en el pasado')
    }
  }
}

export function normalizeEventoPublicationPolicy(
  input: Record<string, unknown>,
  existingPublishAtUtc?: Date | null
): EventoPublicationPolicyInput {
  const publicationMode = normalizePublicationMode(input.publication_mode)
  const prePublishVisibility = normalizePrePublishVisibility(input.pre_publish_visibility)

  if (publicationMode === 'immediate') {
    return {
      publicationMode,
      prePublishVisibility,
      publishAtUtc: null,
      publishTimezone: null,
      publishedLiveAt: null,
    }
  }

  const publishDateLocal = typeof input.publish_date_local === 'string' ? input.publish_date_local.trim() : ''
  const publishTimeLocal = typeof input.publish_time_local === 'string' ? input.publish_time_local.trim() : ''
  const publishTimezoneRaw = typeof input.publish_timezone === 'string' ? input.publish_timezone.trim() : ''
  const publishTimezone = publishTimezoneRaw || DEFAULT_EVENT_PUBLICATION_TIMEZONE

  if (!publishDateLocal || !publishTimeLocal) {
    throw new EventoValidationError('La publicación programada requiere fecha y hora')
  }

  if (!isValidIanaTimeZone(publishTimezone)) {
    throw new EventoValidationError('La zona horaria de publicación no es válida')
  }

  const publishAtUtcDate = zonedLocalDateTimeToUtc(publishDateLocal, publishTimeLocal, publishTimezone)
  if (!publishAtUtcDate) {
    throw new EventoValidationError('No se pudo normalizar la fecha de publicación programada')
  }

  // Mismo criterio que validateFechasNoPasadas para la fecha del evento: una publicación
  // programada en el pasado (typo, confusión de huso horario) no debe colarse — sin este
  // chequeo el evento queda publicado en vivo de inmediato sin ningún aviso al usuario.
  // PERO solo si es un valor NUEVO: si coincide con lo que ya estaba guardado (ej. se edita
  // un evento scheduled que ya está en vivo hace rato, sin tocar su publicación), no lo
  // re-rechazamos — si no, cualquier edición de ese evento quedaría bloqueada para siempre.
  const isUnchangedFromExisting =
    existingPublishAtUtc != null && existingPublishAtUtc.getTime() === publishAtUtcDate.getTime()
  if (!isUnchangedFromExisting && publishAtUtcDate.getTime() < Date.now()) {
    throw new EventoValidationError('La fecha de publicación programada no puede ser en el pasado')
  }

  const publishAtUtc = formatUtcDateTimeForSql(publishAtUtcDate)
  const publishedLiveAt = publishAtUtcDate.getTime() <= Date.now() ? publishAtUtc : null

  return {
    publicationMode,
    prePublishVisibility,
    publishAtUtc,
    publishTimezone,
    publishedLiveAt,
  }
}

// Campos del body que representan la política de publicación (ver EventoPublicationPolicyInput
// y normalizeEventoPublicationPolicy). Usado por PATCH /:id para distinguir "el caller no tocó
// la política" de "el caller la mandó explícita" — ver bodyHasPublicationPolicyFields.
const PUBLICATION_POLICY_BODY_KEYS = [
  'publication_mode',
  'pre_publish_visibility',
  'publish_date_local',
  'publish_time_local',
  'publish_timezone',
] as const

/**
 * PATCH /:id reconstruye la política de publicación completa desde el body en cada llamada.
 * Si el caller no manda NINGUNO de estos campos, normalizeEventoPublicationPolicy caería al
 * default ('immediate'), lo que resetearía silenciosamente un evento scheduled/hidden a
 * "publicado ya". Este helper permite al caller de PATCH detectar ese caso y preservar la
 * política ya guardada en DB en vez de aplicar el default.
 */
export function bodyHasPublicationPolicyFields(body: Record<string, unknown>): boolean {
  return PUBLICATION_POLICY_BODY_KEYS.some((key) => body[key] !== undefined)
}

function serializeEventoRow<T extends EventPublicationSource & { total_vendidas_financiero?: unknown; ingresos_bruto?: unknown; ingresos_neto?: unknown; ventas_7d?: unknown }>(row: T) {
  const snapshot = buildEventPublicationSnapshot(row)
  const localSchedule = formatUtcDateTimeForInput(snapshot.publication.publish_at_utc, snapshot.publication.publish_timezone)

  // Derive ticket_promedio_bruto and ticket_promedio_neto from raw DB fields (computed here, not in SQL)
  // total_vendidas_financiero is an internal compute field — not exposed directly in response
  // Both fields are included so the UI can show "bruto / neto" side by side
  const totalVendidas = Number(row.total_vendidas_financiero ?? 0)
  const ingresosBruto = Number(row.ingresos_bruto ?? 0)
  const ingresosNeto = Number(row.ingresos_neto ?? 0)
  const ticket_promedio_bruto = totalVendidas > 0 ? ingresosBruto / totalVendidas : null
  const ticket_promedio_neto = totalVendidas > 0 ? ingresosNeto / totalVendidas : null

  return {
    ...row,
    ...snapshot,
    publication: {
      ...snapshot.publication,
      ...localSchedule,
    },
    // Financial KPI fields (present only when en_financiero_stats JOIN is included)
    // undefined when not in SELECT (detail endpoint), number when list endpoint ran
    ingresos_bruto: 'ingresos_bruto' in row ? ingresosBruto : undefined,
    ingresos_neto: 'ingresos_neto' in row ? ingresosNeto : undefined,
    ventas_7d: 'ventas_7d' in row ? Number(row.ventas_7d ?? 0) : undefined,
    ticket_promedio_bruto: 'total_vendidas_financiero' in row ? ticket_promedio_bruto : undefined,
    ticket_promedio_neto: 'total_vendidas_financiero' in row ? ticket_promedio_neto : undefined,
    // Remove internal compute field from response
    total_vendidas_financiero: undefined,
  }
}

/**
 * Strip financial KPI fields for users without ver_kpis_eventos permission.
 * Sets fields to null (not delete) for predictable TypeScript shape.
 * Must be a module-level function so Phase 2 /comparar route can reuse it.
 */
function stripFinancialFields(row: Record<string, unknown>, canSeeKpis: boolean): Record<string, unknown> {
  if (!canSeeKpis) {
    row.ingresos_bruto = null
    row.ingresos_neto = null
    row.ticket_promedio_bruto = null
    row.ticket_promedio_neto = null
    row.ventas_7d = null
  }
  return row
}

export function validateTandas(tandas: EventoTandaInput[], categorias: EventoCategoriaInput[]) {
  const activas = tandas.filter((tanda) => tanda.estado === 'activa')
  if (activas.length > 1) {
    return 'Solo puede haber una tanda activa por evento en el MVP'
  }

  const refs = new Set(
    tandas.flatMap((tanda) => [tanda.id, tanda.temp_id].filter((value): value is string => !!value))
  )

  for (const categoria of categorias) {
    if (!categoria.nombre) {
      return 'Todas las categorías deben tener nombre'
    }

    const precio = Number(categoria.precio)
    if (!Number.isFinite(precio) || precio < 0) {
      return `El precio de la categoría "${categoria.nombre}" debe ser un número mayor o igual a 0`
    }
    // Mismo techo que usa parsePositivePrice en el endpoint de ajuste individual de precio
    // (línea ~2076). El piso se mantiene en >= 0 acá (a diferencia de parsePositivePrice,
    // que exige > 0) porque el wizard permite categorías gratuitas al crear/editar el evento.
    if (precio > MAX_CATEGORY_PRICE) {
      return `El precio de la categoría "${categoria.nombre}" supera el máximo permitido`
    }

    const stock = Number(categoria.stock)
    if (!Number.isInteger(stock) || stock <= 0 || stock > 100000) {
      return `El stock de la categoría "${categoria.nombre}" debe ser un entero mayor a 0 (máximo 100000)`
    }

    if (categoria.entradas_por_unidad !== undefined && categoria.entradas_por_unidad !== null && categoria.entradas_por_unidad !== '') {
      const epu = Number(categoria.entradas_por_unidad)
      if (!Number.isInteger(epu) || epu < 1 || epu > 10) {
        return `El campo "Pack" de la categoría "${categoria.nombre}" debe ser un entero entre 1 y 10`
      }
    }

    if (categoria.imagen_url) {
      try {
        const parsedUrl = new URL(String(categoria.imagen_url))
        if (parsedUrl.protocol !== 'https:') {
          return `La URL de imagen de la categoría "${categoria.nombre}" debe usar HTTPS`
        }
      } catch {
        return `La URL de imagen de la categoría "${categoria.nombre}" no es válida`
      }
    }

    if (categoria.tanda_id && !refs.has(categoria.tanda_id)) {
      return `La categoría "${categoria.nombre}" referencia una tanda inválida`
    }
  }

  if (activas.length === 1) {
    const refActiva = activas[0].id ?? activas[0].temp_id
    const categoriasActivas = categorias.filter((categoria) => categoria.tanda_id === refActiva)
    if (categoriasActivas.length === 0) {
      return 'La tanda activa debe tener al menos una categoría asociada'
    }
  }

  return null
}

async function syncTandas(tx: Prisma.TransactionClient, eventoId: string, tandas: EventoTandaInput[]) {
  const mapping = new Map<string, string>()

  const toUpdate: Array<{ resolvedId: string; tanda: EventoTandaInput; estado: string; orden: number }> = []
  const toInsert: Array<{ resolvedId: string; tanda: EventoTandaInput; estado: string; orden: number }> = []

  for (const [index, tanda] of tandas.entries()) {
    const resolvedId = isUuid(tanda.id) ? (tanda.id as string) : uuidv4()
    const estado = tanda.estado ?? 'inactiva'
    const orden = Number.isFinite(tanda.orden) ? Number(tanda.orden) : index

    if (isUuid(tanda.id)) {
      toUpdate.push({ resolvedId, tanda, estado, orden })
    } else {
      toInsert.push({ resolvedId, tanda, estado, orden })
    }

    if (tanda.id) mapping.set(tanda.id, resolvedId)
    if (tanda.temp_id) mapping.set(tanda.temp_id, resolvedId)
  }

  // Individual UPDATEs — each row has different column values, can't be bulk-updated safely
  for (const { resolvedId, tanda, estado, orden } of toUpdate) {
    const activaDesdeSql = formatActivaDesdeForSql(tanda.activa_desde)
    await tx.$executeRaw`
      UPDATE evento_tandas
      SET nombre = ${tanda.nombre}, descripcion = ${tanda.descripcion ?? null},
          imagen_url = ${tanda.imagen_url ?? null}, estado = ${estado},
          orden = ${orden}, activa_desde = ${activaDesdeSql}::timestamptz
      WHERE id = ${resolvedId} AND evento_id = ${eventoId}`
  }

  // Bulk INSERT for new tandas — use $executeRawUnsafe for dynamic VALUES list
  if (toInsert.length > 0) {
    const params: unknown[] = []
    let n = 0
    function p(v: unknown): string { params.push(v); return '$' + ++n }
    const placeholders = toInsert.map(({ resolvedId, tanda, estado, orden }) => {
      const activaDesdeSql = formatActivaDesdeForSql(tanda.activa_desde)
      return `(${p(resolvedId)}, ${p(eventoId)}, ${p(tanda.nombre)}, ${p(tanda.descripcion ?? null)}, ${p(tanda.imagen_url ?? null)}, ${p(estado)}, ${p(orden)}, ${p(activaDesdeSql)}::timestamptz)`
    }).join(', ')
    await tx.$executeRawUnsafe(
      `INSERT INTO evento_tandas (id, evento_id, nombre, descripcion, imagen_url, estado, orden, activa_desde) VALUES ${placeholders}`,
      ...params
    )
  }

  return mapping
}

async function pruneRemovedTandas(tx: Prisma.TransactionClient, eventoId: string, tandas: EventoTandaInput[]) {
  const keepIds = tandas.map((tanda) => tanda.id).filter((tandaId): tandaId is string => isUuid(tandaId))
  const existingRows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM evento_tandas WHERE evento_id = ${eventoId}`

  const deleteIds = existingRows
    .map((row) => String(row.id))
    .filter((tandaId) => !keepIds.includes(tandaId))

  if (deleteIds.length > 0) {
    await tx.$executeRaw`
      DELETE FROM evento_tandas WHERE evento_id = ${eventoId} AND id = ANY(${deleteIds}::text[])`
  }
}

async function syncFechas(tx: Prisma.TransactionClient, eventoId: string, fechas: EventoFechaInput[]) {
  const keepIds = fechas.map((fecha) => fecha.id).filter((fechaId): fechaId is string => isUuid(fechaId))
  const existingRows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM evento_fechas WHERE evento_id = ${eventoId}`

  const toUpdate = fechas.filter((fecha) => isUuid(fecha.id))
  const toInsert = fechas.filter((fecha) => !isUuid(fecha.id))

  // Individual UPDATEs — each row has a different fecha value.
  // fecha.fecha llega como datetime-local naive en hora AR: se convierte a UTC
  // explícitamente (parseEventoFechaToUtc) antes del cast ::timestamptz, para que
  // Postgres no lo interprete según el timezone de sesión de la conexión.
  for (const fecha of toUpdate) {
    const fechaUtcSql = formatUtcDateTimeForSql(parseEventoFechaToUtc(fecha.fecha))
    await tx.$executeRaw`
      UPDATE evento_fechas SET fecha = ${fechaUtcSql}::timestamptz WHERE id = ${fecha.id} AND evento_id = ${eventoId}`
  }

  // Bulk INSERT for new fechas — use $executeRawUnsafe for dynamic VALUES list
  if (toInsert.length > 0) {
    const params: unknown[] = []
    let n = 0
    function p(v: unknown): string { params.push(v); return '$' + ++n }
    const placeholders = toInsert.map((fecha) => {
      const fechaUtcSql = formatUtcDateTimeForSql(parseEventoFechaToUtc(fecha.fecha))
      return `(${p(uuidv4())}, ${p(eventoId)}, ${p(fechaUtcSql)}::timestamptz)`
    }).join(', ')
    await tx.$executeRawUnsafe(
      `INSERT INTO evento_fechas (id, evento_id, fecha) VALUES ${placeholders}`,
      ...params
    )
  }

  const deleteIds = existingRows
    .map((row) => String(row.id))
    .filter((id) => !keepIds.includes(id))

  if (deleteIds.length > 0) {
    const blockedRows = await tx.$queryRaw<{ fecha_id: string }[]>`
      SELECT fecha_id FROM entradas WHERE fecha_id = ANY(${deleteIds}::text[]) LIMIT 1`
    if (blockedRows.length > 0) {
      throw new EventoValidationError('No podés eliminar una fecha que ya tiene entradas emitidas')
    }
    await tx.$executeRaw`
      DELETE FROM evento_fechas WHERE evento_id = ${eventoId} AND id = ANY(${deleteIds}::text[])`
  }
}

async function syncCategorias(
  tx: Prisma.TransactionClient,
  eventoId: string,
  categorias: EventoCategoriaInput[],
  tandaMapping: Map<string, string>
) {
  const keepIds = categorias.map((categoria) => categoria.id).filter((categoriaId): categoriaId is string => isUuid(categoriaId))
  const existingRows = await tx.$queryRaw<{ id: string; nombre: string; stock: number; stock_disponible: number }[]>`
    SELECT id, nombre, stock, stock_disponible FROM entrada_categorias WHERE evento_id = ${eventoId}`

  const existingMap = new Map(existingRows.map((row) => [String(row.id), row]))

  const toInsertCategorias: Array<{
    id: string; tandaId: string | null; nombre: string; descripcion: string | null
    imagenUrl: string | null; precio: number; nuevoStock: number; entradasPorUnidad: number
  }> = []

  for (const categoria of categorias) {
    const tandaId = categoria.tanda_id ? tandaMapping.get(categoria.tanda_id) ?? categoria.tanda_id : null
    const nuevoStock = Number(categoria.stock)
    const entradasPorUnidad = Math.max(1, Math.min(10, Number(categoria.entradas_por_unidad ?? 1) || 1))
    const imagenUrl = categoria.imagen_url || null

    if (isUuid(categoria.id)) {
      const existing = existingMap.get(categoria.id)
      const stockActual = Number(existing?.stock ?? 0)
      const stockDisponibleActual = Number(existing?.stock_disponible ?? 0)
      const stockComprometido = Math.max(stockActual - stockDisponibleActual, 0)

      if (nuevoStock < stockComprometido) {
        throw new EventoValidationError(
          `La categoría "${categoria.nombre}" no puede quedar con menos stock que el ya comprometido (${stockComprometido})`
        )
      }

      // Individual UPDATEs — each row has different stock calculations
      await tx.$executeRaw`
        UPDATE entrada_categorias
        SET nombre = ${categoria.nombre}, descripcion = ${categoria.descripcion || null},
            imagen_url = ${imagenUrl},
            precio = ${Number(categoria.precio)}, stock = ${nuevoStock},
            stock_disponible = ${nuevoStock - stockComprometido}, tanda_id = ${tandaId},
            entradas_por_unidad = ${entradasPorUnidad}, activa = true
        WHERE id = ${categoria.id} AND evento_id = ${eventoId}`
      continue
    }

    toInsertCategorias.push({
      id: uuidv4(),
      tandaId,
      nombre: categoria.nombre,
      descripcion: categoria.descripcion || null,
      imagenUrl,
      precio: Number(categoria.precio),
      nuevoStock,
      entradasPorUnidad,
    })
  }

  // Bulk INSERT for new categorias — use $executeRawUnsafe for dynamic VALUES list
  if (toInsertCategorias.length > 0) {
    const params: unknown[] = []
    let n = 0
    function p(v: unknown): string { params.push(v); return '$' + ++n }
    const placeholders = toInsertCategorias.map(({ id, tandaId, nombre, descripcion, imagenUrl, precio, nuevoStock, entradasPorUnidad }) =>
      `(${p(id)}, ${p(eventoId)}, ${p(tandaId)}, ${p(nombre)}, ${p(descripcion)}, ${p(imagenUrl)}, ${p(precio)}, ${p(nuevoStock)}, ${p(nuevoStock)}, true, ${p(entradasPorUnidad)})`
    ).join(', ')
    await tx.$executeRawUnsafe(
      `INSERT INTO entrada_categorias (id, evento_id, tanda_id, nombre, descripcion, imagen_url, precio, stock, stock_disponible, activa, entradas_por_unidad) VALUES ${placeholders}`,
      ...params
    )
  }

  for (const row of existingRows) {
    const categoriaId = String(row.id)
    if (keepIds.includes(categoriaId)) continue

    const stockActual = Number(row.stock ?? 0)
    const stockDisponibleActual = Number(row.stock_disponible ?? 0)
    const stockComprometido = Math.max(stockActual - stockDisponibleActual, 0)

    if (stockComprometido > 0) {
      throw new EventoValidationError(
        `La categoría "${String(row.nombre)}" no puede eliminarse porque ya tiene stock comprometido o vendido`
      )
    }

    await tx.$executeRaw`DELETE FROM entrada_categorias WHERE id = ${categoriaId} AND evento_id = ${eventoId}`
  }
}

async function normalizeEstadosTandas(tx: Prisma.TransactionClient, eventoId: string) {
  const activeRows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM evento_tandas WHERE evento_id = ${eventoId} AND estado = 'activa' ORDER BY orden ASC, created_at ASC`

  if (activeRows.length <= 1) return

  const activeId = String(activeRows[0].id)
  await tx.$executeRaw`
    UPDATE evento_tandas
    SET estado = CASE
      WHEN id = ${activeId} THEN 'activa'
      WHEN estado = 'agotada' THEN 'agotada'
      ELSE 'proxima'
    END
    WHERE evento_id = ${eventoId}`
}

async function validateExistingTandaIds(eventoId: string, tandas: EventoTandaInput[]) {
  const existingIds = tandas.map((tanda) => tanda.id).filter((id): id is string => isUuid(id))
  if (existingIds.length === 0) return null

  // S1: prisma.$queryRawUnsafe — ANY(::text[]) replaces IN (?)
  const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `SELECT id FROM evento_tandas WHERE evento_id = $1 AND id = ANY($2::text[])`,
    eventoId,
    existingIds,
  )

  if (rows.length !== existingIds.length) {
    return 'Una o más tandas no pertenecen a este evento'
  }

  return null
}

const csvEscape = safeCsvCell

function formatMoneyForCsv(value: unknown): string {
  const num = Number(value ?? 0)
  if (!Number.isFinite(num)) return '0.00'
  return num.toFixed(2)
}

// GET /eventos/liquidacion/export — exporta liquidación financiera por evento
router.get('/liquidacion/export', verifyInternal, requireAuth, requirePermissionMiddleware('exportar'), async (req: Request, res: Response) => {
  try {
    const user = req.user!
    const esEmpleado = user.userType === 'empleado'
    const permisos = user.permisos as Permisos | undefined

    if (esEmpleado && !permisos?.ver_recaudacion) {
      return res.status(403).json({ error: 'Sin permiso para ver recaudación' })
    }

    const empresaId = esEmpleado ? user.empresa_id! : user.id
    if (!empresaId) return res.status(401).json({ error: 'No autorizado' })

    const format = req.query.format === 'xlsx' ? 'xlsx' : 'csv'
    const busqueda = typeof req.query.busqueda === 'string' ? req.query.busqueda.trim() : ''
    const desde = typeof req.query.desde === 'string' ? req.query.desde.trim() : ''
    const hasta = typeof req.query.hasta === 'string' ? req.query.hasta.trim() : ''
    const eventoId = typeof req.query.evento_id === 'string' && UUID_REGEX.test(req.query.evento_id.trim()) ? req.query.evento_id.trim() : ''
    const soloActivos = req.query.solo_activos === 'true'

    const fechaRegex = /^\d{4}-\d{2}-\d{2}$/
    const desdeValido = fechaRegex.test(desde) ? desde : ''
    const hastaValido = fechaRegex.test(hasta) ? hasta : ''

    // S2: build Postgres $n-indexed filter — liquidacion/export
    const sqlParams: unknown[] = []
    function nextParam(val: unknown): string {
      sqlParams.push(val)
      return `$${sqlParams.length}`
    }

    const filtrosEvento: string[] = [`e.empresa_id = ${nextParam(empresaId)}`]
    if (busqueda) {
      filtrosEvento.push(`e.nombre ILIKE ${nextParam(`%${busqueda}%`)}`)
    }
    if (eventoId) {
      filtrosEvento.push(`e.id = ${nextParam(eventoId)}`)
    }
    if (soloActivos) {
      filtrosEvento.push('e.activo = true')
    }
    const whereEvento = filtrosEvento.join(' AND ')

    const entradasDateClause: string[] = []
    const consumiblesDateClause: string[] = []

    // Filtro por día en hora AR: el rango (desde/hasta) que manda el usuario son días
    // calendario AR, así que el created_at (timestamptz UTC) se proyecta a AR antes de
    // tomar la fecha. Sin el AT TIME ZONE el día se corre (UTC vs UTC-3).
    if (desdeValido) {
      entradasDateClause.push(`DATE(en.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires') >= ${nextParam(desdeValido)}`)
      consumiblesDateClause.push(`DATE(cv.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires') >= ${nextParam(desdeValido)}`)
    }
    if (hastaValido) {
      entradasDateClause.push(`DATE(en.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires') <= ${nextParam(hastaValido)}`)
      consumiblesDateClause.push(`DATE(cv.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires') <= ${nextParam(hastaValido)}`)
    }

    const entradasWhere = entradasDateClause.length ? `WHERE ${entradasDateClause.join(' AND ')}` : ''
    const consumiblesWhere = consumiblesDateClause.length ? `WHERE ${consumiblesDateClause.join(' AND ')}` : ''

    const EXPORT_LIMIT = 5000
    const limitParam = nextParam(EXPORT_LIMIT)

    const sql = `
      SELECT
        e.id AS evento_id,
        e.nombre AS evento_nombre,
        e.activo AS evento_activo,
        e.created_at AS evento_created_at,
        COALESCE(en_stats.vendidas, 0) AS entradas_vendidas,
        COALESCE(en_stats.canceladas, 0) AS entradas_canceladas,
        COALESCE(en_stats.bruto, 0) AS entradas_bruto,
        COALESCE(en_stats.comision_platea, 0) AS entradas_comision_platea,
        COALESCE(en_stats.neto_empresa, 0) AS entradas_neto_empresa,
        COALESCE(cv_stats.vendidos, 0) AS consumibles_vendidos,
        COALESCE(cv_stats.cancelados, 0) AS consumibles_cancelados,
        COALESCE(cv_stats.bruto, 0) AS consumibles_bruto,
        COALESCE(cv_stats.comision_platea, 0) AS consumibles_comision_platea,
        COALESCE(cv_stats.neto_empresa, 0) AS consumibles_neto_empresa
      FROM eventos e
      LEFT JOIN (
        SELECT en.evento_id,
          COUNT(CASE WHEN en.estado <> 'cancelada' THEN 1 END) AS vendidas,
          COUNT(CASE WHEN en.estado = 'cancelada' THEN 1 END) AS canceladas,
          COALESCE(SUM(CASE WHEN en.estado <> 'cancelada' THEN en.precio_pagado ELSE 0 END), 0) AS bruto,
          COALESCE(SUM(CASE WHEN en.estado <> 'cancelada' THEN COALESCE(en.comision, 0) ELSE 0 END), 0) AS comision_platea,
          COALESCE(SUM(CASE WHEN en.estado <> 'cancelada' THEN en.precio_pagado - COALESCE(en.comision, 0) ELSE 0 END), 0) AS neto_empresa
        FROM entradas en
        ${entradasWhere}
        GROUP BY en.evento_id
      ) en_stats ON en_stats.evento_id = e.id
      LEFT JOIN (
        SELECT cv.evento_id,
          COUNT(CASE WHEN cv.estado <> 'cancelado' THEN 1 END) AS vendidos,
          COUNT(CASE WHEN cv.estado = 'cancelado' THEN 1 END) AS cancelados,
          COALESCE(SUM(CASE WHEN cv.estado = 'resuelto_parcial' THEN COALESCE(cv.delivered_amount, 0) WHEN cv.estado <> 'cancelado' THEN cv.total ELSE 0 END), 0) AS bruto,
          COALESCE(SUM(CASE WHEN cv.estado <> 'cancelado' THEN COALESCE(cv.owner_fee_amount, 0) ELSE 0 END), 0) AS comision_platea,
          COALESCE(SUM(CASE WHEN cv.estado = 'resuelto_parcial' THEN COALESCE(cv.delivered_amount, 0) - COALESCE(cv.owner_fee_amount, 0) WHEN cv.estado <> 'cancelado' THEN cv.total - COALESCE(cv.owner_fee_amount, 0) ELSE 0 END), 0) AS neto_empresa
        FROM consumibles_ventas cv
        ${consumiblesWhere}
        GROUP BY cv.evento_id
      ) cv_stats ON cv_stats.evento_id = e.id
      WHERE ${whereEvento}
      ORDER BY e.created_at DESC
      LIMIT ${limitParam}
    `

    const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...sqlParams)

    const headers = [
      'evento_id',
      'evento_nombre',
      'estado_evento',
      'evento_alta',
      'entradas_vendidas',
      'entradas_canceladas',
      'entradas_bruto',
      'entradas_comision_platea',
      'entradas_neto_empresa',
      'consumibles_vendidos',
      'consumibles_cancelados',
      'consumibles_bruto',
      'consumibles_comision_platea',
      'consumibles_neto_empresa',
      'total_bruto',
      'total_comision_platea',
      'total_neto_empresa',
    ]

    const lines: string[] = [headers.join(',')]

    let acumBruto = 0
    let acumComisionPlatea = 0
    let acumNetoEmpresa = 0

    for (const row of rows) {
      const entradasBruto = Number(row.entradas_bruto ?? 0)
      const entradasComision = Number(row.entradas_comision_platea ?? 0)
      const entradasNeto = Number(row.entradas_neto_empresa ?? 0)
      const consumiblesBruto = Number(row.consumibles_bruto ?? 0)
      const consumiblesComision = Number(row.consumibles_comision_platea ?? 0)
      const consumiblesNeto = Number(row.consumibles_neto_empresa ?? 0)

      const totalBruto = entradasBruto + consumiblesBruto
      const totalComisionPlatea = entradasComision + consumiblesComision
      const totalNetoEmpresa = entradasNeto + consumiblesNeto

      acumBruto += totalBruto
      acumComisionPlatea += totalComisionPlatea
      acumNetoEmpresa += totalNetoEmpresa

      const altaStr = row.evento_created_at instanceof Date
        ? row.evento_created_at.toISOString().slice(0, 10)
        : String(row.evento_created_at ?? '').slice(0, 10)

      lines.push([
        csvEscape(row.evento_id),
        csvEscape(row.evento_nombre),
        csvEscape(row.evento_activo ? 'activo' : 'inactivo'),
        csvEscape(altaStr),
        csvEscape(row.entradas_vendidas),
        csvEscape(row.entradas_canceladas),
        csvEscape(formatMoneyForCsv(entradasBruto)),
        csvEscape(formatMoneyForCsv(entradasComision)),
        csvEscape(formatMoneyForCsv(entradasNeto)),
        csvEscape(row.consumibles_vendidos),
        csvEscape(row.consumibles_cancelados),
        csvEscape(formatMoneyForCsv(consumiblesBruto)),
        csvEscape(formatMoneyForCsv(consumiblesComision)),
        csvEscape(formatMoneyForCsv(consumiblesNeto)),
        csvEscape(formatMoneyForCsv(totalBruto)),
        csvEscape(formatMoneyForCsv(totalComisionPlatea)),
        csvEscape(formatMoneyForCsv(totalNetoEmpresa)),
      ].join(','))
    }

    if (rows.length > 0) {
      lines.push([
        csvEscape('TOTAL'),
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        csvEscape(formatMoneyForCsv(acumBruto)),
        csvEscape(formatMoneyForCsv(acumComisionPlatea)),
        csvEscape(formatMoneyForCsv(acumNetoEmpresa)),
      ].join(','))
    }

    if (format === 'xlsx') {
      const xlsxRows: LiquidacionRow[] = []

      for (const row of rows) {
        const entradasBruto = Number(row.entradas_bruto ?? 0)
        const entradasComision = Number(row.entradas_comision_platea ?? 0)
        const entradasNeto = Number(row.entradas_neto_empresa ?? 0)
        const consumiblesBruto = Number(row.consumibles_bruto ?? 0)
        const consumiblesComision = Number(row.consumibles_comision_platea ?? 0)
        const consumiblesNeto = Number(row.consumibles_neto_empresa ?? 0)

        const altaStr = row.evento_created_at instanceof Date
          ? row.evento_created_at.toISOString().slice(0, 10)
          : String(row.evento_created_at ?? '').slice(0, 10)

        xlsxRows.push({
          evento_id: String(row.evento_id ?? ''),
          evento_nombre: String(row.evento_nombre ?? ''),
          estado_evento: row.evento_activo ? 'activo' : 'inactivo',
          evento_alta: altaStr,
          entradas_vendidas: Number(row.entradas_vendidas ?? 0),
          entradas_canceladas: Number(row.entradas_canceladas ?? 0),
          entradas_bruto: entradasBruto,
          entradas_comision_platea: entradasComision,
          entradas_neto_empresa: entradasNeto,
          consumibles_vendidos: Number(row.consumibles_vendidos ?? 0),
          consumibles_cancelados: Number(row.consumibles_cancelados ?? 0),
          consumibles_bruto: consumiblesBruto,
          consumibles_comision_platea: consumiblesComision,
          consumibles_neto_empresa: consumiblesNeto,
          total_bruto: entradasBruto + consumiblesBruto,
          total_comision_platea: entradasComision + consumiblesComision,
          total_neto_empresa: entradasNeto + consumiblesNeto,
        })
      }

      const workbookBuffer = await buildLiquidacionWorkbook(xlsxRows)
      const xlsxFilename = buildLiquidacionExportFilename()
      res.setHeader('Content-Type', LIQUIDACION_EXPORT_CONTENT_TYPE)
      res.setHeader('Content-Disposition', `attachment; filename="${xlsxFilename}"`)
      return res.send(workbookBuffer)
    }

    const csv = '﻿' + lines.join('\r\n')
    const rangoSuffix = desdeValido || hastaValido ? `-${desdeValido || 'inicio'}_${hastaValido || 'hoy'}` : ''
    const filename = `liquidacion-eventos${rangoSuffix}-${new Date().toISOString().slice(0, 10)}.csv`

    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    return res.send(csv)
  } catch {
    logServerError('eventos liquidacion export')
    return res.status(500).json({ error: 'No se pudo exportar la liquidación' })
  }
})

// GET /eventos
router.get('/', verifyInternal, requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.user!
    const esEmpleado = user.userType === 'empleado'
    const permisos = user.permisos as Permisos | undefined

    const soloActivos = req.query.solo_activos === '1' || req.query.solo_activos === 'true'
    const soloPasados = req.query.solo_pasados === '1' || req.query.solo_pasados === 'true'
    const onlyBasicFields = req.query.basic === '1' || req.query.basic === 'true'

    // La rama basic=1 (más abajo) devuelve un payload reducido — solo
    // {id, nombre[, imagen_url]}, sin ingresos/ocupación/datos financieros —
    // así que además de ver_eventos aceptamos vender_consumibles: el rol
    // "barra" (preset de fábrica) tiene vender_consumibles pero no ver_eventos
    // y necesita este endpoint para poblar el selector de evento en
    // "Vender consumibles". Mismo patrón ya usado y revisado por seguridad hoy
    // en GET /:id/categorias (ver_eventos | ver_entradas). La rama NO-basic
    // exige ver_eventos a secas porque expone ingresos/ocupación.
    if (esEmpleado) {
      const puedeListar = permisos?.ver_eventos === true
        || (onlyBasicFields && permisos?.vender_consumibles === true)
      if (!puedeListar) {
        return res.status(403).json({ error: 'Sin permiso' })
      }
    }

    const empresaId = esEmpleado ? user.empresa_id! : user.id
    const page = Math.max(1, Number(req.query.page) || 1)
    const requestedPageSize = Number(req.query.pageSize) || DEFAULT_PAGE_SIZE
    const pageSize = Math.min(HARD_LIMIT, Math.max(1, requestedPageSize))
    const busqueda = typeof req.query.busqueda === 'string' ? req.query.busqueda.trim() : ''
    const sortBy = typeof req.query.sortBy === 'string' ? req.query.sortBy.trim() : 'alta'
    const sortDir = req.query.sortDir === 'asc' ? 'asc' : 'desc'

    if (onlyBasicFields && soloPasados) {
      // Testimonios (sitio-venta editor): eventos "finalizados" — tienen al menos
      // una fecha cargada y NINGUNA de sus fechas es futura/null. Eventos sin
      // fechas cargadas (ej. modo "pase" sin funciones fijas) quedan afuera: no
      // hay forma confiable de saber si ya "pasaron".
      const rows = await prisma.$queryRaw<Array<{ id: string; nombre: string; imagen_url: string | null }>>`
        SELECT e.id, e.nombre, e.imagen_url
        FROM eventos e
        WHERE e.empresa_id = ${empresaId}
          AND EXISTS (SELECT 1 FROM evento_fechas ef WHERE ef.evento_id = e.id)
          AND NOT EXISTS (
            SELECT 1 FROM evento_fechas ef2
            WHERE ef2.evento_id = e.id AND (ef2.fecha IS NULL OR ef2.fecha >= NOW())
          )
        ORDER BY e.nombre ASC
        LIMIT 200
      `
      return res.json({ data: rows })
    }

    if (onlyBasicFields) {
      // S3: simple list — prisma ORM
      // ⚠️ Este `select` es accesible con SOLO `vender_consumibles` (sin `ver_eventos`), ver
      // el chequeo de permiso arriba. Si agregás un campo acá, confirmá que siga siendo
      // seguro exponerlo a ese permiso más amplio (nada financiero/de ocupación).
      const rows = await prisma.evento.findMany({
        where: {
          empresa_id: empresaId,
          ...(soloActivos ? { activo: true } : {}),
        },
        select: { id: true, nombre: true },
        orderBy: { nombre: 'asc' },
        take: 200,
      })

      return res.json({ data: rows })
    }

    // Permission check: can user see financial KPIs?
    // empresa users always have full access; empleados need ver_kpis_eventos
    const puedeVerKpis = !esEmpleado || (permisos?.ver_kpis_eventos === true)

    // Gated sort keys — only financial metrics require ver_kpis_eventos
    // ocupacion is NOT gated (it's an operational metric, not financial)
    const GATED_SORT_KEYS = ['ingresos', 'ticket_promedio', 'ventas_7d'] as const
    if ((GATED_SORT_KEYS as readonly string[]).includes(sortBy) && !puedeVerKpis) {
      return res.status(400).json({ error: 'Sin permiso para ese ordenamiento' })
    }

    // S4/S5: build Postgres $n-indexed params for GET / list + count
    const listParams: unknown[] = []
    function listParam(val: unknown): string {
      listParams.push(val)
      return `$${listParams.length}`
    }

    const filtros: string[] = [`e.empresa_id = ${listParam(empresaId)}`]

    if (soloActivos) filtros.push('e.activo = true')
    if (busqueda) {
      // Match en nombre del evento O en nombre de cualquier categoría asociada.
      // Permite buscar "vip", "platinum", etc. y encontrar todos los eventos
      // que tienen esa categoría.
      // IN con subquery pre-filtrada evita el full scan del correlated EXISTS.
      const pattern = `%${busqueda}%`
      filtros.push(
        `(
          e.nombre ILIKE ${listParam(pattern)}
          OR e.id IN (
            SELECT ec_search.evento_id FROM entrada_categorias ec_search
            WHERE ec_search.nombre ILIKE ${listParam(pattern)}
          )
        )`,
      )
    }

    // publication_status filter — mirrors buildEventPublicationSnapshot TS logic in SQL
    // Accepted values: live, listed, hidden, manual_inactive
    // manual_inactive is a pseudo-status (activo=false); hidden is scheduled-not-yet-live
    // Keep in sync with buildEventPublicationSnapshot in event-publication.ts
    const VALID_PUBLICATION_STATUSES = ['live', 'listed', 'hidden', 'manual_inactive'] as const
    const rawPubStatus = typeof req.query.publication_status === 'string' ? req.query.publication_status.trim() : ''
    const pubStatusValues = rawPubStatus
      ? rawPubStatus
          .split(',')
          .map((s) => s.trim())
          .filter((s): s is typeof VALID_PUBLICATION_STATUSES[number] =>
            (VALID_PUBLICATION_STATUSES as readonly string[]).includes(s)
          )
      : []

    if (pubStatusValues.length > 0) {
      // ANY(::text[]) replaces IN (?, ?, ...)
      filtros.push(
        `(CASE
           WHEN e.activo = false THEN 'manual_inactive'
           WHEN e.publication_mode != 'scheduled' THEN 'live'
           WHEN e.publish_at_utc IS NULL THEN 'live'
           WHEN e.publish_at_utc <= NOW() THEN 'live'
           WHEN e.pre_publish_visibility IN ('listado_solo','detail_visible') THEN 'listed'
           ELSE 'hidden'
         END) = ANY(${listParam(pubStatusValues)}::text[])`
      )
    }

    const whereClause = filtros.join(' AND ')

    const sortMap: Record<string, string> = {
      nombre: `e.nombre ${sortDir}`,
      estado: `e.activo ${sortDir}`,
      fechas: `COALESCE(ef_stats.cantidad_fechas, 0) ${sortDir}`,
      // Eventos sin ninguna fecha futura (ya finalizados) quedan siempre al final,
      // sin importar la dirección — no tiene sentido "ordenarlos primero" por fecha próxima.
      proxima_fecha: `ef_stats.proxima_fecha ${sortDir} NULLS LAST`,
      categorias: `COALESCE(ec_stats.cantidad_categorias, 0) ${sortDir}`,
      vendidas: `COALESCE(ec_stats.entradas_vendidas, 0) ${sortDir}`,
      capacidad: `COALESCE(ec_stats.capacidad_total, 0) ${sortDir}`,
      alta: `e.created_at ${sortDir}`,
      // Financial KPI sort keys (gated by ver_kpis_eventos — checked above)
      ingresos: `COALESCE(en_financiero_stats.total_neto, 0) ${sortDir}`,
      // sort by ticket_promedio uses NETO (aligns with neto = business metric, not bruto)
      // NULLS LAST behavior: events with 0 sales get NULL → sort last on both ASC and DESC
      ticket_promedio: `(CASE WHEN COALESCE(en_financiero_stats.total_vendidas_financiero, 0) > 0 THEN en_financiero_stats.total_neto / en_financiero_stats.total_vendidas_financiero ELSE NULL END) ${sortDir}`,
      ventas_7d: `COALESCE(en_financiero_stats.ventas_7d, 0) ${sortDir}`,
      // Operational sort key (NOT gated — available to any user with ver_eventos)
      // NULLS LAST behavior: events with capacidad_total=0 get NULL → sort last on both ASC and DESC
      ocupacion: `(CASE WHEN COALESCE(ec_stats.capacidad_total, 0) > 0 THEN COALESCE(ec_stats.entradas_vendidas, 0)::numeric / NULLIF(ec_stats.capacidad_total, 0)::numeric ELSE NULL END) ${sortDir}`,
    }
    const orderClause = sortMap[sortBy] ?? `e.created_at ${sortDir}`

    // S4: COUNT — reuse same params snapshot (count query has no LIMIT/OFFSET)
    const countParamsSnap = [...listParams]
    const countRows = await prisma.$queryRawUnsafe<{ total: bigint }[]>(
      `SELECT COUNT(*) as total FROM eventos e WHERE ${whereClause}`,
      ...countParamsSnap,
    )

    const total = Number(countRows[0]?.total ?? 0n)
    const totalPages = Math.max(1, Math.ceil(total / pageSize))
    const currentPage = Math.min(page, totalPages)
    const offset = (currentPage - 1) * pageSize

    // S5: main list — add LIMIT/OFFSET params
    const limitParam2 = listParam(pageSize)
    const offsetParam2 = listParam(offset)

    const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT e.*,
        -- COUNT(*)/SUM(int) vuelven como int8/bigint de Postgres, que Prisma mapea a JS
        -- BigInt (no number) via $queryRawUnsafe. serializeEventoRow() solo re-castea los
        -- campos financieros (ingresos_*, ventas_7d) a Number antes de spreadear la fila en
        -- la respuesta -- estos quedaban colados como BigInt crudo y hacían explotar
        -- res.json() con "Do not know how to serialize a BigInt" apenas cualquiera de estos
        -- eventos tuviera fechas/categorías/tandas/stock (o sea, siempre).
        COALESCE(ef_stats.cantidad_fechas, 0)::int as cantidad_fechas,
        ef_stats.proxima_fecha,
        COALESCE(ec_stats.cantidad_categorias, 0)::int as cantidad_categorias,
        COALESCE(et_stats.cantidad_tandas, 0)::int as cantidad_tandas,
        COALESCE(ec_stats.entradas_vendidas, 0)::int as entradas_vendidas,
        COALESCE(ec_stats.capacidad_total, 0)::int as capacidad_total,
        COALESCE(en_financiero_stats.total_bruto, 0) as ingresos_bruto,
        COALESCE(en_financiero_stats.total_neto, 0) as ingresos_neto,
        COALESCE(en_financiero_stats.total_vendidas_financiero, 0) as total_vendidas_financiero,
        COALESCE(en_financiero_stats.ventas_7d, 0) as ventas_7d
       FROM eventos e
       LEFT JOIN (
         SELECT evento_id, COUNT(*) as cantidad_fechas,
           MIN(fecha) FILTER (WHERE fecha >= NOW()) as proxima_fecha
         FROM evento_fechas
         GROUP BY evento_id
       ) ef_stats ON ef_stats.evento_id = e.id
       LEFT JOIN (
         SELECT evento_id,
           COUNT(*) as cantidad_categorias,
           COALESCE(SUM(GREATEST(stock - stock_disponible, 0)), 0) as entradas_vendidas,
           COALESCE(SUM(stock), 0) as capacidad_total
         FROM entrada_categorias
         GROUP BY evento_id
       ) ec_stats ON ec_stats.evento_id = e.id
       LEFT JOIN (
         SELECT evento_id, COUNT(*) as cantidad_tandas
         FROM evento_tandas
         GROUP BY evento_id
       ) et_stats ON et_stats.evento_id = e.id
       LEFT JOIN (
         SELECT
           evento_id,
           COALESCE(SUM(CASE WHEN estado != 'cancelada' THEN precio_pagado ELSE 0 END), 0) AS total_bruto,
           COALESCE(SUM(CASE WHEN estado != 'cancelada' THEN COALESCE(neto_empresa_amount, precio_pagado - COALESCE(comision, 0) - COALESCE(mp_fee_amount, 0)) ELSE 0 END), 0) AS total_neto,
           COUNT(CASE WHEN estado != 'cancelada' THEN 1 END) AS total_vendidas_financiero,
           COUNT(CASE WHEN estado IN ('valida','usada') AND created_at >= NOW() - INTERVAL '7 days' THEN 1 END) AS ventas_7d
           -- Note: ventas_7d uses IN ('valida','usada') explicitly (not != 'cancelada')
           -- Mirror of metricas query in GET /:id — keep neto formula in sync
         FROM entradas
         GROUP BY evento_id
       ) en_financiero_stats ON en_financiero_stats.evento_id = e.id
       WHERE ${whereClause}
        ORDER BY ${orderClause}
        LIMIT ${limitParam2} OFFSET ${offsetParam2}`,
      ...listParams,
    )

    return res.json({
      data: rows.map((row) => stripFinancialFields(serializeEventoRow(row as Parameters<typeof serializeEventoRow>[0]) as Record<string, unknown>, puedeVerKpis)),
      pagination: {
        page: currentPage,
        pageSize,
        total,
        totalPages,
      },
    })
  } catch (error) {
    if (error instanceof EventoValidationError) {
      return res.status(400).json({ error: error.message })
    }
    logServerError('eventos list', error)
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// POST /eventos
router.post('/', verifyInternal, requireAuth, async (req: Request, res: Response) => {
  try {
    await ensureEventoConsumiblesColumns()
    const user = req.user!
    const esEmpleado = user.userType === 'empleado'
    const permisos = user.permisos as Permisos | undefined

    if (esEmpleado && !permisos?.crear_eventos) {
      return res.status(403).json({ error: 'Sin permiso' })
    }

    const empresaId = esEmpleado ? user.empresa_id! : user.id
    const { modo_fecha, imagen_url, venta_consumibles_habilitada, buyer_event_refunds_enabled, tipo_mapa } = req.body
    const nombre = typeof req.body.nombre === 'string' ? req.body.nombre.trim() : req.body.nombre
    const descripcion = typeof req.body.descripcion === 'string' ? req.body.descripcion.trim() : req.body.descripcion
    const lugar = typeof req.body.lugar === 'string' ? req.body.lugar.trim() : req.body.lugar
    const ciudad = typeof req.body.ciudad === 'string' ? req.body.ciudad.trim() : req.body.ciudad
    const fechas = normalizeFechas(req.body.fechas)
    const categorias = normalizeCategorias(req.body.categorias)
    const tandas = normalizeTandas(req.body.tandas)
    const publicationPolicy = normalizeEventoPublicationPolicy(req.body as Record<string, unknown>)

    if (!nombre || !modo_fecha || !categorias.length) {
      return res.status(400).json({
        error: 'Nombre, modo de fecha y al menos una categoría son obligatorios',
      })
    }

    if (nombre.length > EVENTO_TEXT_FIELD_MAX_LENGTH) {
      return res.status(400).json({ error: `El nombre del evento no puede superar los ${EVENTO_TEXT_FIELD_MAX_LENGTH} caracteres` })
    }

    if (typeof lugar === 'string' && lugar.length > EVENTO_TEXT_FIELD_MAX_LENGTH) {
      return res.status(400).json({ error: `El lugar del evento no puede superar los ${EVENTO_TEXT_FIELD_MAX_LENGTH} caracteres` })
    }

    if (typeof ciudad === 'string' && ciudad.length > EVENTO_CIUDAD_MAX_LENGTH) {
      return res.status(400).json({ error: `La ciudad no puede superar los ${EVENTO_CIUDAD_MAX_LENGTH} caracteres` })
    }

    if (!isModoFechaValido(modo_fecha)) {
      return res.status(400).json({ error: 'Modo de fecha inválido' })
    }

    if (tipo_mapa !== undefined && !isTipoMapaValido(tipo_mapa)) {
      return res.status(400).json({ error: 'Tipo de mapa inválido' })
    }
    const tipoMapaValue = isTipoMapaValido(tipo_mapa) ? tipo_mapa : 'libre'

    if (imagen_url) {
      try {
        const parsedUrl = new URL(String(imagen_url))
        if (parsedUrl.protocol !== 'https:') {
          return res.status(400).json({ error: 'La URL de imagen del evento debe usar HTTPS' })
        }
      } catch {
        return res.status(400).json({ error: 'La URL de imagen del evento no es válida' })
      }
    }

    if (!fechas?.length) {
      return res.status(400).json({ error: 'Debés agregar al menos una fecha' })
    }

    validateFechasNoPasadas(fechas)

    const tandaError = validateTandas(tandas, categorias)
    if (tandaError) {
      return res.status(400).json({ error: tandaError })
    }

    const eventoId = uuidv4()

    await withSerializableRetry(() => prismaDirectUrl.$transaction(async (tx) => {
      await tx.$executeRaw`
        INSERT INTO eventos (
          id, empresa_id, nombre, descripcion, lugar, ciudad, modo_fecha, imagen_url, activo,
          publication_mode, pre_publish_visibility, publish_at_utc, publish_timezone, published_live_at,
          venta_consumibles_habilitada, buyer_event_refunds_enabled, tipo_mapa
        )
        VALUES (
          ${eventoId}, ${empresaId}, ${nombre}, ${descripcion ?? null}, ${lugar ?? null}, ${ciudad ?? null},
          ${modo_fecha}::"ModofechaEnum", ${imagen_url ?? null}, true,
          ${publicationPolicy.publicationMode}, ${publicationPolicy.prePublishVisibility},
          ${publicationPolicy.publishAtUtc}::timestamptz, ${publicationPolicy.publishTimezone},
          ${publicationPolicy.publishedLiveAt}::timestamptz,
          ${venta_consumibles_habilitada === true},
          ${buyer_event_refunds_enabled === true},
          ${tipoMapaValue}
        )`

      await syncFechas(tx, eventoId, fechas)

      const tandaMapping = await syncTandas(tx, eventoId, tandas)
      await syncCategorias(tx, eventoId, categorias, tandaMapping)

      await normalizeEstadosTandas(tx, eventoId)
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 5000,
      timeout: 15000,
    }))

    return res.status(201).json({ ok: true, id: eventoId })
  } catch (error) {
    if (error instanceof EventoValidationError) {
      return res.status(400).json({ error: error.message })
    }
    logServerError('eventos create', error)
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// GET /eventos/summary — MUST be declared before /:id to prevent Express matching /summary as /:id
// Auth: empresa users always allowed; empleados need ver_recaudacion permission
// Query params: busqueda (string), publication_status (CSV: live|listed|hidden|manual_inactive)
// Returns aggregated KPIs + top/bottom performer cards for the empresa
router.get('/summary', verifyInternal, requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.user!
    const esEmpleado = user.userType === 'empleado'
    const permisos = user.permisos as Permisos | undefined

    if (esEmpleado && !permisos?.ver_recaudacion) {
      return res.status(403).json({ error: 'Sin permiso' })
    }

    const empresaId = esEmpleado ? user.empresa_id! : user.id

    // Build shared Postgres $n-indexed filter — S6–S10: GET /summary 5 parallel queries
    const summaryParams: unknown[] = []
    function sParam(val: unknown): string {
      summaryParams.push(val)
      return `$${summaryParams.length}`
    }

    const busqueda = typeof req.query.busqueda === 'string' ? req.query.busqueda.trim() : ''

    const filtros: string[] = [`e.empresa_id = ${sParam(empresaId)}`]

    if (busqueda) {
      const pattern = `%${busqueda}%`
      filtros.push(
        `(e.nombre ILIKE ${sParam(pattern)} OR EXISTS (
           SELECT 1 FROM entrada_categorias ec_s
           WHERE ec_s.evento_id = e.id AND ec_s.nombre ILIKE ${sParam(pattern)}
         ))`
      )
    }

    const VALID_PUB_STATUSES = ['live', 'listed', 'hidden', 'manual_inactive'] as const
    const rawPubStatus = typeof req.query.publication_status === 'string' ? req.query.publication_status.trim() : ''
    const pubStatusValues = rawPubStatus
      ? rawPubStatus
          .split(',')
          .map((s) => s.trim())
          .filter((s): s is typeof VALID_PUB_STATUSES[number] =>
            (VALID_PUB_STATUSES as readonly string[]).includes(s)
          )
      : []

    // Mirror of buildEventPublicationSnapshot in event-publication.ts — keep in sync
    const PUBLICATION_CASE = `(CASE
      WHEN e.activo = false THEN 'manual_inactive'
      WHEN e.publication_mode != 'scheduled' THEN 'live'
      WHEN e.publish_at_utc IS NULL THEN 'live'
      WHEN e.publish_at_utc <= NOW() THEN 'live'
      WHEN e.pre_publish_visibility IN ('listado_solo','detail_visible') THEN 'listed'
      ELSE 'hidden'
    END)`

    if (pubStatusValues.length > 0) {
      filtros.push(`${PUBLICATION_CASE} = ANY(${sParam(pubStatusValues)}::text[])`)
    }

    const whereClause = filtros.join(' AND ')

    // Reusable subquery fragments for financial and capacity stats per event
    // These are inlined into each query to avoid cartesian products (separate GROUP BYs)
    const FIN_SUBQ = `(
      SELECT evento_id,
        COALESCE(SUM(CASE WHEN estado != 'cancelada' THEN precio_pagado ELSE 0 END), 0) AS total_bruto,
        COALESCE(SUM(CASE WHEN estado != 'cancelada' THEN COALESCE(neto_empresa_amount, precio_pagado - COALESCE(comision, 0) - COALESCE(mp_fee_amount, 0)) ELSE 0 END), 0) AS total_neto,
        COUNT(CASE WHEN estado != 'cancelada' THEN 1 END) AS total_vendidas_financiero
      FROM entradas
      GROUP BY evento_id
    ) fin`

    const CAP_SUBQ = `(
      SELECT evento_id,
        COALESCE(SUM(GREATEST(stock - stock_disponible, 0)), 0) AS entradas_vendidas,
        COALESCE(SUM(stock), 0) AS capacidad_total
      FROM entrada_categorias
      GROUP BY evento_id
    ) cap`

    // Run 5 queries in parallel — single round-trip via Promise.all
    // S6–S10: all 5 queries migrated to prisma.$queryRawUnsafe
    const [
      aggregateRows,
      topIngresosRows,
      bottomIngresosRows,
      topOcupacionRows,
      bottomOcupacionRows,
    ] = await Promise.all([
      // Query 1 (S6): aggregate totals
      prisma.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT
          COUNT(*) AS eventos_count,
          SUM(CASE WHEN e.activo = true THEN 1 ELSE 0 END) AS eventos_activos,
          COALESCE(SUM(fin.total_bruto), 0) AS total_bruto,
          COALESCE(SUM(fin.total_neto), 0) AS total_neto,
          COALESCE(SUM(fin.total_vendidas_financiero), 0) AS total_vendidas,
          COALESCE(SUM(cap.capacidad_total), 0) AS total_capacidad,
          AVG(CASE WHEN COALESCE(cap.capacidad_total, 0) > 0
                   THEN (COALESCE(cap.entradas_vendidas, 0)::numeric / NULLIF(cap.capacidad_total, 0)::numeric) * 100
                   ELSE NULL END) AS ocupacion_promedio,
          (CASE WHEN COALESCE(SUM(fin.total_vendidas_financiero), 0) > 0
                THEN SUM(fin.total_bruto) / SUM(fin.total_vendidas_financiero)
                ELSE NULL END) AS ticket_promedio_bruto_global,
          (CASE WHEN COALESCE(SUM(fin.total_vendidas_financiero), 0) > 0
                THEN SUM(fin.total_neto) / SUM(fin.total_vendidas_financiero)
                ELSE NULL END) AS ticket_promedio_neto_global
        FROM eventos e
        LEFT JOIN ${FIN_SUBQ} ON fin.evento_id = e.id
        LEFT JOIN ${CAP_SUBQ} ON cap.evento_id = e.id
        WHERE ${whereClause}`,
        ...summaryParams,
      ),
      // Query 2 (S7): top by ingresos_neto
      prisma.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT e.id, e.nombre, e.imagen_url, COALESCE(fin.total_neto, 0) AS ingresos_neto
        FROM eventos e
        LEFT JOIN ${FIN_SUBQ} ON fin.evento_id = e.id
        WHERE ${whereClause}
        ORDER BY ingresos_neto DESC
        LIMIT 1`,
        ...summaryParams,
      ),
      // Query 3 (S8): bottom by ingresos_neto (includes $0 events — FLAG-A: null treated as 0)
      prisma.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT e.id, e.nombre, e.imagen_url, COALESCE(fin.total_neto, 0) AS ingresos_neto
        FROM eventos e
        LEFT JOIN ${FIN_SUBQ} ON fin.evento_id = e.id
        WHERE ${whereClause}
        ORDER BY ingresos_neto ASC
        LIMIT 1`,
        ...summaryParams,
      ),
      // Query 4 (S9): top by ocupacion % (excludes events with capacidad_total=0)
      prisma.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT e.id, e.nombre, e.imagen_url,
          ROUND((COALESCE(cap.entradas_vendidas, 0)::numeric / NULLIF(cap.capacidad_total, 0)::numeric) * 100, 2) AS ocupacion_pct
        FROM eventos e
        LEFT JOIN ${CAP_SUBQ} ON cap.evento_id = e.id
        WHERE ${whereClause} AND COALESCE(cap.capacidad_total, 0) > 0
        ORDER BY ocupacion_pct DESC
        LIMIT 1`,
        ...summaryParams,
      ),
      // Query 5 (S10): bottom by ocupacion % (excludes events with capacidad_total=0)
      prisma.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT e.id, e.nombre, e.imagen_url,
          ROUND((COALESCE(cap.entradas_vendidas, 0)::numeric / NULLIF(cap.capacidad_total, 0)::numeric) * 100, 2) AS ocupacion_pct
        FROM eventos e
        LEFT JOIN ${CAP_SUBQ} ON cap.evento_id = e.id
        WHERE ${whereClause} AND COALESCE(cap.capacidad_total, 0) > 0
        ORDER BY ocupacion_pct ASC
        LIMIT 1`,
        ...summaryParams,
      ),
    ])

    const agg = aggregateRows[0]

    // Serialize performer cards — null when no matching row
    type PerformerIngresosCard = { id: string; nombre: string; imagen_url: string | null; ingresos_neto: number } | null
    type PerformerOcupacionCard = { id: string; nombre: string; imagen_url: string | null; ocupacion_pct: number } | null

    const toIngresosCard = (rows: Record<string, unknown>[]): PerformerIngresosCard =>
      rows.length > 0
        ? { id: String(rows[0].id), nombre: String(rows[0].nombre), imagen_url: rows[0].imagen_url != null ? String(rows[0].imagen_url) : null, ingresos_neto: Number(rows[0].ingresos_neto) }
        : null

    const toOcupacionCard = (rows: Record<string, unknown>[]): PerformerOcupacionCard =>
      rows.length > 0
        ? { id: String(rows[0].id), nombre: String(rows[0].nombre), imagen_url: rows[0].imagen_url != null ? String(rows[0].imagen_url) : null, ocupacion_pct: Number(rows[0].ocupacion_pct) }
        : null

    return res.json({
      data: {
        totales: {
          eventos_count: Number(agg?.eventos_count ?? 0n),
          eventos_activos: Number(agg?.eventos_activos ?? 0n),
          total_bruto: Number(agg?.total_bruto ?? 0),
          total_neto: Number(agg?.total_neto ?? 0),
          total_vendidas: Number(agg?.total_vendidas ?? 0n),
          total_capacidad: Number(agg?.total_capacidad ?? 0),
          ocupacion_promedio: agg?.ocupacion_promedio != null ? Number(agg.ocupacion_promedio) : null,
          ticket_promedio_bruto: agg?.ticket_promedio_bruto_global != null ? Number(agg.ticket_promedio_bruto_global) : null,
          ticket_promedio_neto: agg?.ticket_promedio_neto_global != null ? Number(agg.ticket_promedio_neto_global) : null,
        },
        performers: {
          top_por_ingresos: toIngresosCard(topIngresosRows),
          bottom_por_ingresos: toIngresosCard(bottomIngresosRows),
          top_por_ocupacion: toOcupacionCard(topOcupacionRows),
          bottom_por_ocupacion: toOcupacionCard(bottomOcupacionRows),
        },
      },
    })
  } catch (error) {
    logServerError('eventos summary', error)
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// GET /eventos/comparar — compare up to 4 events side-by-side
// MUST be declared BEFORE /:id to prevent Express matching 'comparar' as a dynamic :id param
// Auth: empresa users always allowed (if ver_eventos); empleados need ver_eventos permission
// KPI financial fields: gated by ver_kpis_eventos via stripFinancialFields (module-level reuse)
// Security: category_mix query is sequential (NOT parallel) — runs only on tenant-validated ids
//           to prevent cross-tenant entrada_categorias leakage
router.get('/comparar', verifyInternal, requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.user!
    const esEmpleado = user.userType === 'empleado'
    const permisos = user.permisos as Permisos | undefined

    if (esEmpleado && !permisos?.ver_eventos) {
      return res.status(403).json({ error: 'Sin permiso' })
    }

    const empresaId = esEmpleado ? user.empresa_id! : user.id
    const puedeVerKpis = !esEmpleado || (permisos?.ver_kpis_eventos === true)

    // --- Parse and validate ids ---
    // isUuid() and UUID_REGEX are module-level (defined at lines 26 and 99)
    const rawIds = typeof req.query.ids === 'string' ? req.query.ids.trim() : ''
    const requestedIds = rawIds
      .split(',')
      .map((s) => s.trim())
      .filter((s) => isUuid(s))          // silently drop malformed UUIDs (URL manipulation defense)

    const uniqueIds = Array.from(new Set(requestedIds))  // dedupe

    if (uniqueIds.length < 2) {
      return res.status(400).json({ error: 'Se requieren al menos 2 eventos para comparar' })
    }
    if (uniqueIds.length > 4) {
      return res.status(400).json({ error: 'Máximo 4 eventos comparables' })
    }

    // S11: GET /comparar main query — prisma.$queryRawUnsafe, ANY(::text[]) for tenant-scoped id filter
    // WHERE clause: empresa_id = $1 AND id = ANY($2::text[]) — tenant-scoped, prevents cross-tenant access
    const mainRows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT e.*,
        -- Ver comentario equivalente en GET /eventos (list): estos son COUNT(*)/SUM(int) ->
        -- int8/bigint de Postgres -> BigInt de JS via $queryRawUnsafe, y serializeEventoRow()
        -- no los re-castea (solo castea los campos financieros). Sin este cast, res.json()
        -- explota con "Do not know how to serialize a BigInt" en /eventos/comparar.
        COALESCE(ef_stats.cantidad_fechas, 0)::int AS cantidad_fechas,
        COALESCE(ec_stats.cantidad_categorias, 0)::int AS cantidad_categorias,
        COALESCE(et_stats.cantidad_tandas, 0)::int AS cantidad_tandas,
        COALESCE(ec_stats.entradas_vendidas, 0)::int AS entradas_vendidas,
        COALESCE(ec_stats.capacidad_total, 0)::int AS capacidad_total,
        COALESCE(en_financiero_stats.total_bruto, 0) AS ingresos_bruto,
        COALESCE(en_financiero_stats.total_neto, 0) AS ingresos_neto,
        COALESCE(en_financiero_stats.total_vendidas_financiero, 0) AS total_vendidas_financiero,
        COALESCE(en_financiero_stats.ventas_7d, 0) AS ventas_7d
      FROM eventos e
      LEFT JOIN (
        SELECT evento_id, COUNT(*) AS cantidad_fechas
        FROM evento_fechas GROUP BY evento_id
      ) ef_stats ON ef_stats.evento_id = e.id
      LEFT JOIN (
        SELECT evento_id,
          COUNT(*) AS cantidad_categorias,
          COALESCE(SUM(GREATEST(stock - stock_disponible, 0)), 0) AS entradas_vendidas,
          COALESCE(SUM(stock), 0) AS capacidad_total
        FROM entrada_categorias GROUP BY evento_id
      ) ec_stats ON ec_stats.evento_id = e.id
      LEFT JOIN (
        SELECT evento_id, COUNT(*) AS cantidad_tandas
        FROM evento_tandas GROUP BY evento_id
      ) et_stats ON et_stats.evento_id = e.id
      LEFT JOIN (
        SELECT
          evento_id,
          COALESCE(SUM(CASE WHEN estado != 'cancelada' THEN precio_pagado ELSE 0 END), 0) AS total_bruto,
          COALESCE(SUM(CASE WHEN estado != 'cancelada' THEN COALESCE(neto_empresa_amount, precio_pagado - COALESCE(comision,0) - COALESCE(mp_fee_amount,0)) ELSE 0 END), 0) AS total_neto,
          COUNT(CASE WHEN estado != 'cancelada' THEN 1 END) AS total_vendidas_financiero,
          COUNT(CASE WHEN estado IN ('valida','usada') AND created_at >= NOW() - INTERVAL '7 days' THEN 1 END) AS ventas_7d
        FROM entradas GROUP BY evento_id
      ) en_financiero_stats ON en_financiero_stats.evento_id = e.id
      WHERE e.empresa_id = $1 AND e.id = ANY($2::text[])`,
      empresaId,
      uniqueIds,
    )

    // Derive validIds (tenant-scoped) BEFORE running mix query
    // This is the critical tenant-safety step: only ids returned by the main query
    // (which filters by empresa_id) are used for the category mix query.
    // Running mix in parallel would risk leaking entrada_categorias rows for cross-tenant events.
    const validIds = mainRows.map((r) => String(r.id))
    const excludedIds = uniqueIds.filter((id) => !validIds.includes(id))

    // S12: category mix query (sequential — uses only tenant-validated ids)
    let mixRows: Record<string, unknown>[] = []
    if (validIds.length > 0) {
      mixRows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT id AS categoria_id, evento_id, nombre, stock,
                GREATEST(stock - stock_disponible, 0) AS vendidas,
                ROUND((GREATEST(stock - stock_disponible, 0)::numeric / NULLIF(stock, 0)::numeric) * 100, 1) AS pct
         FROM entrada_categorias
         WHERE evento_id = ANY($1::text[])
         ORDER BY evento_id, precio ASC`,
        validIds,
      )
    }

    // --- Serialize events using module-level helpers from Phase 1 ---
    const eventsById = new Map<string, Record<string, unknown>>()
    for (const row of mainRows) {
      const serialized = stripFinancialFields(
        serializeEventoRow(row as Parameters<typeof serializeEventoRow>[0]) as Record<string, unknown>,
        puedeVerKpis
      )
      serialized.category_mix = []
      eventsById.set(String(row.id), serialized)
    }

    // Attach category_mix items to their respective events
    for (const m of mixRows) {
      const target = eventsById.get(String(m.evento_id))
      if (target && Array.isArray(target.category_mix)) {
        (target.category_mix as unknown[]).push({
          categoria_id: String(m.categoria_id),
          nombre: String(m.nombre),
          vendidas: Number(m.vendidas ?? 0),
          total: Number(m.stock ?? 0),
          pct: m.pct == null ? null : Number(m.pct),
        })
      }
    }

    // Re-order events to match the user's requested order (important for frontend chart color consistency)
    const events = uniqueIds
      .filter((id) => eventsById.has(id))
      .map((id) => eventsById.get(id)!)

    return res.json({
      data: {
        events,
        excluded_ids: excludedIds,
      },
    })
  } catch (error) {
    logServerError('eventos comparar', error)
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// GET /eventos/velocity — sales velocity series for up to 8 events, normalized to days_before_event
router.get('/velocity', verifyInternal, requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.user!
    const esEmpleado = user.userType === 'empleado'
    const permisos = user.permisos as Permisos | undefined
    const empresaId = esEmpleado ? user.empresa_id! : user.id

    // Permission gating: empleado needs ver_eventos AND ver_kpis_eventos
    if (esEmpleado && (!permisos?.ver_eventos || !permisos?.ver_kpis_eventos)) {
      return res.status(403).json({ error: 'Sin permiso' })
    }

    // Parse & validate evento_ids (comma-separated UUIDs)
    const rawIds = typeof req.query.evento_ids === 'string' ? req.query.evento_ids.trim() : ''
    const validUuids = rawIds
      .split(',')
      .map((s) => s.trim())
      .filter((s) => isUuid(s))
    const uniqueIds = Array.from(new Set(validUuids))

    if (uniqueIds.length < 1) {
      return res.status(400).json({ error: 'Se requiere al menos 1 evento_id' })
    }
    if (uniqueIds.length > 8) {
      return res.status(400).json({ error: 'Máximo 8 eventos permitidos' })
    }

    // S13: Load event metadata + anchor dates — prisma.$queryRawUnsafe, ANY(::text[])
    const eventRows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT
        e.id,
        e.nombre,
        e.imagen_url,
        e.modo_fecha,
        ef_min.primera_fecha AS anchor_date
      FROM eventos e
      LEFT JOIN (
        SELECT evento_id, MIN(fecha) AS primera_fecha
        FROM evento_fechas GROUP BY evento_id
      ) ef_min ON ef_min.evento_id = e.id
      WHERE e.empresa_id = $1 AND e.id = ANY($2::text[])`,
      empresaId,
      uniqueIds,
    )

    // Check for pase events (400 if any in the tenant-owned set)
    const paseIds = (eventRows as Record<string, unknown>[])
      .filter((r) => r.modo_fecha === 'pase')
      .map((r) => String(r.id))
    if (paseIds.length > 0) {
      return res.status(400).json({
        error: 'No se puede calcular velocity de eventos tipo pase',
        pase_ids: paseIds,
      })
    }

    // Tenant scoping: ids not in result belong to another empresa — silent exclusion
    const validIds = (eventRows as Record<string, unknown>[]).map((r) => String(r.id))
    const excludedIds = uniqueIds.filter((id) => !validIds.includes(id))

    // Events without anchor_date (no evento_fechas rows yet) — excluded from chart
    const renderableEvents = (eventRows as Record<string, unknown>[]).filter((r) => r.anchor_date != null)
    const noAnchorIds = (eventRows as Record<string, unknown>[])
      .filter((r) => r.anchor_date == null)
      .map((r) => String(r.id))

    // S14: Fetch snapshots for all renderable events — prisma.$queryRawUnsafe, ANY(::text[])
    let snapshotRows: Record<string, unknown>[] = []
    if (renderableEvents.length > 0) {
      const evIds = (renderableEvents as Record<string, unknown>[]).map((r) => String(r.id))
      snapshotRows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT evento_id, fecha_snapshot, vendidas_acumuladas, capacidad_total_snapshot, ingresos_neto_acumulado
         FROM evento_ventas_snapshot
         WHERE evento_id = ANY($1::text[])
         ORDER BY evento_id ASC, fecha_snapshot ASC`,
        evIds,
      )
    }

    // Group snapshots by evento_id
    const byEvento = new Map<string, Record<string, unknown>[]>()
    for (const r of snapshotRows) {
      const arr = byEvento.get(String(r.evento_id)) ?? []
      arr.push(r)
      byEvento.set(String(r.evento_id), arr)
    }

    // Helper: normalize a DATE column from the pg driver (may return a Date object or string) to YYYY-MM-DD
    function formatDateOnly(value: unknown): string {
      if (value instanceof Date) {
        const y = value.getUTCFullYear()
        const m = String(value.getUTCMonth() + 1).padStart(2, '0')
        const d = String(value.getUTCDate()).padStart(2, '0')
        return `${y}-${m}-${d}`
      }
      return String(value).slice(0, 10)
    }

    // Helper: days from snapshot to anchor (positive = days before event, 0 = event day)
    function diffDays(anchorIso: string, snapshotIso: string): number {
      const a = new Date(anchorIso + 'T00:00:00Z').getTime()
      const s = new Date(snapshotIso + 'T00:00:00Z').getTime()
      return Math.round((a - s) / 86_400_000)
    }

    // Build response preserving input order (match uniqueIds order, drop excluded/no-anchor)
    const renderableIds = new Set(renderableEvents.map((r) => String(r.id)))
    const eventRowById = new Map((eventRows as Record<string, unknown>[]).map((r) => [String(r.id), r]))

    const events = uniqueIds
      .filter((id) => renderableIds.has(id))
      .map((id) => {
        const row = eventRowById.get(id)!
        const eventoId = String(row.id)
        const anchorIso = formatDateOnly(row.anchor_date)
        const rawSnaps = byEvento.get(eventoId) ?? []

        const series = rawSnaps
          .map((s) => {
            const fechaIso = formatDateOnly(s.fecha_snapshot)
            const days = diffDays(anchorIso, fechaIso)
            const vendidas = Number(s.vendidas_acumuladas ?? 0)
            const capacidad = Number(s.capacidad_total_snapshot ?? 0)
            const neto = Number(s.ingresos_neto_acumulado ?? 0)
            return {
              days_before_event: days,
              fecha_snapshot: fechaIso,
              vendidas_acumuladas: vendidas,
              capacidad_total_snapshot: capacidad,
              ingresos_neto_acumulado: neto,
              ocupacion_pct: capacidad > 0 ? Math.round((vendidas / capacidad) * 100 * 100) / 100 : 0,
            }
          })
          .filter((p) => p.days_before_event >= 0) // clip post-event snapshots

        return {
          id: eventoId,
          nombre: String(row.nombre),
          imagen_url: row.imagen_url ?? null,
          modo_fecha: String(row.modo_fecha),
          anchor_date: anchorIso,
          series,
        }
      })

    return res.json({
      data: {
        events,
        excluded_ids: excludedIds,
        no_anchor_ids: noAnchorIds,
      },
    })
  } catch (error) {
    logServerError('eventos velocity', error)
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// GET /eventos/:id
router.get('/:id', verifyInternal, requireAuth, async (req: Request, res: Response) => {
  try {
    await ensureEventoConsumiblesColumns()
    const user = req.user!
    const esEmpleado = user.userType === 'empleado'
    const permisos = user.permisos as Permisos | undefined
    const empresaId = esEmpleado ? user.empresa_id! : user.id
    const puedeVerPrecios = !esEmpleado || !permisos || permisos.ver_precios_entradas || permisos.ver_recaudacion
    const puedeVerCompradorSensitive = !esEmpleado || !permisos || permisos.ver_montos_compradores
    const puedeVerIngresos = !esEmpleado || !permisos || permisos.ver_ingresos || permisos.ver_recaudacion

    if (esEmpleado && !permisos?.ver_eventos) {
      return res.status(403).json({ error: 'Sin permiso' })
    }

    const { id } = req.params

    // S15: evento lookup — prisma.$queryRawUnsafe
    const eventoRows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT e.* FROM eventos e WHERE e.id = $1 AND e.empresa_id = $2`,
      id,
      empresaId,
    )

    if (!eventoRows[0]) return res.status(404).json({ error: 'No encontrado' })

    // S16-S20: run 5 queries in parallel — tandas, categorias, fechas, ventas, metricas
    const [tandas, categorias, fechas, ventas, metricas] = await Promise.all([
      // S16: tandas
      prisma.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT id, evento_id, nombre, descripcion, imagen_url, estado, orden, activa_desde
         FROM evento_tandas WHERE evento_id = $1 ORDER BY orden ASC, created_at ASC`,
        id,
      ),
      // S17: categorias
      prisma.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT id, evento_id, tanda_id, nombre, descripcion, imagen_url, precio::float AS precio, stock, stock_disponible, activa, entradas_por_unidad
         FROM entrada_categorias WHERE evento_id = $1 ORDER BY precio ASC`,
        id,
      ),
      // S18: fechas
      prisma.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT id, evento_id, fecha
         FROM evento_fechas WHERE evento_id = $1 ORDER BY fecha ASC`,
        id,
      ),
      // S19: ventas (recent 20)
      prisma.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT en.id, en.precio_pagado::float AS precio_pagado, en.neto_empresa_amount::float AS neto_empresa_amount, en.estado, en.created_at,
          c.nombre as comprador_nombre, c.email as comprador_email,
          ec.nombre as categoria_nombre
         FROM entradas en
         JOIN compradores c ON c.id = en.comprador_id
         LEFT JOIN entrada_categorias ec ON ec.id = en.categoria_id
         WHERE en.evento_id = $1
         ORDER BY en.created_at DESC
         LIMIT 20`,
        id,
      ),
      // S20: metricas
      prisma.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT
          COUNT(CASE WHEN en.estado != 'cancelada' THEN 1 END) as total_vendidas,
          COALESCE(SUM(CASE WHEN en.estado != 'cancelada' THEN COALESCE(en.neto_empresa_amount, en.precio_pagado - COALESCE(en.comision, 0) - COALESCE(en.mp_fee_amount, 0)) ELSE 0 END), 0) as total_neto_acreditado,
          COALESCE(SUM(CASE WHEN en.estado != 'cancelada' THEN en.precio_pagado ELSE 0 END), 0) as total_bruto,
          COUNT(CASE WHEN en.estado = 'usada' THEN 1 END) as total_usadas,
          COUNT(CASE WHEN en.estado = 'cancelada' THEN 1 END) as total_canceladas
         FROM entradas en WHERE en.evento_id = $1`,
        id,
      ),
    ])

    const categoriasSanitizadas = categorias.map((categoria) => ({
      ...categoria,
      precio: puedeVerPrecios ? Number(categoria.precio ?? 0) : null,
    }))

    const ventasSanitizadas = ventas.map((venta) => ({
      ...venta,
      precio_pagado: puedeVerPrecios ? Number(venta.precio_pagado ?? 0) : null,
      neto_empresa_amount: puedeVerPrecios ? Number(venta.neto_empresa_amount ?? venta.precio_pagado ?? 0) : null,
      comprador_email: puedeVerCompradorSensitive ? venta.comprador_email : null,
    }))

    const m0 = metricas[0]
    return res.json({
      evento: serializeEventoRow(eventoRows[0] as Parameters<typeof serializeEventoRow>[0]),
      tandas,
      categorias: categoriasSanitizadas,
      fechas,
      ventas: ventasSanitizadas,
      metricas: {
        ...m0,
        total_vendidas: Number(m0?.total_vendidas ?? 0n),
        total_usadas: Number(m0?.total_usadas ?? 0n),
        total_canceladas: Number(m0?.total_canceladas ?? 0n),
        total_recaudado: puedeVerIngresos ? Number(m0?.total_bruto ?? 0) : null,
        total_neto_acreditado: puedeVerIngresos ? Number(m0?.total_neto_acreditado ?? 0) : null,
        total_bruto: puedeVerIngresos ? Number(m0?.total_bruto ?? 0) : null,
      },
    })
  } catch (error) {
    logServerError('eventos detail', error)
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// PATCH /eventos/:id
router.patch('/:id', verifyInternal, requireAuth, async (req: Request, res: Response) => {
  try {
    await ensureEventoConsumiblesColumns()
    const user = req.user!
    const esEmpleado = user.userType === 'empleado'
    const permisos = user.permisos as Permisos | undefined
    const empresaId = esEmpleado ? user.empresa_id! : user.id

    const { id } = req.params
    const body = req.body

    // S21: existence check — prisma.evento.findFirst (tenant-scoped)
    // Trae también la política de publicación actual: si el body de este PATCH no manda
    // ninguno de los campos de política (ver bodyHasPublicationPolicyFields), la preservamos
    // en vez de dejar que normalizeEventoPublicationPolicy caiga al default 'immediate'.
    const existingEvento = await prisma.evento.findFirst({
      where: { id, empresa_id: empresaId },
      select: {
        id: true,
        publication_mode: true,
        pre_publish_visibility: true,
        publish_at_utc: true,
        publish_timezone: true,
        published_live_at: true,
        tipo_mapa: true,
      },
    })
    if (!existingEvento) return res.status(404).json({ error: 'No encontrado' })

    if (body.accion === 'toggle_activo') {
      if (esEmpleado && !permisos?.activar_eventos) {
        return res.status(403).json({ error: 'Sin permiso' })
      }
      // S22: toggle_activo — prisma.$queryRawUnsafe (NOT boolean in Postgres)
      await prisma.$queryRawUnsafe(`UPDATE eventos SET activo = NOT activo WHERE id = $1`, id)
      // activo entra directo en is_listed (event-publication.ts) -- puede sacar o meter
      // este evento de la vidriera, no esperamos los 600s de ISR para reflejarlo.
      void revalidateVidriera()
      return res.json({ ok: true })
    }

    if (body.accion === 'toggle_venta_consumibles_habilitada') {
      if (esEmpleado && !permisos?.editar_eventos) {
        return res.status(403).json({ error: 'Sin permiso' })
      }
      // S23: toggle_consumibles — prisma.$queryRawUnsafe (NOT boolean in Postgres)
      await prisma.$queryRawUnsafe(`UPDATE eventos SET venta_consumibles_habilitada = NOT venta_consumibles_habilitada WHERE id = $1`, id)
      return res.json({ ok: true })
    }

    if (esEmpleado && !permisos?.editar_eventos) {
      return res.status(403).json({ error: 'Sin permiso' })
    }

    const { imagen_url, modo_fecha, venta_consumibles_habilitada, buyer_event_refunds_enabled, tipo_mapa } = body
    const nombre = typeof body.nombre === 'string' ? body.nombre.trim() : body.nombre
    const descripcion = typeof body.descripcion === 'string' ? body.descripcion.trim() : body.descripcion
    const lugar = typeof body.lugar === 'string' ? body.lugar.trim() : body.lugar
    const ciudad = typeof body.ciudad === 'string' ? body.ciudad.trim() : body.ciudad
    const fechas = normalizeFechas(body.fechas)
    const categorias = normalizeCategorias(body.categorias)
    const tandas = normalizeTandas(body.tandas)
    // Si el body no manda NINGÚN campo de política de publicación, preservamos la política ya
    // guardada en DB (existingEvento) en vez de dejar que normalizeEventoPublicationPolicy
    // caiga al default 'immediate' — eso resetearía silenciosamente un evento scheduled/hidden
    // a "publicado ya" para cualquier caller que no conozca estos campos.
    const publicationPolicy: EventoPublicationPolicyInput = bodyHasPublicationPolicyFields(body as Record<string, unknown>)
      ? normalizeEventoPublicationPolicy(body as Record<string, unknown>, existingEvento.publish_at_utc)
      : {
          publicationMode: normalizePublicationMode(existingEvento.publication_mode),
          prePublishVisibility: normalizePrePublishVisibility(existingEvento.pre_publish_visibility),
          publishAtUtc: existingEvento.publish_at_utc ? formatUtcDateTimeForSql(existingEvento.publish_at_utc) : null,
          publishTimezone: existingEvento.publish_timezone ?? null,
          publishedLiveAt: existingEvento.published_live_at ? formatUtcDateTimeForSql(existingEvento.published_live_at) : null,
        }

    if (!nombre || !modo_fecha || !categorias.length) {
      return res.status(400).json({
        error: 'Nombre, modo de fecha y al menos una categoría son obligatorios',
      })
    }

    if (nombre.length > EVENTO_TEXT_FIELD_MAX_LENGTH) {
      return res.status(400).json({ error: `El nombre del evento no puede superar los ${EVENTO_TEXT_FIELD_MAX_LENGTH} caracteres` })
    }

    if (typeof lugar === 'string' && lugar.length > EVENTO_TEXT_FIELD_MAX_LENGTH) {
      return res.status(400).json({ error: `El lugar del evento no puede superar los ${EVENTO_TEXT_FIELD_MAX_LENGTH} caracteres` })
    }

    if (typeof ciudad === 'string' && ciudad.length > EVENTO_CIUDAD_MAX_LENGTH) {
      return res.status(400).json({ error: `La ciudad no puede superar los ${EVENTO_CIUDAD_MAX_LENGTH} caracteres` })
    }

    if (!isModoFechaValido(modo_fecha)) {
      return res.status(400).json({ error: 'Modo de fecha inválido' })
    }

    if (tipo_mapa !== undefined && !isTipoMapaValido(tipo_mapa)) {
      return res.status(400).json({ error: 'Tipo de mapa inválido' })
    }
    // Si el body no manda tipo_mapa, preservamos el valor ya guardado (mismo criterio que
    // la política de publicación arriba) en vez de resetear silenciosamente a "libre".
    const tipoMapaValue: 'libre' | 'numerado' = isTipoMapaValido(tipo_mapa) ? tipo_mapa : (existingEvento.tipo_mapa as 'libre' | 'numerado')
    const tipoMapaCambio = tipoMapaValue !== existingEvento.tipo_mapa

    if (imagen_url) {
      try {
        const parsedUrl = new URL(String(imagen_url))
        if (parsedUrl.protocol !== 'https:') {
          return res.status(400).json({ error: 'La URL de imagen del evento debe usar HTTPS' })
        }
      } catch {
        return res.status(400).json({ error: 'La URL de imagen del evento no es válida' })
      }
    }

    if (!fechas.length) {
      return res.status(400).json({ error: 'Debés agregar al menos una fecha' })
    }

    validateFechasNoPasadas(fechas)

    const tandaError = validateTandas(tandas, categorias)
    if (tandaError) {
      return res.status(400).json({ error: tandaError })
    }

    const existingTandaError = await validateExistingTandaIds(id, tandas)
    if (existingTandaError) {
      return res.status(400).json({ error: existingTandaError })
    }

    await withSerializableRetry(() => prismaDirectUrl.$transaction(async (tx) => {
      // Chequeo DENTRO de la transacción Serializable (no antes, con el pooler) para que no
      // quede una ventana entre el count y el UPDATE donde una venta concurrente se cuele.
      if (tipoMapaCambio) {
        const asientosVendidos = await tx.asiento.count({
          where: { evento_id: id, estado: 'vendido' },
        })
        if (asientosVendidos > 0) {
          throw new TipoMapaConVentasError()
        }
      }

      await tx.$executeRaw`
        UPDATE eventos
        SET nombre = ${nombre}, descripcion = ${descripcion || null}, lugar = ${lugar || null},
            ciudad = ${ciudad || null},
            imagen_url = ${imagen_url || null}, modo_fecha = ${modo_fecha}::"ModofechaEnum",
            publication_mode = ${publicationPolicy.publicationMode},
            pre_publish_visibility = ${publicationPolicy.prePublishVisibility},
            publish_at_utc = ${publicationPolicy.publishAtUtc}::timestamptz,
            publish_timezone = ${publicationPolicy.publishTimezone},
            published_live_at = ${publicationPolicy.publishedLiveAt}::timestamptz,
            venta_consumibles_habilitada = ${venta_consumibles_habilitada === true},
            buyer_event_refunds_enabled = ${buyer_event_refunds_enabled === true},
            tipo_mapa = ${tipoMapaValue}
        WHERE id = ${id}`

      await syncFechas(tx, id, fechas)

      const tandaMapping = await syncTandas(tx, id, tandas)
      await syncCategorias(tx, id, categorias, tandaMapping)
      await pruneRemovedTandas(tx, id, tandas)

      await normalizeEstadosTandas(tx, id)
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 5000,
      timeout: 15000,
    }))

    // Este PATCH puede cambiar publication_mode/pre_publish_visibility/publish_at_utc,
    // que determinan is_listed (event-publication.ts) -- no esperamos los 600s de ISR.
    void revalidateVidriera()

    return res.json({ ok: true })
  } catch (error) {
    if (error instanceof EventoValidationError) {
      return res.status(400).json({ error: error.message })
    }
    if (error instanceof TipoMapaConVentasError) {
      return res.status(409).json({ error: 'No se puede cambiar el tipo de mapa: ya hay butacas vendidas para este evento' })
    }
    logServerError('eventos patch', error)
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// DELETE /eventos/:id — borrado definitivo. Solo permitido si el evento no tiene
// ninguna venta asociada (entradas, addons, consumibles, tickets físicos): en ese
// caso hay que usar PATCH :id { accion: 'toggle_activo' } para desactivarlo en vez
// de borrarlo. El chequeo corre DENTRO de la misma transacción serializable que el
// borrado para no dejar ventana de carrera con un checkout que confirma justo en el medio.
router.delete('/:id', verifyInternal, requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.user!
    const esEmpleado = user.userType === 'empleado'
    const empresaId = esEmpleado ? user.empresa_id! : user.id
    if (!requirePermission(user, 'eliminar_eventos', res)) return

    const { id } = req.params

    const existing = await prisma.evento.findFirst({
      where: { id, empresa_id: empresaId },
      select: { id: true },
    })
    if (!existing) return res.status(404).json({ error: 'No encontrado' })

    await prismaDirectUrl.$transaction(async (tx) => {
      const [entradas, addonVentas, consumiblesVentas, ticketsFisicos] = await Promise.all([
        tx.$queryRaw<{ id: string }[]>`SELECT id FROM entradas WHERE evento_id = ${id} LIMIT 1`,
        tx.$queryRaw<{ id: string }[]>`SELECT id FROM evento_addon_ventas WHERE evento_id = ${id} LIMIT 1`,
        tx.$queryRaw<{ id: string }[]>`SELECT id FROM consumibles_ventas WHERE evento_id = ${id} LIMIT 1`,
        tx.$queryRaw<{ id: string }[]>`SELECT id FROM ticket_fisicos WHERE evento_id = ${id} LIMIT 1`,
      ])
      if (entradas.length > 0 || addonVentas.length > 0 || consumiblesVentas.length > 0 || ticketsFisicos.length > 0) {
        throw new EventoValidationError('No se puede borrar: el evento ya tiene ventas asociadas. Usá "Desactivar evento" en su lugar.')
      }

      // Mismo criterio de "checkout activo" que tenant.ts (getActiveReservedEntryCountForBuyer)
      // y checkoutCleanup.ts: estado 'reservada' con expires_at futuro. Si hay un pago en curso
      // (comprador ya redirigido a Mercado Pago pero el webhook todavía no confirmó ni expiró),
      // no podemos borrar el evento: el webhook llegaría después e insertaría una fila en
      // `entradas` apuntando a un evento_id que ya no existe (sin FK que lo bloquee).
      // checkout_sessions no tiene columna evento_id -- se filtra por empresa (índice
      // [empresa_id, estado, expires_at]) y se resuelve el/los evento(s) del carrito
      // parseando el JSON `datos` en memoria.
      const checkoutsActivosCandidatos = await tx.$queryRaw<{ datos: string }[]>`
        SELECT datos FROM checkout_sessions
        WHERE empresa_id = ${empresaId} AND estado = 'reservada' AND expires_at IS NOT NULL AND expires_at > NOW()`
      const hayCheckoutActivo = checkoutsActivosCandidatos.some((row) =>
        sessionReferencesEvento(parseCheckoutSessionData(row.datos), id),
      )
      if (hayCheckoutActivo) {
        throw new EventoCheckoutsActivosError()
      }

      await tx.$executeRaw`DELETE FROM asientos WHERE evento_id = ${id}`
      await tx.$executeRaw`DELETE FROM asiento_secciones WHERE evento_id = ${id}`
      await tx.$executeRaw`DELETE FROM evento_ventas_snapshot WHERE evento_id = ${id}`
      await tx.$executeRaw`DELETE FROM waitlist_entries WHERE evento_id = ${id}`
      await tx.$executeRaw`DELETE FROM evento_addons WHERE evento_id = ${id}`
      await tx.$executeRaw`DELETE FROM ticket_fisico_lotes WHERE evento_id = ${id}`
      await tx.$executeRaw`DELETE FROM barra_restock_alertas WHERE evento_id = ${id}`
      await tx.$executeRaw`
        DELETE FROM barra_stock_logs WHERE barra_id IN (SELECT id FROM barras WHERE evento_id = ${id})`
      await tx.$executeRaw`
        DELETE FROM barra_stock WHERE barra_id IN (SELECT id FROM barras WHERE evento_id = ${id})`
      await tx.$executeRaw`DELETE FROM barras WHERE evento_id = ${id}`
      await tx.$executeRaw`DELETE FROM consumibles_canje_auditoria WHERE evento_id = ${id}`
      await tx.$executeRaw`DELETE FROM consumibles_promociones WHERE evento_id = ${id}`
      await tx.$executeRaw`
        DELETE FROM marketing_codigos_descuento_usos WHERE codigo_id IN (SELECT id FROM marketing_codigos_descuento WHERE evento_id = ${id})`
      await tx.$executeRaw`DELETE FROM marketing_codigos_descuento WHERE evento_id = ${id}`
      await tx.$executeRaw`
        DELETE FROM marketing_envios WHERE campana_id IN (SELECT id FROM marketing_campanas WHERE evento_id = ${id})`
      await tx.$executeRaw`DELETE FROM marketing_campanas WHERE evento_id = ${id}`
      await tx.$executeRaw`DELETE FROM entrada_categorias WHERE evento_id = ${id}`
      await tx.$executeRaw`DELETE FROM evento_tandas WHERE evento_id = ${id}`
      await tx.$executeRaw`DELETE FROM evento_fechas WHERE evento_id = ${id}`
      await tx.$executeRaw`DELETE FROM eventos WHERE id = ${id}`
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 5000,
      timeout: 15000,
    })

    void revalidateVidriera()

    return res.json({ ok: true })
  } catch (error) {
    if (error instanceof EventoValidationError) {
      return res.status(400).json({ error: error.message })
    }
    if (error instanceof EventoCheckoutsActivosError) {
      return res.status(409).json({
        error: 'No se puede borrar: hay pagos en curso para este evento. Esperá a que se confirmen o expiren e intentá de nuevo.',
      })
    }
    logServerError('eventos delete', error)
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// PATCH /eventos/:id/tandas/:tandaId
router.patch('/:id/tandas/:tandaId', verifyInternal, requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.user!
    const esEmpleado = user.userType === 'empleado'
    const permisos = user.permisos as Permisos | undefined
    const empresaId = esEmpleado ? user.empresa_id! : user.id
    const { id, tandaId } = req.params
    const { accion, ...rest } = req.body as Record<string, unknown>

    const esAccionEstado = accion === 'activar' || accion === 'inactivar' || accion === 'agotar'

    if (esEmpleado) {
      if (esAccionEstado && !permisos?.activar_eventos) {
        return res.status(403).json({ error: 'Sin permiso' })
      }

      if (!esAccionEstado && !permisos?.editar_eventos) {
        return res.status(403).json({ error: 'Sin permiso' })
      }
    }

    // S24: tanda lookup (tenant-scoped via JOIN) — prisma.$queryRawUnsafe
    const rows = await prisma.$queryRawUnsafe<{ id: string; estado: string; nombre: string }[]>(
      `SELECT et.id, et.estado, et.nombre
       FROM evento_tandas et
       JOIN eventos ev ON ev.id = et.evento_id
       WHERE et.id = $1 AND et.evento_id = $2 AND ev.empresa_id = $3`,
      tandaId,
      id,
      empresaId,
    )

    if (!rows.length) return res.status(404).json({ error: 'Tanda no encontrada' })

    if (accion === 'activar') {
      // S25: check active category exists for this tanda — prisma.$queryRawUnsafe
      const catRows = await prisma.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id FROM entrada_categorias WHERE evento_id = $1 AND tanda_id = $2 AND activa = true LIMIT 1`,
        id,
        tandaId,
      )

      if (!catRows.length) {
        return res.status(400).json({ error: 'La tanda debe tener al menos una categoría activa' })
      }

      // S26: activar tanda — prismaDirectUrl (direct port — NOT pooler) for UPDATE within tx
      // This is a low-contention state toggle; no FOR UPDATE needed (just serializability via tx)
      await prismaDirectUrl.$transaction(async (tx) => {
        await tx.$queryRaw`
          UPDATE evento_tandas
          SET estado = CASE
            WHEN id = ${tandaId} THEN 'activa'
            WHEN estado = 'agotada' THEN 'agotada'
            ELSE 'proxima'
          END
          WHERE evento_id = ${id}`
      })

      return res.json({ ok: true })
    }

    if (accion === 'inactivar') {
      // S27: inactivar — prisma.$queryRawUnsafe simple update
      await prisma.$queryRawUnsafe(
        `UPDATE evento_tandas SET estado = 'inactiva' WHERE id = $1 AND evento_id = $2`,
        tandaId,
        id,
      )
      return res.json({ ok: true })
    }

    if (accion === 'agotar') {
      // S28: agotar — prisma.$queryRawUnsafe simple update
      await prisma.$queryRawUnsafe(
        `UPDATE evento_tandas SET estado = 'agotada' WHERE id = $1 AND evento_id = $2`,
        tandaId,
        id,
      )
      return res.json({ ok: true })
    }

    if (accion === 'actualizar') {
      const tandaImagenUrl = typeof rest.imagen_url === 'string' ? rest.imagen_url.trim() : null
      if (tandaImagenUrl) {
        try {
          const parsedTandaUrl = new URL(tandaImagenUrl)
          if (parsedTandaUrl.protocol !== 'https:') {
            return res.status(400).json({ error: 'La URL de imagen de la tanda debe usar HTTPS' })
          }
        } catch {
          return res.status(400).json({ error: 'La URL de imagen de la tanda no es válida' })
        }
      }

      // S29: actualizar tanda — prisma.$queryRawUnsafe UPDATE with $n params
      await prisma.$queryRawUnsafe(
        `UPDATE evento_tandas
         SET nombre = $1, descripcion = $2, imagen_url = $3, estado = $4, orden = $5, activa_desde = $6::timestamptz
         WHERE id = $7 AND evento_id = $8`,
        typeof rest.nombre === 'string' ? rest.nombre.trim() : rows[0].nombre,
        typeof rest.descripcion === 'string' ? rest.descripcion.trim() : null,
        tandaImagenUrl,
        rest.estado === 'activa' || rest.estado === 'proxima' || rest.estado === 'inactiva' || rest.estado === 'agotada'
          ? rest.estado
          : rows[0].estado,
        Number(rest.orden) || 0,
        formatActivaDesdeForSql(typeof rest.activa_desde === 'string' ? rest.activa_desde : null),
        tandaId,
        id,
      )
      return res.json({ ok: true })
    }

    return res.status(400).json({ error: 'Acción no válida' })
  } catch (error) {
    if (error instanceof EventoValidationError) {
      return res.status(400).json({ error: error.message })
    }
    logServerError('eventos tandas patch', error)
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// GET /eventos/:id/categorias — lista de categorías del evento (para filtros de dashboard)
router.get(
  '/:id/categorias',
  verifyInternal,
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const user = req.user!
      const empresaId = getActorEmpresaId(user)
      const { id } = req.params

      if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })
      // Se usa tanto desde la pantalla de eventos como desde el filtro de categoría en
      // "ver entradas" (entradas-content.tsx) — un rol custom con ver_entradas pero sin
      // ver_eventos también necesita poder listar categorías para ese filtro. Ver revisión
      // de seguridad de este cambio antes de dar por cerrado (16-jul).
      if (!requireAnyPermission(user, ['ver_eventos', 'ver_entradas'], res)) return

      // S30: GET /:id/categorias — prisma.$queryRawUnsafe
      const rows = await prisma.$queryRawUnsafe<{ id: string; nombre: string }[]>(
        `SELECT ec.id, ec.nombre
         FROM entrada_categorias ec
         JOIN eventos ev ON ev.id = ec.evento_id
         WHERE ec.evento_id = $1 AND ev.empresa_id = $2
         ORDER BY ec.nombre ASC`,
        id,
        empresaId,
      )

      return res.json({ categorias: rows })
    } catch {
      logServerError('eventos categorias list')
      return res.status(500).json({ error: 'Error interno del servidor' })
    }
  }
)

// PATCH /eventos/:id/categorias/:categoriaId
router.patch(
  '/:id/categorias/:categoriaId',
  verifyInternal,
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const user = req.user!
      const empresaId = getActorEmpresaId(user)
      const { id, categoriaId } = req.params
      const body = req.body

      if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })
      if (!requirePermission(user, 'editar_eventos', res)) return

      // S31: categoria existence check (tenant-scoped via JOIN) — prisma.$queryRawUnsafe
      const catExist = await prisma.$queryRawUnsafe<{ id: string }[]>(
        `SELECT ec.id FROM entrada_categorias ec
         JOIN eventos ev ON ev.id = ec.evento_id
         WHERE ec.id = $1 AND ec.evento_id = $2 AND ev.empresa_id = $3`,
        categoriaId,
        id,
        empresaId,
      )
      if (!catExist.length) return res.status(404).json({ error: 'No encontrado' })

      if (body.accion === 'agregar_stock') {
        const cantidad = parsePositiveInteger(body.cantidad, 'cantidad', MAX_STOCK_INCREMENT)
        // S32: agregar_stock — Strategy A: FOR UPDATE on directUrl (never pooler for locking)
        let found = true
        await prismaDirectUrl.$transaction(async (tx) => {
          const locked = await tx.$queryRaw<{ id: string }[]>`
            SELECT id FROM entrada_categorias WHERE id = ${categoriaId} AND evento_id = ${id} FOR UPDATE`
          if (!locked.length) {
            found = false
            return
          }
          await tx.$queryRaw`
            UPDATE entrada_categorias
            SET stock = stock + ${cantidad}, stock_disponible = stock_disponible + ${cantidad}
            WHERE id = ${categoriaId}`
        })
        if (!found) return res.status(404).json({ error: 'Categoría no encontrada' })
        return res.json({ ok: true })
      }

      if (body.accion === 'toggle_activa') {
        // S33: toggle_activa — prisma.$queryRawUnsafe NOT boolean
        await prisma.$queryRawUnsafe(`UPDATE entrada_categorias SET activa = NOT activa WHERE id = $1`, categoriaId)
        return res.json({ ok: true })
      }

      if (body.accion === 'cambiar_precio') {
        const precio = parsePositivePrice(body.precio, 'precio', MAX_CATEGORY_PRICE)
        // S34: cambiar_precio — prisma.$queryRawUnsafe
        await prisma.$queryRawUnsafe(`UPDATE entrada_categorias SET precio = $1 WHERE id = $2`, precio, categoriaId)
        return res.json({ ok: true })
      }

      return res.json({ ok: true })
    } catch (error) {
      if (error instanceof EventoValidationError) {
        return res.status(400).json({ error: error.message })
      }
      logServerError('eventos categorias patch')
      return res.status(500).json({ error: 'Error interno del servidor' })
    }
  }
)

export default router
