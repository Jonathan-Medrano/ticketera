// Waitlist — lista de espera cuando una categoría está agotada.
//
// Flujo:
// 1. Comprador entra a evento → ve categoría con stock=0 → click "Anotarme en lista"
// 2. registerWaitlist crea entry en estado 'esperando'
// 3. Cuando se libera stock (refund / expiración de checkout reservado / stock manual):
//    `promoteNextForCategoria(categoria_id, cantidad)` busca el primer 'esperando',
//    valida que cantidad_solicitada <= cantidad liberada, lo pasa a 'asignado',
//    setea expires_at = NOW() + 15 min, devuelve datos para mandar email
// 4. Si el comprador completa la compra antes de expires_at → estado 'comprado'
// 5. Si no compra a tiempo → cron lo pasa a 'expirado' + libera stock + intenta promover al siguiente
// 6. Comprador puede cancelar en cualquier momento → estado 'cancelado'

import { randomUUID as uuidv4 } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma, prismaDirectUrl } from './prisma'

export type WaitlistEstado = 'esperando' | 'asignado' | 'comprado' | 'expirado' | 'cancelado'

export const WAITLIST_HOLD_MINUTES = 15

export type WaitlistEntry = {
  id: string
  empresa_id: string
  evento_id: string
  categoria_id: string
  fecha_id: string | null
  comprador_id: string
  cantidad_solicitada: number
  estado: WaitlistEstado
  asignado_at: string | null
  expires_at: string | null
  notificado_at: string | null
  cancelado_at: string | null
  comprado_at: string | null
  created_at: string
  updated_at: string
}

function serialize(row: {
  id: string
  empresa_id: string
  evento_id: string
  categoria_id: string
  fecha_id: string | null
  comprador_id: string
  cantidad_solicitada: number
  estado: string
  asignado_at: Date | null
  expires_at: Date | null
  notificado_at: Date | null
  cancelado_at: Date | null
  comprado_at: Date | null
  created_at: Date
  updated_at: Date
}): WaitlistEntry {
  return {
    id: row.id,
    empresa_id: row.empresa_id,
    evento_id: row.evento_id,
    categoria_id: row.categoria_id,
    fecha_id: row.fecha_id,
    comprador_id: row.comprador_id,
    cantidad_solicitada: row.cantidad_solicitada,
    estado: row.estado as WaitlistEstado,
    asignado_at: row.asignado_at?.toISOString() ?? null,
    expires_at: row.expires_at?.toISOString() ?? null,
    notificado_at: row.notificado_at?.toISOString() ?? null,
    cancelado_at: row.cancelado_at?.toISOString() ?? null,
    comprado_at: row.comprado_at?.toISOString() ?? null,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  }
}

// ============================================================
// REGISTER — comprador se anota en la lista
// ============================================================

export type RegisterWaitlistInput = {
  empresaId: string
  eventoId: string
  categoriaId: string
  fechaId?: string | null
  compradorId: string
  cantidadSolicitada: number
}

export async function registerWaitlist(input: RegisterWaitlistInput): Promise<WaitlistEntry> {
  if (!Number.isInteger(input.cantidadSolicitada) || input.cantidadSolicitada < 1 || input.cantidadSolicitada > 10) {
    throw new Error('cantidad debe ser un entero entre 1 y 10')
  }

  // Validar que la categoría existe y está agotada
  const categoria = await prisma.entradaCategoria.findFirst({
    where: { id: input.categoriaId, evento_id: input.eventoId, activa: true },
    select: { id: true, stock_disponible: true, nombre: true },
  })
  if (!categoria) throw new Error('Categoría no encontrada o inactiva')
  if (categoria.stock_disponible > 0) {
    throw new Error('La categoría tiene stock disponible, no hace falta anotarse en lista de espera')
  }

  // Validar que el comprador no esté ya anotado para esta categoría (en estado 'esperando' o 'asignado')
  const existing = await prisma.waitlistEntry.findFirst({
    where: {
      comprador_id: input.compradorId,
      categoria_id: input.categoriaId,
      estado: { in: ['esperando', 'asignado'] },
    },
    select: { id: true, estado: true },
  })
  if (existing) {
    throw new Error('Ya estás anotado en la lista de espera de esta categoría')
  }

  const created = await prisma.waitlistEntry.create({
    data: {
      id: uuidv4(),
      empresa_id: input.empresaId,
      evento_id: input.eventoId,
      categoria_id: input.categoriaId,
      fecha_id: input.fechaId ?? null,
      comprador_id: input.compradorId,
      cantidad_solicitada: input.cantidadSolicitada,
      estado: 'esperando',
    },
  })
  return serialize(created)
}

