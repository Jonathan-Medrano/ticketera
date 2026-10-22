// POS móvil — venta presencial desde dashboard (boletería en puerta, festival, kiosko).
//
// Stack: reusa la misma mecánica que el flujo de checkout online en tenant.ts,
// pero SALTÁNDOSE el paso de checkout_sessions + webhook MP. Acá el cobro físico
// ya pasó (efectivo / tarjeta manual / transferencia) y solo registramos la venta.
//
// Garantías de concurrencia:
//   - Stock decrement via SELECT ... FOR UPDATE en entrada_categorias (lock fila),
//     dentro de un Serializable tx en prismaDirectUrl (NUNCA pooler — PgBouncer
//     transaction mode rompe los locks transaccionales).
//   - clave_corta con retry P2002 (igual que checkout online).

import { randomUUID as uuidv4 } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma, prismaDirectUrl } from './prisma'
import { generateSecureShortCode } from './secure-code'

export type MedioPagoPresencial = 'efectivo' | 'tarjeta_manual' | 'transferencia' | 'mp_point'

export const MEDIOS_PAGO_PRESENCIAL: MedioPagoPresencial[] = [
  'efectivo',
  'tarjeta_manual',
  'transferencia',
  'mp_point',
]

export type CrearVentaPresencialInput = {
  empresaId: string
  eventoId: string
  categoriaId: string
  fechaId?: string | null
  cantidad: number
  medioPago: MedioPagoPresencial
  precioCobrado?: number | null // null → toma precio actual de categoria
  vendidoByUserId: string // empleado/admin que registra la venta
  // Comprador opcional (si no se ingresa, se crea uno placeholder por venta)
  compradorNombre?: string | null
  compradorApellido?: string | null
  compradorEmail?: string | null
  compradorDni?: string | null
  compradorTelefono?: string | null
}

export type EntradaCreada = {
  id: string
  qr_code: string
  clave_corta: string
  precio_pagado: number
}

export type CrearVentaPresencialResult = {
  empresa_id: string
  evento_id: string
  evento_nombre: string
  categoria_id: string
  categoria_nombre: string
  cantidad: number
  precio_unitario: number
  precio_total: number
  medio_pago: MedioPagoPresencial
  entradas: EntradaCreada[]
  comprador_id: string
}

const CANTIDAD_MAX_POR_VENTA = 100

