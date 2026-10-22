// Add-ons del evento: parking, meet&greet, merch, etc.
//
// Modelo:
// - Cada evento tiene N addons (CRUD admin via /api/eventos/:id/addons)
// - Stock independiente de las categorías de entradas
// - En el checkout, el comprador suma cantidad de cada addon a su carrito
// - Al confirmar pago, cada unidad genera 1 QR único en evento_addon_ventas
// - El escanear hace fallback: si el QR no es entrada ni ticket físico, busca addon_venta
//
// Fee billing: si la empresa tiene modo='passed_to_buyer', el precio del addon se infla
// igual que las entradas (proporcionalmente respecto al marketplace_fee total).

import { randomUUID as uuidv4 } from 'node:crypto'
import { prisma, prismaDirectUrl } from './prisma'

export type AddonInput = {
  nombre: string
  descripcion?: string | null
  precio: number
  stock: number
  max_por_compra?: number
  activo?: boolean
  orden_visual?: number
}

export type AddonRow = {
  id: string
  evento_id: string
  empresa_id: string
  nombre: string
  descripcion: string | null
  precio: number
  stock: number
  stock_disponible: number
  max_por_compra: number
  activo: boolean
  orden_visual: number
  created_at: string
  updated_at: string
}

function serialize(row: {
  id: string
  evento_id: string
  empresa_id: string
  nombre: string
  descripcion: string | null
  precio: number | string | { toString(): string }
  stock: number
  stock_disponible: number
  max_por_compra: number
  activo: boolean
  orden_visual: number
  created_at: Date
  updated_at: Date
}): AddonRow {
  return {
    id: row.id,
    evento_id: row.evento_id,
    empresa_id: row.empresa_id,
    nombre: row.nombre,
    descripcion: row.descripcion,
    precio: Number(row.precio),
    stock: row.stock,
    stock_disponible: row.stock_disponible,
    max_por_compra: row.max_por_compra,
    activo: row.activo,
    orden_visual: row.orden_visual,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  }
}

function validateInput(input: AddonInput) {
  if (!input.nombre?.trim()) throw new Error('nombre es obligatorio')
  if (input.nombre.length > 191) throw new Error('nombre demasiado largo (max 191)')
  if (!Number.isFinite(input.precio) || input.precio < 0) throw new Error('precio inválido')
  if (!Number.isInteger(input.stock) || input.stock < 0 || input.stock > 100000) throw new Error('stock debe ser entero 0-100000')
  if (input.max_por_compra !== undefined && (!Number.isInteger(input.max_por_compra) || input.max_por_compra < 1 || input.max_por_compra > 100)) {
    throw new Error('max_por_compra debe ser entero 1-100')
  }
}

export async function listAddonsByEvento(eventoId: string, options: { onlyActive?: boolean } = {}) {
  const rows = await prisma.eventoAddon.findMany({
    where: { evento_id: eventoId, ...(options.onlyActive ? { activo: true } : {}) },
    orderBy: [{ orden_visual: 'asc' }, { created_at: 'asc' }],
  })
  return rows.map(serialize)
}

export async function createAddon(input: { empresaId: string; eventoId: string } & AddonInput): Promise<AddonRow> {
  validateInput(input)
  const evento = await prisma.evento.findFirst({
    where: { id: input.eventoId, empresa_id: input.empresaId },
    select: { id: true },
  })
  if (!evento) throw new Error('Evento no encontrado para esta empresa')

  const created = await prisma.eventoAddon.create({
    data: {
      id: uuidv4(),
      evento_id: input.eventoId,
      empresa_id: input.empresaId,
      nombre: input.nombre.trim(),
      descripcion: input.descripcion?.trim() || null,
      precio: input.precio,
      stock: input.stock,
      stock_disponible: input.stock,
      max_por_compra: input.max_por_compra ?? 10,
      activo: input.activo ?? true,
      orden_visual: input.orden_visual ?? 0,
    },
  })
  return serialize(created)
}

export async function updateAddon(addonId: string, empresaId: string, input: Partial<AddonInput>): Promise<AddonRow> {
  const existing = await prisma.eventoAddon.findFirst({ where: { id: addonId, empresa_id: empresaId } })
  if (!existing) throw new Error('Addon no encontrado')

  // Validar campos que vienen
  if (input.nombre !== undefined && !input.nombre.trim()) throw new Error('nombre no puede ser vacío')
  if (input.precio !== undefined && (!Number.isFinite(input.precio) || input.precio < 0)) throw new Error('precio inválido')

  let newStockDisponible: number | undefined
  if (input.stock !== undefined) {
    if (!Number.isInteger(input.stock) || input.stock < 0 || input.stock > 100000) throw new Error('stock debe ser entero 0-100000')
    // Respetar stock comprometido (no permitir bajar por debajo de lo ya vendido)
    const stockComprometido = Math.max(existing.stock - existing.stock_disponible, 0)
    if (input.stock < stockComprometido) {
      throw new Error(`No se puede bajar el stock por debajo del comprometido (${stockComprometido} unidades ya vendidas)`)
    }
    newStockDisponible = input.stock - stockComprometido
  }

  const updated = await prisma.eventoAddon.update({
    where: { id: addonId },
    data: {
      ...(input.nombre !== undefined ? { nombre: input.nombre.trim() } : {}),
      ...(input.descripcion !== undefined ? { descripcion: input.descripcion?.trim() || null } : {}),
      ...(input.precio !== undefined ? { precio: input.precio } : {}),
      ...(input.stock !== undefined ? { stock: input.stock, stock_disponible: newStockDisponible } : {}),
      ...(input.max_por_compra !== undefined ? { max_por_compra: input.max_por_compra } : {}),
      ...(input.activo !== undefined ? { activo: input.activo } : {}),
      ...(input.orden_visual !== undefined ? { orden_visual: input.orden_visual } : {}),
    },
  })
  return serialize(updated)
}

export async function deleteAddon(addonId: string, empresaId: string): Promise<void> {
  const existing = await prisma.eventoAddon.findFirst({
    where: { id: addonId, empresa_id: empresaId },
    select: { id: true, stock: true, stock_disponible: true },
  })
  if (!existing) throw new Error('Addon no encontrado')
  const stockComprometido = Math.max(existing.stock - existing.stock_disponible, 0)
  if (stockComprometido > 0) {
    // No borrar si ya tiene ventas. Mejor desactivarlo.
    throw new Error('No se puede eliminar un addon con ventas. Desactivalo en su lugar.')
  }
  await prisma.eventoAddon.delete({ where: { id: addonId } })
}

// ============================================================
// Stock locking (para usar dentro de tx del checkout)
// ============================================================

export type AddonCheckoutItem = {
  addonId: string
  cantidad: number
  precio: number     // precio congelado al momento del checkout
  nombre: string     // snapshot
}

export async function reserveAddonStock(
  tx: Awaited<ReturnType<typeof prismaDirectUrl.$transaction>> | typeof prismaDirectUrl,
  empresaId: string,
  items: AddonCheckoutItem[],
): Promise<void> {
  // Esta función espera ser llamada dentro de una transacción Serializable activa.
  // Pero como Prisma no exporta el tx context limpiamente, le pasamos el tx desde fuera.
  // Por ahora documentamos el contrato: usar SOLO dentro de una tx ya iniciada.
  void tx
  void empresaId
  void items
  throw new Error('reserveAddonStock: usar inline en la tx del checkout, no como helper independiente')
}