// ============================================================
// LIST — comprador ve sus propios entries
// ============================================================

export async function listWaitlistByComprador(compradorId: string, empresaId: string): Promise<WaitlistEntry[]> {
  const rows = await prisma.waitlistEntry.findMany({
    where: {
      comprador_id: compradorId,
      empresa_id: empresaId,
      estado: { in: ['esperando', 'asignado'] },
    },
    orderBy: { created_at: 'desc' },
  })
  return rows.map(serialize)
}

// Posición del comprador en la lista de espera de una categoría
export async function getPositionInCategoria(categoriaId: string, compradorId: string): Promise<number | null> {
  const me = await prisma.waitlistEntry.findFirst({
    where: { categoria_id: categoriaId, comprador_id: compradorId, estado: 'esperando' },
    select: { created_at: true },
  })
  if (!me) return null
  const ahead = await prisma.waitlistEntry.count({
    where: {
      categoria_id: categoriaId,
      estado: 'esperando',
      created_at: { lt: me.created_at },
    },
  })
  return ahead + 1
}

// ============================================================
// CANCEL — comprador se baja de la lista
// ============================================================

export async function cancelWaitlist(entryId: string, compradorId: string): Promise<WaitlistEntry> {
  const entry = await prisma.waitlistEntry.findFirst({
    where: { id: entryId, comprador_id: compradorId },
  })
  if (!entry) throw new Error('Entry no encontrado')
  if (entry.estado === 'comprado') throw new Error('No podés cancelar un waitlist ya completado')

  const updated = await prisma.waitlistEntry.update({
    where: { id: entryId },
    data: { estado: 'cancelado', cancelado_at: new Date() },
  })
  return serialize(updated)
}

// ============================================================
// LIST ADMIN — dashboard empresa ve la lista
// ============================================================

export async function listWaitlistByEvento(empresaId: string, eventoId: string) {
  const entries = await prisma.waitlistEntry.findMany({
    where: { empresa_id: empresaId, evento_id: eventoId },
    orderBy: [{ estado: 'asc' }, { created_at: 'asc' }],
    take: 500,
  })
  if (entries.length === 0) return []

  const compradorIds = Array.from(new Set(entries.map((e) => e.comprador_id)))
  const categoriaIds = Array.from(new Set(entries.map((e) => e.categoria_id)))
  const [compradores, categorias] = await Promise.all([
    prisma.comprador.findMany({
      where: { id: { in: compradorIds } },
      select: { id: true, nombre: true, apellido: true, email: true },
    }),
    prisma.entradaCategoria.findMany({
      where: { id: { in: categoriaIds } },
      select: { id: true, nombre: true },
    }),
  ])
  const compradorMap = new Map(compradores.map((c) => [c.id, c]))
  const categoriaMap = new Map(categorias.map((c) => [c.id, c]))

  return entries.map((e) => ({
    ...serialize(e),
    comprador_nombre: compradorMap.get(e.comprador_id)?.nombre ?? '',
    comprador_apellido: compradorMap.get(e.comprador_id)?.apellido ?? null,
    comprador_email: compradorMap.get(e.comprador_id)?.email ?? null,
    categoria_nombre: categoriaMap.get(e.categoria_id)?.nombre ?? '',
  }))
}

// ============================================================
// PROMOTE — cuando se libera stock, asignar al siguiente
// ============================================================
//
// Se llama desde:
// - checkoutCleanupJob después de liberar stock de una reserva expirada
// - flow de refund después de restaurar stock
// - endpoint admin manual ("promover siguiente")
// - cron de expiración (después de marcar un waitlist como 'expirado')
//
// Atomic: lockea waitlist + categoria con FOR UPDATE, decrementa stock, asigna.

export type PromotionResult = {
  promoted: boolean
  entry?: WaitlistEntry & { comprador_email: string | null; comprador_nombre: string; evento_nombre: string; categoria_nombre: string }
  reason?: string
}

