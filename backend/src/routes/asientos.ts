import { Router, Request, Response } from 'express'
import { verifyInternal, requireAuth } from '../middleware/auth'
import { randomUUID as uuidv4 } from 'node:crypto'
import type { Permisos } from '../lib/permisos'
import { prisma, prismaDirectUrl } from '../lib/prisma'
import { logServerError } from '../lib/safe-log'
import { Prisma } from '@prisma/client'
import { parseCheckoutSessionData, type CheckoutSessionData } from './tenant'

const router = Router()

const VALID_ESTADOS = new Set(['disponible', 'reservado', 'vendido', 'bloqueado'])

// Señal interna para abortar una transacción Serializable con un 409 específico, sin que
// el catch genérico de la ruta la confunda con un error real (500).
class SeccionConButacasOcupadasError extends Error {}
class SeccionShrinkBloqueadoError extends Error {}

// Duplicado a propósito (mismo patrón que sessionReferencesEvento en routes/eventos.ts,
// que tampoco se comparte vía export): true si algún item/addon del checkout_session
// referencia este evento_id, cubriendo los 3 shapes de flow (entradas/consumibles/mixto).
function checkoutSessionReferencesEvento(sessionData: CheckoutSessionData, eventoId: string): boolean {
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

// Shared row-letter generation (A, B, ..., Z, AA, AB, ...) — used by /generar and by the
// shrink guard on PATCH .../secciones/:seccionId so both agree on what counts as "in range".
const LETRAS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
function filaLetraForIndex(f: number): string {
  return f < LETRAS.length ? LETRAS[f] : `${LETRAS[Math.floor(f / LETRAS.length) - 1]}${LETRAS[f % LETRAS.length]}`
}

// ---------------------------------------------------------------------------
// Dashboard routes — empresa configures seat map sections for an event
// ---------------------------------------------------------------------------

// GET /api/asientos/:eventoId/secciones
router.get('/:eventoId/secciones', verifyInternal, requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.user!
    const empresaId = user.userType === 'empleado' ? user.empresa_id! : user.id
    const { eventoId } = req.params

    const evento = await prisma.evento.findFirst({
      where: { id: eventoId, empresa_id: empresaId },
      select: { id: true, tipo_mapa: true },
    })
    if (!evento) return res.status(404).json({ error: 'No encontrado' })

    const [secciones, conteosBrutos] = await Promise.all([
      prisma.asientoSeccion.findMany({
        where: { evento_id: eventoId, empresa_id: empresaId },
        orderBy: { orden: 'asc' },
      }),
      prisma.asiento.groupBy({
        by: ['seccion_id', 'estado'],
        where: { evento_id: eventoId, empresa_id: empresaId },
        _count: { id: true },
      }),
    ])

    type Conteos = { disponible: number; reservado: number; vendido: number; bloqueado: number; total: number }
    const conteoMap = new Map<string, Conteos>()
    for (const row of conteosBrutos) {
      const c = conteoMap.get(row.seccion_id) ?? { disponible: 0, reservado: 0, vendido: 0, bloqueado: 0, total: 0 }
      if (row.estado === 'disponible') c.disponible = row._count.id
      else if (row.estado === 'reservado') c.reservado = row._count.id
      else if (row.estado === 'vendido') c.vendido = row._count.id
      else if (row.estado === 'bloqueado') c.bloqueado = row._count.id
      c.total += row._count.id
      conteoMap.set(row.seccion_id, c)
    }

    const seccionesConConteos = secciones.map(s => ({
      ...s,
      total_asientos: conteoMap.get(s.id)?.total ?? 0,
      conteos: conteoMap.get(s.id) ?? { disponible: 0, reservado: 0, vendido: 0, bloqueado: 0, total: 0 },
    }))

    return res.json({ tipo_mapa: evento.tipo_mapa, secciones: seccionesConConteos })
  } catch {
    logServerError('asientos GET secciones')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// POST /api/asientos/:eventoId/secciones
router.post('/:eventoId/secciones', verifyInternal, requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.user!
    const esEmpleado = user.userType === 'empleado'
    const permisos = user.permisos as Permisos | undefined
    const empresaId = esEmpleado ? user.empresa_id! : user.id

    if (esEmpleado && !permisos?.editar_eventos) {
      return res.status(403).json({ error: 'Sin permiso' })
    }

    const { eventoId } = req.params
    const evento = await prisma.evento.findFirst({
      where: { id: eventoId, empresa_id: empresaId },
      select: { id: true },
    })
    if (!evento) return res.status(404).json({ error: 'No encontrado' })

    const { nombre, categoria_id, filas, asientos_por_fila, color, orden } = req.body

    if (!nombre || typeof nombre !== 'string' || !nombre.trim()) {
      return res.status(400).json({ error: 'Nombre de sección requerido' })
    }
    const filasN = Math.max(1, Math.min(Number(filas) || 1, 100))
    const asientosPorFilaN = Math.max(1, Math.min(Number(asientos_por_fila) || 1, 200))

    const seccion = await prisma.asientoSeccion.create({
      data: {
        id: uuidv4(),
        evento_id: eventoId,
        empresa_id: empresaId,
        nombre: nombre.trim(),
        categoria_id: categoria_id || null,
        filas: filasN,
        asientos_por_fila: asientosPorFilaN,
        color: color || null,
        orden: Number(orden) || 0,
      },
    })

    return res.status(201).json({ seccion })
  } catch {
    logServerError('asientos POST seccion')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// PATCH /api/asientos/:eventoId/secciones/:seccionId
router.patch('/:eventoId/secciones/:seccionId', verifyInternal, requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.user!
    const esEmpleado = user.userType === 'empleado'
    const permisos = user.permisos as Permisos | undefined
    const empresaId = esEmpleado ? user.empresa_id! : user.id

    if (esEmpleado && !permisos?.editar_eventos) {
      return res.status(403).json({ error: 'Sin permiso' })
    }

    const { eventoId, seccionId } = req.params
    const seccion = await prisma.asientoSeccion.findFirst({
      where: { id: seccionId, evento_id: eventoId, empresa_id: empresaId },
    })
    if (!seccion) return res.status(404).json({ error: 'No encontrado' })

    const { nombre, categoria_id, filas, asientos_por_fila, color, orden } = req.body

    const filasN = filas !== undefined ? Math.max(1, Math.min(Number(filas) || 1, 100)) : seccion.filas
    const asientosPorFilaN = asientos_por_fila !== undefined
      ? Math.max(1, Math.min(Number(asientos_por_fila) || 1, 200))
      : seccion.asientos_por_fila

    // Shrink guard: si se reduce filas y/o asientos_por_fila, las butacas que quedarían
    // fuera del nuevo rango NO se borran acá (evitamos borrar de más). Si alguna de esas
    // butacas ya está vendida/reservada, bloqueamos el shrink — dejar butacas disponibles
    // huérfanas fuera de rango es deuda menor documentada, no un riesgo de plata/overselling.
    // El check + el update corren en la MISMA transacción Serializable que /reservar usa
    // para tomar el lock — sin esto, una reserva concurrente podría colarse entre el check
    // y el update, y el shrink aplicarse igual sobre una butaca recién ocupada (TOCTOU).
    const isShrinking = filasN < seccion.filas || asientosPorFilaN < seccion.asientos_por_fila
    let updated
    try {
      updated = await prismaDirectUrl.$transaction(async (tx) => {
        if (isShrinking) {
          const ocupados = await tx.asiento.findMany({
            where: { seccion_id: seccionId, estado: { not: 'disponible' } },
            select: { fila: true, numero: true },
          })
          const filasValidas = new Set(Array.from({ length: filasN }, (_, i) => filaLetraForIndex(i)))
          const hayOcupadosFueraDeRango = ocupados.some(
            (a) => !filasValidas.has(a.fila) || a.numero > asientosPorFilaN
          )
          if (hayOcupadosFueraDeRango) {
            throw new SeccionShrinkBloqueadoError()
          }
        }

        return tx.asientoSeccion.update({
          where: { id: seccionId },
          data: {
            nombre: nombre ? String(nombre).trim() : seccion.nombre,
            categoria_id: categoria_id !== undefined ? (categoria_id || null) : seccion.categoria_id,
            filas: filasN,
            asientos_por_fila: asientosPorFilaN,
            color: color !== undefined ? (color || null) : seccion.color,
            orden: orden !== undefined ? (Number(orden) || 0) : seccion.orden,
          },
        })
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    } catch (err) {
      if (err instanceof SeccionShrinkBloqueadoError) {
        return res.status(409).json({ error: 'Hay butacas vendidas o reservadas fuera del nuevo tamaño de sección' })
      }
      throw err
    }

    return res.json({ seccion: updated })
  } catch {
    logServerError('asientos PATCH seccion')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// DELETE /api/asientos/:eventoId/secciones/:seccionId
router.delete('/:eventoId/secciones/:seccionId', verifyInternal, requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.user!
    const esEmpleado = user.userType === 'empleado'
    const permisos = user.permisos as Permisos | undefined
    const empresaId = esEmpleado ? user.empresa_id! : user.id

    if (esEmpleado && !permisos?.editar_eventos) {
      return res.status(403).json({ error: 'Sin permiso' })
    }

    const { eventoId, seccionId } = req.params
    const seccion = await prisma.asientoSeccion.findFirst({
      where: { id: seccionId, evento_id: eventoId, empresa_id: empresaId },
      select: { id: true },
    })
    if (!seccion) return res.status(404).json({ error: 'No encontrado' })

    // Count + delete en la misma transacción Serializable: sin esto, una reserva/venta
    // concurrente (que sí toma FOR UPDATE en /reservar) puede colarse entre el count() y
    // el delete(), y el cascade se lleva puesta una butaca recién reservada o vendida.
    try {
      await prismaDirectUrl.$transaction(async (tx) => {
        const ocupados = await tx.asiento.count({
          where: { seccion_id: seccionId, estado: { in: ['vendido', 'reservado'] } },
        })
        if (ocupados > 0) {
          throw new SeccionConButacasOcupadasError()
        }

        // Cascade in schema handles asientos deletion (only reaches here when none are sold/reserved)
        await tx.asientoSeccion.delete({ where: { id: seccionId } })
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    } catch (err) {
      if (err instanceof SeccionConButacasOcupadasError) {
        return res.status(409).json({ error: 'No se puede eliminar una sección con butacas vendidas o reservadas' })
      }
      throw err
    }

    return res.json({ ok: true })
  } catch {
    logServerError('asientos DELETE seccion')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// POST /api/asientos/:eventoId/secciones/:seccionId/generar
// Idempotent: upserts rows that don't exist, skips already-generated seats
router.post('/:eventoId/secciones/:seccionId/generar', verifyInternal, requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.user!
    const esEmpleado = user.userType === 'empleado'
    const permisos = user.permisos as Permisos | undefined
    const empresaId = esEmpleado ? user.empresa_id! : user.id

    if (esEmpleado && !permisos?.editar_eventos) {
      return res.status(403).json({ error: 'Sin permiso' })
    }

    const { eventoId, seccionId } = req.params
    const seccion = await prisma.asientoSeccion.findFirst({
      where: { id: seccionId, evento_id: eventoId, empresa_id: empresaId },
    })
    if (!seccion) return res.status(404).json({ error: 'No encontrado' })

    const rows: { id: string; seccion_id: string; evento_id: string; empresa_id: string; fila: string; numero: number }[] = []

    for (let f = 0; f < seccion.filas; f++) {
      const letraFila = filaLetraForIndex(f)
      for (let n = 1; n <= seccion.asientos_por_fila; n++) {
        rows.push({
          id: uuidv4(),
          seccion_id: seccionId,
          evento_id: eventoId,
          empresa_id: empresaId,
          fila: letraFila,
          numero: n,
        })
      }
    }

    // skipDuplicates = true makes this idempotent
    const result = await prisma.asiento.createMany({ data: rows, skipDuplicates: true })

    return res.json({ created: result.count, total: rows.length })
  } catch {
    logServerError('asientos POST generar')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// PATCH /api/asientos/:eventoId/secciones/:seccionId/asientos/:asientoId
// Dashboard only: manually block/unblock a specific seat
router.patch(
  '/:eventoId/secciones/:seccionId/asientos/:asientoId',
  verifyInternal,
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const user = req.user!
      const esEmpleado = user.userType === 'empleado'
      const permisos = user.permisos as Permisos | undefined
      const empresaId = esEmpleado ? user.empresa_id! : user.id

      if (esEmpleado && !permisos?.editar_eventos) {
        return res.status(403).json({ error: 'Sin permiso' })
      }

      const { eventoId, seccionId, asientoId } = req.params
      const { estado } = req.body

      if (!estado || !VALID_ESTADOS.has(estado)) {
        return res.status(400).json({ error: 'Estado inválido' })
      }

      const asiento = await prisma.asiento.findFirst({
        where: { id: asientoId, seccion_id: seccionId, evento_id: eventoId, empresa_id: empresaId },
        select: { id: true, estado: true },
      })
      if (!asiento) return res.status(404).json({ error: 'No encontrado' })

      // Dashboard can only block/unblock — it cannot force soldado/reservado
      if (estado === 'vendido' || estado === 'reservado') {
        return res.status(400).json({ error: 'Solo el sistema puede marcar como vendido/reservado' })
      }

      await prisma.asiento.update({ where: { id: asientoId }, data: { estado } })

      return res.json({ ok: true })
    } catch {
      logServerError('asientos PATCH asiento estado')
      return res.status(500).json({ error: 'Error interno del servidor' })
    }
  }
)

// GET /api/asientos/:eventoId/secciones/:seccionId/filas
// Dashboard only: state counts per row, for bulk management
router.get(
  '/:eventoId/secciones/:seccionId/filas',
  verifyInternal,
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const user = req.user!
      const empresaId = user.userType === 'empleado' ? user.empresa_id! : user.id
      const { eventoId, seccionId } = req.params

      const seccion = await prisma.asientoSeccion.findFirst({
        where: { id: seccionId, evento_id: eventoId, empresa_id: empresaId },
        select: { id: true },
      })
      if (!seccion) return res.status(404).json({ error: 'No encontrado' })

      const conteos = await prisma.asiento.groupBy({
        by: ['fila', 'estado'],
        where: { seccion_id: seccionId, evento_id: eventoId, empresa_id: empresaId },
        _count: { id: true },
      })

      type FilaData = { fila: string; disponible: number; reservado: number; vendido: number; bloqueado: number; total: number }
      const filaMap = new Map<string, FilaData>()
      for (const row of conteos) {
        const d = filaMap.get(row.fila) ?? { fila: row.fila, disponible: 0, reservado: 0, vendido: 0, bloqueado: 0, total: 0 }
        if (row.estado === 'disponible') d.disponible = row._count.id
        else if (row.estado === 'reservado') d.reservado = row._count.id
        else if (row.estado === 'vendido') d.vendido = row._count.id
        else if (row.estado === 'bloqueado') d.bloqueado = row._count.id
        d.total += row._count.id
        filaMap.set(row.fila, d)
      }

      const filas = [...filaMap.values()].sort((a, b) => a.fila.localeCompare(b.fila))
      return res.json({ filas })
    } catch {
      logServerError('asientos GET filas')
      return res.status(500).json({ error: 'Error interno del servidor' })
    }
  }
)

// POST /api/asientos/:eventoId/secciones/:seccionId/filas/:fila/bloquear
// Dashboard only: bulk block/unblock all eligible seats in a row
router.post(
  '/:eventoId/secciones/:seccionId/filas/:fila/bloquear',
  verifyInternal,
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const user = req.user!
      const esEmpleado = user.userType === 'empleado'
      const permisos = user.permisos as Permisos | undefined
      const empresaId = esEmpleado ? user.empresa_id! : user.id

      if (esEmpleado && !permisos?.editar_eventos) {
        return res.status(403).json({ error: 'Sin permiso' })
      }

      const { eventoId, seccionId, fila } = req.params
      const { accion } = req.body

      if (accion !== 'bloquear' && accion !== 'desbloquear') {
        return res.status(400).json({ error: 'accion debe ser "bloquear" o "desbloquear"' })
      }

      const seccion = await prisma.asientoSeccion.findFirst({
        where: { id: seccionId, evento_id: eventoId, empresa_id: empresaId },
        select: { id: true },
      })
      if (!seccion) return res.status(404).json({ error: 'No encontrado' })

      const estadoOrigen = accion === 'bloquear' ? 'disponible' : 'bloqueado'
      const estadoDestino = accion === 'bloquear' ? 'bloqueado' : 'disponible'

      const result = await prisma.asiento.updateMany({
        where: { seccion_id: seccionId, evento_id: eventoId, empresa_id: empresaId, fila, estado: estadoOrigen },
        data: { estado: estadoDestino },
      })

      return res.json({ ok: true, actualizados: result.count })
    } catch {
      logServerError('asientos POST bloquear fila')
      return res.status(500).json({ error: 'Error interno del servidor' })
    }
  }
)

// POST /api/asientos/:eventoId/secciones/:seccionId/bloquear
// Dashboard only: bulk block/unblock ALL eligible seats in a section at once
router.post(
  '/:eventoId/secciones/:seccionId/bloquear',
  verifyInternal,
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const user = req.user!
      const esEmpleado = user.userType === 'empleado'
      const permisos = user.permisos as Permisos | undefined
      const empresaId = esEmpleado ? user.empresa_id! : user.id

      if (esEmpleado && !permisos?.editar_eventos) {
        return res.status(403).json({ error: 'Sin permiso' })
      }

      const { eventoId, seccionId } = req.params
      const { accion } = req.body

      if (accion !== 'bloquear' && accion !== 'desbloquear') {
        return res.status(400).json({ error: 'accion debe ser "bloquear" o "desbloquear"' })
      }

      const seccion = await prisma.asientoSeccion.findFirst({
        where: { id: seccionId, evento_id: eventoId, empresa_id: empresaId },
        select: { id: true },
      })
      if (!seccion) return res.status(404).json({ error: 'No encontrado' })

      const estadoOrigen = accion === 'bloquear' ? 'disponible' : 'bloqueado'
      const estadoDestino = accion === 'bloquear' ? 'bloqueado' : 'disponible'

      const result = await prisma.asiento.updateMany({
        where: { seccion_id: seccionId, evento_id: eventoId, empresa_id: empresaId, estado: estadoOrigen },
        data: { estado: estadoDestino },
      })

      return res.json({ ok: true, actualizados: result.count })
    } catch {
      logServerError('asientos POST bloquear seccion')
      return res.status(500).json({ error: 'Error interno del servidor' })
    }
  }
)

// ---------------------------------------------------------------------------
// Public routes — buyer-facing seat availability
// ---------------------------------------------------------------------------

// GET /api/asientos/:eventoId/disponibilidad
// Returns sections with each seat's current estado (no buyer PII)
router.get('/:eventoId/disponibilidad', async (req: Request, res: Response) => {
  try {
    const { eventoId } = req.params

    const evento = await prisma.evento.findFirst({
      where: { id: eventoId, activo: true },
      select: { tipo_mapa: true },
    })
    if (!evento) return res.status(404).json({ error: 'No encontrado' })
    if (evento.tipo_mapa !== 'numerado') {
      return res.status(400).json({ error: 'Este evento no tiene mapa de asientos' })
    }

    const secciones = await prisma.asientoSeccion.findMany({
      where: { evento_id: eventoId },
      orderBy: { orden: 'asc' },
      include: {
        asientos: {
          select: { id: true, fila: true, numero: true, estado: true, reserved_until: true },
          orderBy: [{ fila: 'asc' }, { numero: 'asc' }],
        },
      },
    })

    // Defensa en profundidad: si el cleanup job (corre cada 30s) todavía no liberó una
    // reserva vencida, no la mostremos como ocupada — no reemplaza al job, lo complementa.
    const now = new Date()
    const seccionesConEstadoEfectivo = secciones.map((s) => ({
      ...s,
      asientos: s.asientos.map(({ reserved_until, ...a }) => ({
        ...a,
        estado: a.estado === 'reservado' && reserved_until && reserved_until < now ? 'disponible' : a.estado,
      })),
    }))

    return res.json({ secciones: seccionesConEstadoEfectivo })
  } catch {
    logServerError('asientos GET disponibilidad')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// ---------------------------------------------------------------------------
// Checkout integration — reserve / release seats
// Called internally from checkout flow (same internal-secret auth)
// ---------------------------------------------------------------------------

// POST /api/asientos/reservar
// Body: { evento_id: string, asiento_ids: string[], checkout_session_id: string, ttl_seconds?: number }
// Uses Serializable isolation + SELECT FOR UPDATE to avoid double-booking.
//
// evento_id is REQUIRED and used to scope the lock query — without it, a caller could pass
// asiento_ids belonging to a DIFFERENT evento/empresa (harvested from the public
// /disponibilidad endpoint) and hijack another tenant's seats. Any asiento_id that doesn't
// belong to evento_id is treated exactly like "not available" (409 ASIENTOS_NO_DISPONIBLES) —
// never a distinct error, so this endpoint can't be used to probe whether a seat id exists
// in someone else's event.
//
// checkout_session_id is ALSO cross-checked against evento_id (400 CHECKOUT_SESSION_EVENTO_MISMATCH)
// whenever it already resolves to a real checkout_sessions row — see checkoutSessionReferencesEvento
// above. Without this, a real session created for Event A could be replayed here to lock Event B's
// seats until the TTL expires (repeatable cross-tenant stock-sabotage/DoS).
router.post('/reservar', verifyInternal, async (req: Request, res: Response) => {
  try {
    const { asiento_ids, checkout_session_id, ttl_seconds, evento_id } = req.body

    if (!Array.isArray(asiento_ids) || !asiento_ids.length) {
      return res.status(400).json({ error: 'asiento_ids requerido' })
    }
    if (!checkout_session_id || typeof checkout_session_id !== 'string') {
      return res.status(400).json({ error: 'checkout_session_id requerido' })
    }
    if (!evento_id || typeof evento_id !== 'string') {
      return res.status(400).json({ error: 'evento_id requerido' })
    }

    // Dedupe: repeated ids in the body must not make the length check below fail spuriously.
    const uniqueAsientoIds = [...new Set(asiento_ids as unknown[])].filter(
      (id): id is string => typeof id === 'string' && id.length > 0
    )
    if (!uniqueAsientoIds.length) {
      return res.status(400).json({ error: 'asiento_ids requerido' })
    }
    if (uniqueAsientoIds.length > 20) {
      return res.status(400).json({ error: 'Máximo 20 asientos por checkout' })
    }

    const ttl = Math.max(60, Math.min(Number(ttl_seconds) || 600, 1800))
    const reservedUntil = new Date(Date.now() + ttl * 1000)
    const placeholders = uniqueAsientoIds.map((_, i) => `$${i + 2}`).join(', ')

    await prismaDirectUrl.$transaction(async (tx) => {
      // Defense in depth: checkout_session_id is normally a fresh reservation token minted
      // by the BFF BEFORE the checkout_sessions row exists, so in the common case no row is
      // found here and we proceed. But if it DOES already reference a real checkout_sessions
      // row (e.g. reused from an earlier/different checkout attempt), that row must belong to
      // THIS evento_id. Otherwise a cheap session created for Event A (any empresa) could be
      // replayed here to lock real seats of Event B — a cross-tenant stock-sabotage/DoS vector,
      // since nothing else ties checkout_session_id to an evento_id before this point.
      const existingSessions = await tx.$queryRaw<{ datos: string }[]>`
        SELECT datos FROM checkout_sessions WHERE id = ${checkout_session_id}
      `
      if (existingSessions.length > 0) {
        let sessionData: CheckoutSessionData
        try {
          sessionData = parseCheckoutSessionData(existingSessions[0]!.datos)
        } catch {
          throw new Error('CHECKOUT_SESSION_EVENTO_MISMATCH')
        }
        if (!checkoutSessionReferencesEvento(sessionData, evento_id)) {
          throw new Error('CHECKOUT_SESSION_EVENTO_MISMATCH')
        }
      }

      // Lock the rows scoped to evento_id — will fail if any is already reserved/sold,
      // OR belongs to a different evento (indistinguishable from "unavailable" below).
      const locked = await tx.$queryRawUnsafe<{ id: string; estado: string; reserved_until: Date | null }[]>(
        `SELECT id, estado, reserved_until FROM asientos WHERE evento_id = $1 AND id IN (${placeholders}) FOR UPDATE`,
        evento_id,
        ...uniqueAsientoIds
      )

      if (locked.length !== uniqueAsientoIds.length) {
        throw new Error('ASIENTOS_NO_DISPONIBLES')
      }

      const now = new Date()
      const unavailable = locked.filter((a) => {
        if (a.estado === 'disponible') return false
        // Defensa en profundidad: si el cleanup job todavía no liberó una reserva vencida,
        // no bloqueemos al siguiente comprador por eso — no reemplaza al job, lo complementa.
        if (a.estado === 'reservado' && a.reserved_until && a.reserved_until < now) return false
        return true
      })
      if (unavailable.length) {
        throw new Error('ASIENTOS_NO_DISPONIBLES')
      }

      const idxPlaceholders = uniqueAsientoIds.map((_, i) => `$${i + 3}`).join(', ')
      await tx.$executeRawUnsafe(
        `UPDATE asientos SET estado = 'reservado', checkout_session_id = $1, reserved_until = $2 WHERE id IN (${idxPlaceholders})`,
        checkout_session_id,
        reservedUntil,
        ...uniqueAsientoIds
      )
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

    return res.json({ ok: true, reserved_until: reservedUntil })
  } catch (err) {
    const msg = err instanceof Error ? err.message : ''
    if (msg === 'ASIENTOS_NO_DISPONIBLES') return res.status(409).json({ error: 'Uno o más asientos ya no están disponibles' })
    if (msg === 'CHECKOUT_SESSION_EVENTO_MISMATCH') return res.status(400).json({ error: 'checkout_session_id no corresponde a este evento' })
    logServerError('asientos POST reservar')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// NOTE: this router used to also expose POST /liberar and POST /confirmar. Both were dead
// code (nothing — no BFF route, no internal fetch — ever called them) and /confirmar was
// LESS safe than the real confirm logic: it marked seats 'vendido' without checking
// estado='reservado' AND checkout_session_id=<the actual reservation>, so it could double-sell
// a seat reserved by someone else. Removed rather than left as a trap for a future caller.
// Seat release on checkout expiry runs inline in services/checkoutCleanup.ts; seat confirm on
// payment success runs inline in routes/tenant.ts (POST /tenant/:slug/checkout) — both scoped
// correctly to estado='reservado' + checkout_session_id.

export default router
