import { randomUUID as uuidv4 } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma, prismaDirectUrl } from './prisma'
import { generateSecureShortCode } from './secure-code'

export type LoteEstado = 'generado' | 'enviado_imprenta' | 'recibido' | 'completado' | 'anulado'
export type TicketEstado = 'disponible' | 'vendido' | 'usada' | 'anulada'

export type CreateLoteInput = {
  empresaId: string
  eventoId: string
  categoriaId: string
  fechaId?: string | null
  cantidad: number
  precioImpreso?: number | null
  formato?: 'horizontal_4xa4' | 'vertical_4xa4' | 'tarjeta_8xa4' | 'pulsera_12xa4'
  notas?: string | null
  createdByUserId: string
  seguridadGuilloche?: boolean
  seguridadMicrotexto?: boolean
  seguridadHologramaArea?: boolean
}

export type LoteRow = {
  id: string
  empresaId: string
  eventoId: string
  categoriaId: string
  fechaId: string | null
  cantidadTotal: number
  precioImpreso: number | null
  formato: string
  estado: string
  notas: string | null
  fechaEnvioImprenta: string | null
  fechaRecepcion: string | null
  createdByUserId: string | null
  createdAt: string
  updatedAt: string
  // computed counts
  countDisponible?: number
  countVendido?: number
  countUsada?: number
  countAnulada?: number
}

const MAX_LOTE_SIZE = 10000

/**
 * Generate a new lote with N pre-printed tickets. All tickets share the same
 * lote_id and are sequentially numbered. Each ticket gets a unique UUID qr_code
 * and a unique base32 clave_corta with retry on collision.
 *
 * Performance: 1000 tickets create in ~1-3s. Larger lotes risk transaction
 * timeout, so we cap at 10000.
 */
export async function createLote(input: CreateLoteInput) {
  if (!Number.isInteger(input.cantidad) || input.cantidad < 1 || input.cantidad > MAX_LOTE_SIZE) {
    throw new Error(`cantidad debe ser un entero entre 1 y ${MAX_LOTE_SIZE}`)
  }

  // Verify evento + categoria belong to empresa (avoid cross-tenant lotes).
  // Schema doesn't define a Prisma relation between EntradaCategoria and Evento,
  // so we fetch both rows separately and cross-check the empresa_id.
  const [categoria, evento] = await Promise.all([
    prisma.entradaCategoria.findFirst({
      where: { id: input.categoriaId, evento_id: input.eventoId },
      select: { id: true, precio: true },
    }),
    prisma.evento.findUnique({
      where: { id: input.eventoId },
      select: { id: true, empresa_id: true, nombre: true },
    }),
  ])
  if (!categoria) throw new Error('La categoría no existe en este evento')
  if (!evento || evento.empresa_id !== input.empresaId) {
    throw new Error('El evento no pertenece a esta empresa')
  }

  const precioImpreso =
    input.precioImpreso !== undefined && input.precioImpreso !== null
      ? Number(input.precioImpreso)
      : Number(categoria.precio ?? 0)

  const loteId = uuidv4()
  const now = new Date()

  return await prismaDirectUrl.$transaction(
    async (tx) => {
      await tx.ticketFisicoLote.create({
        data: {
          id: loteId,
          empresa_id: input.empresaId,
          evento_id: input.eventoId,
          categoria_id: input.categoriaId,
          fecha_id: input.fechaId ?? null,
          cantidad_total: input.cantidad,
          precio_impreso: new Prisma.Decimal(precioImpreso.toFixed(2)),
          formato: input.formato ?? 'horizontal_4xa4',
          estado: 'generado',
          notas: input.notas ?? null,
          seguridad_guilloche: input.seguridadGuilloche === true,
          seguridad_microtexto: input.seguridadMicrotexto === true,
          seguridad_holograma_area: input.seguridadHologramaArea === true,
          created_by_user_id: input.createdByUserId,
          created_at: now,
          updated_at: now,
        },
      })

      // Generate tickets in chunks of 500 to keep memory + transaction reasonable.
      // Each ticket has its own UUID qr_code; clave_corta has retry on P2002.
      const chunkSize = 500
      for (let start = 0; start < input.cantidad; start += chunkSize) {
        const end = Math.min(start + chunkSize, input.cantidad)
        const rows: Prisma.TicketFisicoCreateManyInput[] = []
        for (let i = start; i < end; i += 1) {
          rows.push({
            id: uuidv4(),
            lote_id: loteId,
            empresa_id: input.empresaId,
            evento_id: input.eventoId,
            categoria_id: input.categoriaId,
            fecha_id: input.fechaId ?? null,
            numero_secuencia: i + 1,
            qr_code: uuidv4(),
            clave_corta: generateSecureShortCode(),
            estado: 'disponible',
            created_at: now,
            updated_at: now,
          })
        }

        try {
          await tx.ticketFisico.createMany({ data: rows })
        } catch (err) {
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
            // clave_corta collision — regenerate one by one for this chunk
            for (const row of rows) {
              await insertWithClaveCortaRetry(tx, row)
            }
          } else {
            throw err
          }
        }
      }

      return loteId
    },
    { timeout: 60_000 },
  )
}

