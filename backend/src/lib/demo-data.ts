// Demo data generators — buttons in dashboards for empresas marcadas es_prueba=true.
//
// SECURITY: cada función SIEMPRE valida que la empresa tenga es_prueba=true. Si no,
// throw. Esto es una salvaguarda en caso de que la UI se equivoque y exponga el botón
// a una empresa real — el backend la rechaza igual.
//
// Filosofía:
// - REUSAMOS funciones canónicas existentes (crearVentaPresencial, createRefundManualCase)
//   en lugar de replicar SQL. Single source of truth.
// - NO TOCAMOS API real de Mercado Pago. El refund queda en estado 'requested' sin ejecutar
//   (no llama executeRefundManualCase). La reconciliación es un row sintético con
//   payment_id fake — MP nunca se entera.
// - Datos sintéticos coherentes: nombres argentinos comunes, DNIs random válidos en formato,
//   emails @demo.test para que sean fácil de identificar y excluir si hace falta.

import { randomUUID as uuidv4 } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma, prismaDirectUrl } from './prisma'
import { generateSecureShortCode } from './secure-code'

const NOMBRES_FAKE = ['Juan', 'María', 'Pedro', 'Lucía', 'Diego', 'Sofía', 'Martín', 'Valentina', 'Carlos', 'Camila', 'Tomás', 'Florencia', 'Nicolás', 'Julieta', 'Mateo', 'Agustina']
const APELLIDOS_FAKE = ['Pérez', 'González', 'Rodríguez', 'Fernández', 'López', 'Martínez', 'García', 'Sánchez', 'Romero', 'Torres', 'Ramírez', 'Flores', 'Acosta', 'Benítez']

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function randomDni(): string {
  // 8 dígitos, evitar empezar en 0
  return String(Math.floor(10_000_000 + Math.random() * 89_999_999))
}

function randomFakeBuyer() {
  const nombre = pick(NOMBRES_FAKE)
  const apellido = pick(APELLIDOS_FAKE)
  const dni = randomDni()
  const email = `${nombre.toLowerCase()}.${apellido.toLowerCase().replace(/[^a-z]/g, '')}.${dni.slice(0, 4)}@demo.test`
  return { nombre, apellido, dni, email, telefono: null as string | null }
}

async function assertEmpresaEsPrueba(empresaId: string) {
  const empresa = await prisma.empresa.findUnique({
    where: { id: empresaId },
    select: { id: true, es_prueba: true, activa: true },
  })
  if (!empresa) throw new Error('Empresa no encontrada')
  if (!empresa.activa) throw new Error('La empresa está inactiva')
  if (!empresa.es_prueba) {
    throw new Error('Esta funcionalidad solo está disponible para empresas marcadas como cuenta de prueba (es_prueba=true)')
  }
  return empresa
}

async function pickRandomEventoConStock(empresaId: string) {
  // Buscar un evento activo de la empresa con al menos una categoría con stock disponible
  const eventos = await prisma.evento.findMany({
    where: { empresa_id: empresaId, activo: true },
    select: { id: true, nombre: true, modo_fecha: true },
    take: 50,
  })
  if (eventos.length === 0) {
    throw new Error('No hay eventos activos en esta empresa. Creá un evento con al menos una categoría antes de generar datos demo.')
  }

  // Para cada evento, traer categorías activas con stock
  for (const ev of eventos.sort(() => Math.random() - 0.5)) {
    const cats = await prisma.entradaCategoria.findMany({
      where: { evento_id: ev.id, activa: true, stock_disponible: { gt: 0 } },
      select: { id: true, nombre: true, precio: true, stock_disponible: true },
    })
    if (cats.length > 0) {
      return { evento: ev, categoria: pick(cats) }
    }
  }
  throw new Error('Ningún evento activo tiene categorías con stock disponible. Cargá stock en alguna categoría.')
}