export async function promoteNextForCategoria(categoriaId: string): Promise<PromotionResult> {
  try {
    return await prismaDirectUrl.$transaction(
      async (tx) => {
        // Lock the categoria row first
        const catRows = await tx.$queryRaw<Array<{ id: string; stock_disponible: number }>>`
          SELECT id, stock_disponible FROM entrada_categorias WHERE id = ${categoriaId} FOR UPDATE
        `
        const cat = catRows[0]
        if (!cat || cat.stock_disponible <= 0) {
          return { promoted: false, reason: 'sin_stock' }
        }

        // Tomar el primer waitlist 'esperando' con cantidad <= stock disponible
        // SKIP LOCKED para evitar deadlocks con otra promoción concurrente
        const nextRows = await tx.$queryRaw<Array<{ id: string; cantidad_solicitada: number; comprador_id: string; evento_id: string; categoria_id: string; empresa_id: string }>>`
          SELECT id, cantidad_solicitada, comprador_id, evento_id, categoria_id, empresa_id
          FROM waitlist_entries
          WHERE categoria_id = ${categoriaId}
            AND estado = 'esperando'
            AND cantidad_solicitada <= ${cat.stock_disponible}
          ORDER BY created_at ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        `
        const next = nextRows[0]
        if (!next) {
          return { promoted: false, reason: 'sin_waitlist' }
        }

        // Decrementar stock (reservar el cupo para esta persona durante el hold)
        await tx.$executeRaw`
          UPDATE entrada_categorias SET stock_disponible = stock_disponible - ${next.cantidad_solicitada} WHERE id = ${categoriaId}
        `

        // Marcar entry como 'asignado'
        const now = new Date()
        const expiresAt = new Date(now.getTime() + WAITLIST_HOLD_MINUTES * 60 * 1000)
        await tx.waitlistEntry.update({
          where: { id: next.id },
          data: {
            estado: 'asignado',
            asignado_at: now,
            expires_at: expiresAt,
            notificado_at: now,
          },
        })

        // Get display data for email
        const [comprador, evento, categoria, full] = await Promise.all([
          tx.comprador.findUnique({ where: { id: next.comprador_id }, select: { nombre: true, email: true } }),
          tx.evento.findUnique({ where: { id: next.evento_id }, select: { nombre: true } }),
          tx.entradaCategoria.findUnique({ where: { id: next.categoria_id }, select: { nombre: true } }),
          tx.waitlistEntry.findUnique({ where: { id: next.id } }),
        ])

        if (!full) throw new Error('Waitlist entry desapareció (race)')

        return {
          promoted: true,
          entry: {
            ...serialize(full),
            comprador_email: comprador?.email ?? null,
            comprador_nombre: comprador?.nombre ?? '',
            evento_nombre: evento?.nombre ?? '',
            categoria_nombre: categoria?.nombre ?? '',
          },
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15_000 },
    )
  } catch (err) {
    // Failsafe: si falla la promoción, NO la consideramos fatal (el stock queda libre,
    // la próxima oportunidad lo intenta de nuevo).
    return { promoted: false, reason: err instanceof Error ? err.message : 'error' }
  }
}

// ============================================================
// EXPIRE — cron: marcar expirados, restaurar stock, intentar promover
// ============================================================

export async function expireOverdueWaitlists(): Promise<{ expired: number; restoredStock: number }> {
  const now = new Date()
  // Find all asignado con expires_at < now
  const overdue = await prisma.waitlistEntry.findMany({
    where: { estado: 'asignado', expires_at: { lt: now } },
    select: { id: true, categoria_id: true, cantidad_solicitada: true },
    take: 100,
  })
  if (overdue.length === 0) return { expired: 0, restoredStock: 0 }

  let restoredStock = 0
  for (const entry of overdue) {
    try {
      await prismaDirectUrl.$transaction(async (tx) => {
        // Mark expired
        const updateResult = await tx.waitlistEntry.updateMany({
          where: { id: entry.id, estado: 'asignado', expires_at: { lt: now } },
          data: { estado: 'expirado' },
        })
        if (updateResult.count > 0) {
          await tx.$executeRaw`UPDATE entrada_categorias SET stock_disponible = stock_disponible + ${entry.cantidad_solicitada} WHERE id = ${entry.categoria_id}`
          restoredStock += entry.cantidad_solicitada
        }
      })
    } catch {
      // Skip, retry next tick
    }

    // After expiry + stock restore, attempt to promote next person
    await promoteNextForCategoria(entry.categoria_id).catch(() => undefined)
  }

  return { expired: overdue.length, restoredStock }
}

// ============================================================
// MARK PURCHASED — cuando el comprador completa la compra dentro del hold
// ============================================================

export async function markWaitlistAsPurchased(compradorId: string, categoriaId: string): Promise<void> {
  await prisma.waitlistEntry.updateMany({
    where: {
      comprador_id: compradorId,
      categoria_id: categoriaId,
      estado: 'asignado',
    },
    data: { estado: 'comprado', comprado_at: new Date() },
  })
}