async function insertWithClaveCortaRetry(
  tx: Prisma.TransactionClient,
  row: Prisma.TicketFisicoCreateManyInput,
  maxRetries = 5,
) {
  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    try {
      await tx.ticketFisico.create({ data: row })
      return
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        row.clave_corta = generateSecureShortCode()
        continue
      }
      throw err
    }
  }
  throw new Error(`No se pudo generar una clave_corta única después de ${maxRetries} intentos`)
}

export type LoteListItem = {
  id: string
  evento_id: string
  evento_nombre: string
  categoria_id: string
  categoria_nombre: string
  cantidad_total: number
  cantidad_disponible: number
  cantidad_vendido: number
  cantidad_usada: number
  cantidad_anulada: number
  precio_impreso: number | null
  formato: string
  estado: string
  notas: string | null
  fecha_envio_imprenta: string | null
  fecha_recepcion: string | null
  created_at: string
  updated_at: string
}

export async function listLotesByEmpresa(empresaId: string, eventoId?: string | null) {
  const lotes = await prisma.ticketFisicoLote.findMany({
    where: {
      empresa_id: empresaId,
      ...(eventoId ? { evento_id: eventoId } : {}),
    },
    orderBy: { created_at: 'desc' },
  })
  if (lotes.length === 0) return [] as LoteListItem[]

  const loteIds = lotes.map((l) => l.id)
  const eventoIds = Array.from(new Set(lotes.map((l) => l.evento_id)))
  const categoriaIds = Array.from(new Set(lotes.map((l) => l.categoria_id)))

  const [eventos, categorias, counts] = await Promise.all([
    prisma.evento.findMany({ where: { id: { in: eventoIds } }, select: { id: true, nombre: true } }),
    prisma.entradaCategoria.findMany({ where: { id: { in: categoriaIds } }, select: { id: true, nombre: true } }),
    prisma.$queryRaw<Array<{ lote_id: string; estado: string; total: bigint }>>`
      SELECT lote_id, estado, COUNT(*)::bigint AS total
      FROM ticket_fisicos
      WHERE lote_id = ANY(${loteIds})
      GROUP BY lote_id, estado
    `,
  ])

  const eventoNombreById = new Map(eventos.map((e) => [e.id, e.nombre]))
  const categoriaNombreById = new Map(categorias.map((c) => [c.id, c.nombre]))
  const countsByLote = new Map<string, { disponible: number; vendido: number; usada: number; anulada: number }>()
  for (const row of counts) {
    const bucket = countsByLote.get(row.lote_id) ?? { disponible: 0, vendido: 0, usada: 0, anulada: 0 }
    if (row.estado === 'disponible') bucket.disponible = Number(row.total)
    else if (row.estado === 'vendido') bucket.vendido = Number(row.total)
    else if (row.estado === 'usada') bucket.usada = Number(row.total)
    else if (row.estado === 'anulada') bucket.anulada = Number(row.total)
    countsByLote.set(row.lote_id, bucket)
  }

  return lotes.map<LoteListItem>((l) => {
    const c = countsByLote.get(l.id) ?? { disponible: 0, vendido: 0, usada: 0, anulada: 0 }
    return {
      id: l.id,
      evento_id: l.evento_id,
      evento_nombre: eventoNombreById.get(l.evento_id) ?? 'Evento',
      categoria_id: l.categoria_id,
      categoria_nombre: categoriaNombreById.get(l.categoria_id) ?? 'Categoría',
      cantidad_total: l.cantidad_total,
      cantidad_disponible: c.disponible,
      cantidad_vendido: c.vendido,
      cantidad_usada: c.usada,
      cantidad_anulada: c.anulada,
      precio_impreso: l.precio_impreso !== null ? Number(l.precio_impreso) : null,
      formato: l.formato,
      estado: l.estado,
      notas: l.notas,
      fecha_envio_imprenta: l.fecha_envio_imprenta?.toISOString() ?? null,
      fecha_recepcion: l.fecha_recepcion?.toISOString() ?? null,
      created_at: l.created_at.toISOString(),
      updated_at: l.updated_at.toISOString(),
    }
  })
}