// ============================================================
// 1) COMPRA DEMO — venta de entradas online sintética
// ============================================================
//
// Genera una compra completa: comprador fake + checkout_session 'confirmada' (payment_id
// dummy con prefijo DEMO-) + N entradas con QR único + commission breakdown.
// NO llama a Mercado Pago. NO crea allocations de platform-profit-sharing (las allocations
// son cosa de empresas reales con marketplace fee — en demos no nos importan).

export type DemoCompraResult = {
  comprador: { id: string; nombre: string; apellido: string; email: string }
  evento: { id: string; nombre: string }
  categoria: { id: string; nombre: string; precio: number }
  cantidad: number
  total: number
  checkout_session_id: string
  entradas: Array<{ id: string; qr_code: string; clave_corta: string }>
}

export async function demoCreateCompra(input: { empresaId: string }): Promise<DemoCompraResult> {
  await assertEmpresaEsPrueba(input.empresaId)
  const { evento, categoria } = await pickRandomEventoConStock(input.empresaId)
  const cantidad = 1 + Math.floor(Math.random() * Math.min(3, categoria.stock_disponible))
  const buyer = randomFakeBuyer()
  const precio = Number(categoria.precio)
  const sessionId = `DEMO-${uuidv4().slice(0, 12)}`
  const paymentId = `DEMO-PAY-${Date.now().toString(36)}`
  const now = new Date()

  return await prismaDirectUrl.$transaction(
    async (tx) => {
      // FOR UPDATE on categoria — same lock as real flow
      const catLock = await tx.$queryRaw<Array<{ id: string; stock_disponible: number; precio: string | number }>>`
        SELECT id, stock_disponible, precio
        FROM entrada_categorias
        WHERE id = ${categoria.id}
        FOR UPDATE
      `
      if (!catLock[0] || catLock[0].stock_disponible < cantidad) {
        throw new Error('Stock cambió entre selección y commit, probá de nuevo')
      }

      await tx.$executeRaw`
        UPDATE entrada_categorias
        SET stock_disponible = stock_disponible - ${cantidad}
        WHERE id = ${categoria.id}
      `

      // Crear comprador
      const compradorId = uuidv4()
      await tx.comprador.create({
        data: {
          id: compradorId,
          empresa_id: input.empresaId,
          nombre: buyer.nombre,
          apellido: buyer.apellido,
          email: buyer.email,
          dni: buyer.dni,
          activo: true,
        },
      })

      // Crear checkout_session 'confirmada' con datos sintéticos
      const datosJson = JSON.stringify({
        items: [
          {
            categoriaId: categoria.id,
            eventoId: evento.id,
            categoriaNombre: categoria.nombre,
            eventoNombre: evento.nombre,
            precio,
            cantidad,
          },
        ],
        demo: true,
      })
      await tx.checkoutSession.create({
        data: {
          id: sessionId,
          comprador_id: compradorId,
          empresa_id: input.empresaId,
          datos: datosJson,
          estado: 'confirmada',
          expires_at: new Date(now.getTime() + 15 * 60 * 1000),
          confirmed_at: now,
          payment_id: paymentId,
          payment_status: 'approved',
          reconciliation_status: 'none',
          delivery_status: 'completed',
          delivery_completed_at: now,
        },
      })

      // Crear N entradas
      const entradas: Array<{ id: string; qr_code: string; clave_corta: string }> = []
      for (let i = 0; i < cantidad; i++) {
        const entradaId = uuidv4()
        const qrCode = uuidv4()
        let claveCorta = ''
        for (let attempt = 0; attempt < 10; attempt++) {
          const candidate = generateSecureShortCode()
          try {
            await tx.entrada.create({
              data: {
                id: entradaId,
                evento_id: evento.id,
                categoria_id: categoria.id,
                comprador_id: compradorId,
                qr_code: qrCode,
                clave_corta: candidate,
                estado: 'valida',
                precio_pagado: new Prisma.Decimal(precio.toFixed(2)),
                comision: new Prisma.Decimal(0),
                comision_revendedor: new Prisma.Decimal(0),
                nombre_comprador: buyer.nombre,
                apellido_comprador: buyer.apellido,
                dni_comprador: buyer.dni,
                checkout_session_id: sessionId,
              },
            })
            claveCorta = candidate
            break
          } catch (err) {
            if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') continue
            throw err
          }
        }
        if (!claveCorta) throw new Error('No se pudo generar clave_corta única')
        entradas.push({ id: entradaId, qr_code: qrCode, clave_corta: claveCorta })
      }

      return {
        comprador: { id: compradorId, nombre: buyer.nombre, apellido: buyer.apellido, email: buyer.email },
        evento: { id: evento.id, nombre: evento.nombre },
        categoria: { id: categoria.id, nombre: categoria.nombre, precio },
        cantidad,
        total: precio * cantidad,
        checkout_session_id: sessionId,
        entradas,
      }
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 },
  )
}