export async function crearVentaPresencial(input: CrearVentaPresencialInput): Promise<CrearVentaPresencialResult> {
  // ---- Validaciones de entrada ----
  if (!Number.isInteger(input.cantidad) || input.cantidad < 1 || input.cantidad > CANTIDAD_MAX_POR_VENTA) {
    throw new Error(`cantidad debe ser un entero entre 1 y ${CANTIDAD_MAX_POR_VENTA}`)
  }
  if (!MEDIOS_PAGO_PRESENCIAL.includes(input.medioPago)) {
    throw new Error(`medio_pago inválido: ${input.medioPago}`)
  }
  // mp_point se reservará cuando exista integración con Orders API. Por ahora bloqueamos.
  if (input.medioPago === 'mp_point') {
    throw new Error('MP Point todavía no está integrado — usá efectivo, tarjeta_manual o transferencia')
  }

  // ---- Verify event + category belong to empresa AND empresa tiene feature flag ON ----
  const empresa = await prisma.empresa.findFirst({
    where: { id: input.empresaId, activa: true },
    select: { id: true, pos_movil_habilitado: true, nombre: true },
  })
  if (!empresa) throw new Error('Empresa no encontrada o inactiva')
  if (!empresa.pos_movil_habilitado) {
    throw new Error('El POS móvil no está habilitado para esta empresa. Pedile al super-admin que lo active.')
  }

  // Pre-flight: verificar que el evento + categoria existen y pertenecen a la empresa.
  // El precio final lo tomamos DENTRO del FOR UPDATE para tener el más actualizado.
  const evento = await prisma.evento.findFirst({
    where: { id: input.eventoId, empresa_id: input.empresaId },
    select: { id: true, nombre: true },
  })
  if (!evento) throw new Error('Evento no encontrado para esta empresa')

  // ---- Transacción serializable con stock lock ----
  return await prismaDirectUrl.$transaction(
    async (tx) => {
      // FOR UPDATE en la fila de la categoria — bloquea hasta commit/rollback
      type CategoriaLockRow = { id: string; nombre: string; precio: string | number; stock_disponible: number; activa: boolean }
      const catRows = await tx.$queryRaw<CategoriaLockRow[]>`
        SELECT id, nombre, precio, stock_disponible, activa
        FROM entrada_categorias
        WHERE id = ${input.categoriaId} AND evento_id = ${input.eventoId}
        FOR UPDATE
      `
      const catRow = catRows[0]
      if (!catRow) throw new Error('Categoría no encontrada')
      if (!catRow.activa) throw new Error('Esa categoría está pausada')
      if (catRow.stock_disponible < input.cantidad) {
        throw new Error(`Stock insuficiente. Disponible: ${catRow.stock_disponible}, pediste: ${input.cantidad}`)
      }

      const precioUnitario =
        input.precioCobrado !== undefined && input.precioCobrado !== null
          ? Number(input.precioCobrado)
          : Number(catRow.precio)
      if (!Number.isFinite(precioUnitario) || precioUnitario < 0) {
        throw new Error('precio_cobrado inválido')
      }

      // Decrementar stock atómicamente
      await tx.$executeRaw`
        UPDATE entrada_categorias
        SET stock_disponible = stock_disponible - ${input.cantidad}
        WHERE id = ${input.categoriaId}
      `

      // Crear o reusar comprador. Strategy: si vino email, dedupe por email+empresa.
      // Si no, crear comprador nuevo con datos parciales (nombre obligatorio del cajero).
      const compradorNombre = input.compradorNombre?.trim() || 'Cliente presencial'
      const compradorEmail = input.compradorEmail?.trim()?.toLowerCase() || null

      let compradorId: string | null = null
      if (compradorEmail) {
        const existing = await tx.comprador.findFirst({
          where: { email: compradorEmail, empresa_id: input.empresaId },
          select: { id: true },
        })
        if (existing) compradorId = existing.id
      }

      if (!compradorId) {
        compradorId = uuidv4()
        await tx.comprador.create({
          data: {
            id: compradorId,
            empresa_id: input.empresaId,
            nombre: compradorNombre.slice(0, 191),
            apellido: input.compradorApellido?.trim()?.slice(0, 100) ?? null,
            email: compradorEmail ?? `pos-${compradorId.slice(0, 8)}@no-email.local`,
            dni: input.compradorDni?.trim()?.slice(0, 20) ?? null,
            telefono: input.compradorTelefono?.trim()?.slice(0, 30) ?? null,
            activo: true,
          },
        })
      }

      // Generar N entradas con QR único + clave_corta única (retry P2002)
      const entradasCreadas: EntradaCreada[] = []
      for (let i = 0; i < input.cantidad; i++) {
        const entradaId = uuidv4()
        const qrCode = uuidv4()
        let claveCortaFinal = ''
        let creada = false

        for (let intento = 0; intento < 10; intento++) {
          const candidata = generateSecureShortCode()
          try {
            await tx.entrada.create({
              data: {
                id: entradaId,
                evento_id: input.eventoId,
                categoria_id: input.categoriaId,
                fecha_id: input.fechaId ?? null,
                comprador_id: compradorId,
                qr_code: qrCode,
                clave_corta: candidata,
                estado: 'valida',
                precio_pagado: new Prisma.Decimal(precioUnitario.toFixed(2)),
                comision: new Prisma.Decimal(0), // Venta presencial: sin comisión platform
                comision_revendedor: new Prisma.Decimal(0),
                nombre_comprador: input.compradorNombre?.trim()?.slice(0, 191) ?? null,
                apellido_comprador: input.compradorApellido?.trim()?.slice(0, 191) ?? null,
                dni_comprador: input.compradorDni?.trim()?.slice(0, 64) ?? null,
                checkout_session_id: null, // marca distintiva: venta POS, no online
                revendedor_id: null,
                medio_pago_presencial: input.medioPago,
                vendido_by_user_id: input.vendidoByUserId,
              },
            })
            claveCortaFinal = candidata
            creada = true
            break
          } catch (err) {
            if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') continue
            throw err
          }
        }

        if (!creada) {
          throw new Error('No se pudo generar clave_corta única después de 10 intentos')
        }
        entradasCreadas.push({
          id: entradaId,
          qr_code: qrCode,
          clave_corta: claveCortaFinal,
          precio_pagado: precioUnitario,
        })
      }

      return {
        empresa_id: input.empresaId,
        evento_id: input.eventoId,
        evento_nombre: evento.nombre,
        categoria_id: input.categoriaId,
        categoria_nombre: catRow.nombre,
        cantidad: input.cantidad,
        precio_unitario: precioUnitario,
        precio_total: Math.round(precioUnitario * input.cantidad * 100) / 100,
        medio_pago: input.medioPago,
        entradas: entradasCreadas,
        comprador_id: compradorId,
      }
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 },
  )
}