export async function getLoteWithContext(loteId: string, empresaId: string) {
  const lote = await prisma.ticketFisicoLote.findFirst({
    where: { id: loteId, empresa_id: empresaId },
  })
  if (!lote) return null

  const [evento, categoria, fecha] = await Promise.all([
    prisma.evento.findUnique({
      where: { id: lote.evento_id },
      select: { id: true, nombre: true, empresa_id: true, lugar: true },
    }),
    prisma.entradaCategoria.findUnique({
      where: { id: lote.categoria_id },
      select: { id: true, nombre: true, precio: true },
    }),
    lote.fecha_id
      ? prisma.eventoFecha.findUnique({ where: { id: lote.fecha_id }, select: { id: true, fecha: true } })
      : Promise.resolve(null),
  ])

  const empresa = evento
    ? await prisma.empresa.findUnique({
        where: { id: evento.empresa_id },
        select: { id: true, nombre: true, slug: true, logo_url: true },
      })
    : null

  return { lote, evento, categoria, fecha, empresa }
}

export async function getTicketsByLote(loteId: string, empresaId: string) {
  const lote = await prisma.ticketFisicoLote.findFirst({
    where: { id: loteId, empresa_id: empresaId },
    select: { id: true },
  })
  if (!lote) return null

  return await prisma.ticketFisico.findMany({
    where: { lote_id: loteId },
    orderBy: { numero_secuencia: 'asc' },
  })
}

export async function updateLoteEstado(loteId: string, empresaId: string, estado: LoteEstado) {
  const lote = await prisma.ticketFisicoLote.findFirst({ where: { id: loteId, empresa_id: empresaId } })
  if (!lote) return null

  const patch: Prisma.TicketFisicoLoteUpdateInput = { estado }
  const now = new Date()
  if (estado === 'enviado_imprenta' && !lote.fecha_envio_imprenta) patch.fecha_envio_imprenta = now
  if (estado === 'recibido' && !lote.fecha_recepcion) patch.fecha_recepcion = now

  return await prisma.ticketFisicoLote.update({ where: { id: loteId }, data: patch })
}

// ============================================================
// Fase 2: asignación a revendedores + venta desde panel revendedor
// ============================================================

export async function assignTicketsToRevendedor(params: {
  loteId: string
  empresaId: string
  revendedorId: string
  cantidad: number
  asignadoByUserId: string
}) {
  if (!Number.isInteger(params.cantidad) || params.cantidad < 1) {
    throw new Error('cantidad debe ser un entero positivo')
  }

  // Verify revendedor belongs to empresa and is active
  const revendedor = await prisma.usuario.findFirst({
    where: { id: params.revendedorId, empresa_id: params.empresaId, activo: true, rol: 'revendedor' },
    select: { id: true, nombre: true, apellido: true },
  })
  if (!revendedor) throw new Error('Revendedor no encontrado o inactivo')

  // Verify lote belongs to empresa
  const lote = await prisma.ticketFisicoLote.findFirst({
    where: { id: params.loteId, empresa_id: params.empresaId },
    select: { id: true },
  })
  if (!lote) throw new Error('Lote no encontrado')

  // Pick the first N tickets that are 'disponible' and NOT yet assigned.
  // Update atomically with a single SQL statement to avoid races between
  // concurrent assignments on the same lote.
  const result = await prismaDirectUrl.$queryRaw<Array<{ id: string }>>`
    UPDATE ticket_fisicos
    SET asignado_a_revendedor_id = ${params.revendedorId},
        asignado_at = NOW(),
        asignado_by_user_id = ${params.asignadoByUserId},
        updated_at = NOW()
    WHERE id IN (
      SELECT id FROM ticket_fisicos
      WHERE lote_id = ${params.loteId}
        AND empresa_id = ${params.empresaId}
        AND estado = 'disponible'
        AND asignado_a_revendedor_id IS NULL
      ORDER BY numero_secuencia ASC
      LIMIT ${params.cantidad}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id
  `

  const asignados = result.length
  if (asignados === 0) {
    throw new Error('No quedan tickets disponibles sin asignar en este lote')
  }

  return { asignados, requested: params.cantidad }
}