// ============================================================
// 2) VENTA DE CONSUMIBLES DEMO
// ============================================================

export type DemoConsumibleResult = {
  venta_id: string
  clave_corta: string
  qr_code: string
  barra: { id: string; nombre: string }
  evento: { id: string; nombre: string }
  items: Array<{ consumible_id: string; nombre: string; cantidad: number; subtotal: number }>
  total: number
}

export async function demoCreateConsumibleVenta(input: { empresaId: string }): Promise<DemoConsumibleResult> {
  await assertEmpresaEsPrueba(input.empresaId)

  // Buscar barra activa con stock
  const barras = await prisma.barra.findMany({
    where: { empresa_id: input.empresaId, activa: true },
    select: { id: true, nombre: true, evento_id: true },
    take: 10,
  })
  if (barras.length === 0) {
    throw new Error('No hay barras activas. Creá una barra con consumibles cargados antes.')
  }

  for (const barra of barras.sort(() => Math.random() - 0.5)) {
    const stockRows = await prisma.barraStock.findMany({
      where: { barra_id: barra.id, stock_actual: { gt: 0 } },
      select: { id: true, consumible_id: true, stock_actual: true },
      take: 20,
    })
    if (stockRows.length === 0) continue

    // Schema doesn't define a Prisma relation between BarraStock and Consumible — fetch separately
    const consumibles = await prisma.consumible.findMany({
      where: { id: { in: stockRows.map((s) => s.consumible_id) }, activo: true },
      select: { id: true, nombre: true, precio: true },
    })
    const consumibleById = new Map(consumibles.map((c) => [c.id, c]))
    const conStock = stockRows
      .map((s) => ({ stock: s, consumible: consumibleById.get(s.consumible_id) }))
      .filter((x): x is { stock: typeof stockRows[number]; consumible: typeof consumibles[number] } => !!x.consumible)
    if (conStock.length === 0) continue

    // Elegir 1-3 items distintos
    const itemsAVender = conStock
      .sort(() => Math.random() - 0.5)
      .slice(0, 1 + Math.floor(Math.random() * Math.min(3, conStock.length)))
      .map((s) => ({
        stock: s.stock,
        consumible: s.consumible,
        cantidad: 1 + Math.floor(Math.random() * Math.min(2, s.stock.stock_actual)),
      }))

    const evento = await prisma.evento.findUnique({ where: { id: barra.evento_id }, select: { id: true, nombre: true } })
    if (!evento) continue

    const ventaId = uuidv4()
    const qrCode = uuidv4()
    const now = new Date()

    return await prismaDirectUrl.$transaction(
      async (tx) => {
        // Lock barra_stock rows con FOR UPDATE
        const stockIds = itemsAVender.map((it) => it.stock.id)
        const locked = await tx.$queryRaw<Array<{ id: string; stock_actual: number }>>`
          SELECT id, stock_actual FROM barra_stock WHERE id = ANY(${stockIds}::varchar[]) FOR UPDATE
        `
        const lockedMap = new Map(locked.map((l) => [l.id, l.stock_actual]))

        // Validar stock + decrementar
        const itemsResult: Array<{ consumible_id: string; nombre: string; cantidad: number; subtotal: number }> = []
        let total = 0
        for (const it of itemsAVender) {
          const stockActual = lockedMap.get(it.stock.id) ?? 0
          if (stockActual < it.cantidad) {
            throw new Error(`Stock insuficiente para ${it.consumible.nombre}`)
          }
          await tx.$executeRaw`
            UPDATE barra_stock SET stock_actual = stock_actual - ${it.cantidad} WHERE id = ${it.stock.id}
          `
          const precio = Number(it.consumible.precio)
          const subtotal = precio * it.cantidad
          total += subtotal
          itemsResult.push({
            consumible_id: it.consumible.id,
            nombre: it.consumible.nombre,
            cantidad: it.cantidad,
            subtotal,
          })
        }

        // Crear venta con retry en clave_corta
        let claveCortaFinal = ''
        for (let attempt = 0; attempt < 10; attempt++) {
          const candidate = generateSecureShortCode()
          try {
            await tx.consumiblesVenta.create({
              data: {
                id: ventaId,
                barra_id: barra.id,
                evento_id: evento.id,
                empresa_id: input.empresaId,
                qr_code: qrCode,
                clave_corta: candidate,
                total: new Prisma.Decimal(total.toFixed(2)),
                descuento: new Prisma.Decimal(0),
                estado: 'pendiente',
              },
            })
            claveCortaFinal = candidate
            break
          } catch (err) {
            if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') continue
            throw err
          }
        }
        if (!claveCortaFinal) throw new Error('No se pudo generar clave_corta única')

        // Items
        await tx.consumiblesVentaItem.createMany({
          data: itemsAVender.map((it) => ({
            id: uuidv4(),
            venta_id: ventaId,
            consumible_id: it.consumible.id,
            nombre_snapshot: it.consumible.nombre,
            precio_unitario: new Prisma.Decimal(Number(it.consumible.precio).toFixed(2)),
            cantidad: it.cantidad,
            subtotal: new Prisma.Decimal((Number(it.consumible.precio) * it.cantidad).toFixed(2)),
          })),
        })

        void now
        return {
          venta_id: ventaId,
          clave_corta: claveCortaFinal,
          qr_code: qrCode,
          barra: { id: barra.id, nombre: barra.nombre },
          evento: { id: evento.id, nombre: evento.nombre },
          items: itemsResult,
          total,
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 },
    )
  }

  throw new Error('Ninguna barra tiene consumibles con stock. Cargá stock en alguna barra.')
}

// ============================================================
// 3) REEMBOLSO DEMO — pedido de refund SIN ejecutar contra MP
// ============================================================
//
// Toma una venta demo previa (checkout_session 'confirmada' con payment_id que empiece
// con 'DEMO-') y crea un caso de refund en estado 'requested'. NO ejecuta — no llama a MP.

export type DemoRefundResult = {
  refund_case_id: string
  checkout_session_id: string
  flow: 'entradas' | 'consumibles'
  amount: number
  status: string
}

export async function demoCreateRefundCase(input: { empresaId: string; actorUserId: string }): Promise<DemoRefundResult> {
  await assertEmpresaEsPrueba(input.empresaId)

  // Buscar un checkout_session confirmado de la empresa con payment_id DEMO-* y sin refund previo
  const session = await prisma.checkoutSession.findFirst({
    where: {
      empresa_id: input.empresaId,
      estado: 'confirmada',
      payment_id: { startsWith: 'DEMO-' },
      refund_status: null,
    },
    orderBy: { confirmed_at: 'desc' },
    select: { id: true, datos: true, payment_id: true, payment_status: true },
  })
  if (!session) {
    throw new Error('No hay compras demo previas para reembolsar. Generá primero una "Compra demo".')
  }

  // Parsear total del JSON de datos
  let total = 0
  try {
    const parsed = JSON.parse(session.datos) as { items?: Array<{ precio: number; cantidad: number }> }
    if (Array.isArray(parsed.items)) {
      total = parsed.items.reduce((acc, it) => acc + Number(it.precio ?? 0) * Number(it.cantidad ?? 0), 0)
    }
  } catch {
    total = 0
  }

  const caseId = uuidv4()
  const now = new Date()

  await prisma.$executeRaw`
    INSERT INTO refund_manual_cases (
      id, empresa_id, checkout_session_id, flow, status,
      payment_id, payment_status, reconciliation_status,
      requested_amount, currency,
      request_reason, request_origin,
      requester_actor_id, requester_actor_type,
      created_by, created_at, updated_at
    ) VALUES (
      ${caseId}, ${input.empresaId}, ${session.id}, 'entradas', 'requested',
      ${session.payment_id}, ${session.payment_status ?? 'approved'}, 'none',
      ${total}, 'ARS',
      'Caso demo generado para presentación', 'company_manual',
      ${input.actorUserId}, 'empresa',
      ${input.actorUserId}, ${now}, ${now}
    )
  `

  return {
    refund_case_id: caseId,
    checkout_session_id: session.id,
    flow: 'entradas',
    amount: total,
    status: 'requested',
  }
}

// ============================================================
// 4) RECONCILIACIÓN DEMO — checkout con payment_id sin confirmar
// ============================================================
//
// Crea una checkout_session que simula el caso "MP aprobó pero nuestro DB lo perdió":
// estado='reservada', expires_at en el pasado, payment_id DEMO-* con status 'approved',
// reconciliation_note='approved_after_expiry'. NO crea entradas (justamente, el caso es
// que NO se emitieron). Aparece en /dashboard/reconciliacion.

export type DemoReconciliacionResult = {
  checkout_session_id: string
  reconciliation_note: string
  payment_id: string
  amount: number
  comprador_email: string
}

export async function demoCreateReconciliacionCase(input: { empresaId: string }): Promise<DemoReconciliacionResult> {
  await assertEmpresaEsPrueba(input.empresaId)
  const { evento, categoria } = await pickRandomEventoConStock(input.empresaId)
  const buyer = randomFakeBuyer()
  const cantidad = 1 + Math.floor(Math.random() * 2)
  const precio = Number(categoria.precio)
  const total = precio * cantidad

  // Crear comprador fake
  const compradorId = uuidv4()
  await prisma.comprador.create({
    data: {
      id: compradorId,
      empresa_id: input.empresaId,
      nombre: buyer.nombre,
      apellido: buyer.apellido,
      email: buyer.email,
      dni: buyer.dni,
      activo: true,
    },
  })

  const sessionId = `DEMO-RECONC-${uuidv4().slice(0, 12)}`
  const paymentId = `DEMO-PAY-RECONC-${Date.now().toString(36)}`
  const expiresAt = new Date(Date.now() - 30 * 60 * 1000) // expirado hace 30 min

  const datosJson = JSON.stringify({
    items: [
      {
        categoriaId: categoria.id,
        eventoId: evento.id,
        categoriaNombre: categoria.nombre,
        eventoNombre: evento.nombre,
        precio,
        cantidad,
      },
    ],
    demo: true,
  })

  await prisma.checkoutSession.create({
    data: {
      id: sessionId,
      comprador_id: compradorId,
      empresa_id: input.empresaId,
      datos: datosJson,
      estado: 'reservada', // nunca pasó a 'confirmada'
      expires_at: expiresAt,
      payment_id: paymentId,
      payment_status: 'approved',
      reconciliation_status: 'needs_review',
      reconciliation_note: 'approved_after_expiry',
    },
  })

  return {
    checkout_session_id: sessionId,
    reconciliation_note: 'approved_after_expiry',
    payment_id: paymentId,
    amount: total,
    comprador_email: buyer.email,
  }
}