// Lista eventos activos de la empresa con sus categorías + stock — input para el selector POS.
export async function listEventosDisponiblesParaPOS(empresaId: string) {
  const empresa = await prisma.empresa.findFirst({
    where: { id: empresaId },
    select: { pos_movil_habilitado: true },
  })
  if (!empresa || !empresa.pos_movil_habilitado) return { habilitado: false, eventos: [] as PosEventoDisponible[] }

  const eventos = await prisma.evento.findMany({
    where: { empresa_id: empresaId, activo: true },
    select: { id: true, nombre: true, modo_fecha: true, imagen_url: true },
    orderBy: { created_at: 'desc' },
    take: 50,
  })
  if (eventos.length === 0) return { habilitado: true, eventos: [] }

  const eventoIds = eventos.map((e) => e.id)
  const categorias = await prisma.entradaCategoria.findMany({
    where: { evento_id: { in: eventoIds }, activa: true },
    select: { id: true, evento_id: true, nombre: true, precio: true, stock_disponible: true, imagen_url: true },
  })

  const fechas = await prisma.eventoFecha.findMany({
    where: { evento_id: { in: eventoIds } },
    select: { id: true, evento_id: true, fecha: true },
    orderBy: { fecha: 'asc' },
  })

  const catsByEvento = new Map<string, typeof categorias>()
  for (const c of categorias) {
    const list = catsByEvento.get(c.evento_id) ?? []
    list.push(c)
    catsByEvento.set(c.evento_id, list)
  }
  const fechasByEvento = new Map<string, typeof fechas>()
  for (const f of fechas) {
    const list = fechasByEvento.get(f.evento_id) ?? []
    list.push(f)
    fechasByEvento.set(f.evento_id, list)
  }

  return {
    habilitado: true,
    eventos: eventos.map<PosEventoDisponible>((e) => ({
      id: e.id,
      nombre: e.nombre,
      modo_fecha: e.modo_fecha,
      imagen_url: e.imagen_url ?? null,
      categorias: (catsByEvento.get(e.id) ?? []).map((c) => ({
        id: c.id,
        nombre: c.nombre,
        precio: Number(c.precio),
        stock_disponible: c.stock_disponible,
        imagen_url: c.imagen_url ?? null,
      })),
      fechas: (fechasByEvento.get(e.id) ?? [])
        .filter((f) => f.fecha !== null)
        .map((f) => ({
          id: f.id,
          fecha: (f.fecha as Date).toISOString(),
        })),
    })),
  }
}

export type PosEventoDisponible = {
  id: string
  nombre: string
  modo_fecha: string
  imagen_url: string | null
  categorias: Array<{ id: string; nombre: string; precio: number; stock_disponible: number; imagen_url: string | null }>
  fechas: Array<{ id: string; fecha: string }>
}