export async function unassignTicket(ticketId: string, empresaId: string) {
  const ticket = await prisma.ticketFisico.findFirst({
    where: { id: ticketId, empresa_id: empresaId },
    select: { id: true, estado: true },
  })
  if (!ticket) return null
  if (ticket.estado !== 'disponible') {
    throw new Error('Solo se pueden desasignar tickets en estado disponible')
  }
  return await prisma.ticketFisico.update({
    where: { id: ticketId },
    data: { asignado_a_revendedor_id: null, asignado_at: null, asignado_by_user_id: null },
  })
}

export async function listTicketsAsignadosARevendedor(revendedorId: string, empresaId: string, eventoId?: string | null) {
  return await prisma.ticketFisico.findMany({
    where: {
      asignado_a_revendedor_id: revendedorId,
      empresa_id: empresaId,
      ...(eventoId ? { evento_id: eventoId } : {}),
    },
    orderBy: [{ evento_id: 'asc' }, { numero_secuencia: 'asc' }],
  })
}

export async function venderTicketFisico(params: {
  ticketId: string
  revendedorId: string
  empresaId: string
  compradorNombre: string
  compradorDni?: string | null
  precioVendido?: number | null
}) {
  if (!params.compradorNombre.trim()) {
    throw new Error('comprador_nombre es obligatorio')
  }

  // Atomic UPDATE — only transitions 'disponible' → 'vendido' if assigned to this revendedor.
  // Race-safe: WHERE guards prevent concurrent sales of the same ticket.
  const updated = await prismaDirectUrl.$queryRaw<
    Array<{ id: string; lote_id: string; categoria_id: string; precio_default: string | null }>
  >`
    UPDATE ticket_fisicos tf
    SET estado = 'vendido',
        vendido_at = NOW(),
        vendido_by_user_id = ${params.revendedorId},
        vendido_by_revendedor_id = ${params.revendedorId},
        precio_vendido = ${params.precioVendido !== undefined && params.precioVendido !== null ? params.precioVendido : null}::decimal,
        comprador_nombre = ${params.compradorNombre.trim().slice(0, 191)},
        comprador_dni = ${params.compradorDni ? params.compradorDni.slice(0, 64) : null},
        updated_at = NOW()
    WHERE tf.id = ${params.ticketId}
      AND tf.empresa_id = ${params.empresaId}
      AND tf.asignado_a_revendedor_id = ${params.revendedorId}
      AND tf.estado = 'disponible'
    RETURNING tf.id, tf.lote_id, tf.categoria_id, (
      SELECT l.precio_impreso::text FROM ticket_fisico_lotes l WHERE l.id = tf.lote_id
    ) AS precio_default
  `

  if (updated.length === 0) {
    throw new Error('Ticket no disponible para vender (no asignado, ya vendido o no encontrado)')
  }

  // If no override price was supplied, persist precio_impreso of the lote as the sale price
  if ((params.precioVendido === null || params.precioVendido === undefined) && updated[0].precio_default) {
    await prisma.ticketFisico.update({
      where: { id: params.ticketId },
      data: { precio_vendido: new Prisma.Decimal(updated[0].precio_default) },
    })
  }

  return await prisma.ticketFisico.findUnique({ where: { id: params.ticketId } })
}

export async function anularTicket(ticketId: string, empresaId: string, motivo: string | null) {
  const ticket = await prisma.ticketFisico.findFirst({ where: { id: ticketId, empresa_id: empresaId } })
  if (!ticket) return null
  if (ticket.estado === 'usada') {
    throw new Error('No se puede anular un ticket ya canjeado')
  }
  return await prisma.ticketFisico.update({
    where: { id: ticketId },
    data: { estado: 'anulada', anulada_at: new Date(), anulada_motivo: motivo },
  })
}
