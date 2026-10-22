/**
 * seed-portfolio-extras.ts — datos simulados para el resto de las pantallas (equipo, revendedores,
 * ventas de barra, promociones, marketing, reembolsos, lista de espera). Corre DESPUÉS de seed-portfolio.ts.
 * Solo base local. Idempotente: limpia y vuelve a crear lo que genera.
 */
import { randomUUID } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { prisma } from '../src/lib/prisma'

if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) throw new Error('Solo contra una base local.')

const DAY = 24 * 3600 * 1000
const now = Date.now()
const rnd = (s: number) => { const x = Math.sin(s * 12.9898) * 43758.5453; return x - Math.floor(x) }
const clave = () => randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()

async function main() {
  const empresa = await prisma.empresa.findFirstOrThrow({ where: { email: 'demo@demo.ticketera.test' } })
  const empresaId = empresa.id
  // El dashboard del superadmin excluye es_prueba=true: para que la demo cuente en sus métricas se marca como real.
  await prisma.empresa.update({ where: { id: empresaId }, data: { es_prueba: false } })
  const eventos = await prisma.evento.findMany({ where: { empresa_id: empresaId }, orderBy: { created_at: 'asc' } })
  const hash = await bcrypt.hash('Demo1234!', 10)

  // ── Equipo y revendedores ────────────────────────────────────────────────
  await prisma.usuario.deleteMany({ where: { empresa_id: empresaId } })
  const equipo = [
    ['Martín', 'Giménez', 'martin.gimenez', 'operador', null],
    ['Paula', 'Ortega', 'paula.ortega', 'vendedor', null],
    ['Diego', 'Cabrera', 'diego.cabrera', 'puerta', null],
    ['Romina', 'Suárez', 'romina.suarez', 'privilegiado', null],
    ['Gonzalo', 'Peralta', 'gonzalo.peralta', 'revendedor', 10],
    ['Aldana', 'Bustos', 'aldana.bustos', 'revendedor', 8],
    ['Emiliano', 'Quiroga', 'emiliano.quiroga', 'revendedor', 12],
  ] as const
  const usuarios: Record<string, string> = {}
  for (const [nombre, apellido, mail, rol, pct] of equipo) {
    const id = randomUUID()
    usuarios[mail] = id
    await prisma.usuario.create({ data: {
      id, empresa_id: empresaId, nombre, apellido, email: `${mail}@example.com`, password: hash, rol, activo: true,
      porcentaje_comision: pct, created_at: new Date(now - Math.floor(rnd(id.length + nombre.length) * 60) * DAY),
    } })
  }
  // Ventas atribuidas a revendedores
  const revs = ['gonzalo.peralta', 'aldana.bustos', 'emiliano.quiroga']
  const entradas = await prisma.entrada.findMany({ where: { evento_id: { in: eventos.map((e) => e.id) } }, select: { id: true, precio_pagado: true } })
  let i = 0
  for (const e of entradas) {
    if (rnd(i++) < 0.28) {
      const r = revs[i % revs.length]
      const pct = r === 'gonzalo.peralta' ? 0.1 : r === 'aldana.bustos' ? 0.08 : 0.12
      await prisma.entrada.update({ where: { id: e.id }, data: { revendedor_id: usuarios[r], comision_revendedor: Math.round(Number(e.precio_pagado) * pct * 100) / 100 } })
    }
  }
  console.log('[equipo] 4 usuarios + 3 revendedores con ventas atribuidas')

  // ── Barra y ventas de consumibles ────────────────────────────────────────
  const evBarra = eventos[0]
  const barra = await prisma.barra.findFirstOrThrow({ where: { empresa_id: empresaId } })
  // Productos sin marcas reales y con ilustración propia (scripts/arte-demo.mjs)
  const productos: Array<[string, string, string]> = [
    ['Fernet con Coca', 'Fernet con Cola', 'prod-fernet'],
    ['Cerveza Quilmes', 'Cerveza Rubia', 'prod-cerveza'],
    ['Gin Tonic', 'Gin Tonic', 'prod-gintonic'],
    ['Vodka', 'Vodka', 'prod-vodka'],
    ['Red Bull', 'Energizante', 'prod-energizante'],
    ['Agua sin gas', 'Agua sin gas', 'prod-agua'],
  ]
  for (const [viejo, nombre, img] of productos) {
    await prisma.consumible.updateMany({
      where: { empresa_id: empresaId, nombre: { in: [viejo, nombre] } },
      data: { nombre, imagen_url: `http://localhost:3000/demo/${img}.jpg` },
    })
  }
  const consumibles = await prisma.consumible.findMany({ where: { empresa_id: empresaId, activo: true } })
  await prisma.consumiblesVenta.deleteMany({ where: { empresa_id: empresaId } })
  const medios = ['efectivo', 'mercadopago', 'tarjeta', 'mercadopago']
  for (let v = 0; v < 160; v++) {
    const items = Array.from({ length: 1 + Math.floor(rnd(v + 3) * 3) }, (_, k) => {
      const c = consumibles[Math.floor(rnd(v * 7 + k) * consumibles.length)]
      const cantidad = 1 + Math.floor(rnd(v + k * 11) * 3)
      return { c, cantidad, subtotal: Number(c.precio) * cantidad }
    })
    const total = items.reduce((s, x) => s + x.subtotal, 0)
    const fee = Math.round(total * 0.08 * 100) / 100
    const ventaId = randomUUID()
    const canjeada = rnd(v * 5) < 0.85
    await prisma.consumiblesVenta.create({ data: {
      id: ventaId, barra_id: barra.id, evento_id: evBarra.id, empresa_id: empresaId, origen: rnd(v) < 0.6 ? 'manual' : 'online',
      qr_code: randomUUID(), clave_corta: clave(), total, medio_pago: medios[v % medios.length], estado: canjeada ? 'canjeado' : 'pendiente',
      canjeado_at: canjeada ? new Date(now - Math.floor(rnd(v) * 30) * DAY) : null, owner_fee_amount: fee,
      mp_fee_amount: Math.round(total * 0.0399 * 100) / 100, neto_empresa_amount: Math.round((total - fee) * 100) / 100,
      created_at: new Date(now - Math.floor(rnd(v * 2) * 30) * DAY - Math.floor(rnd(v) * 12) * 3600 * 1000),
    } as never })
    await prisma.consumiblesVentaItem.createMany({ data: items.map((x) => ({ id: randomUUID(), venta_id: ventaId, consumible_id: x.c.id, nombre_snapshot: x.c.nombre, precio_unitario: x.c.precio, cantidad: x.cantidad, subtotal: x.subtotal })) })
  }
  console.log('[barra] 160 ventas de consumibles')

  await prisma.consumiblePromocion.deleteMany({ where: { empresa_id: empresaId } })
  const ids = JSON.stringify(consumibles.slice(0, 3).map((c) => c.id))
  await prisma.consumiblePromocion.createMany({ data: [
    { id: randomUUID(), empresa_id: empresaId, evento_id: evBarra.id, nombre: '2x1 en Fernet', descripcion: 'Llevá dos, pagá uno hasta las 2 AM.', tipo: 'nx', valor: 2, consumible_ids: ids, cantidad_minima: 2, activa: true },
    { id: randomUUID(), empresa_id: empresaId, evento_id: evBarra.id, nombre: 'Combo Happy Hour', descripcion: '20% off en tragos antes de medianoche.', tipo: 'porcentaje', valor: 20, consumible_ids: ids, cantidad_minima: 1, activa: true },
  ] as never })

  // ── Marketing ────────────────────────────────────────────────────────────
  await prisma.marketingCodigoDescuento.deleteMany({ where: { empresa_id: empresaId } })
  await prisma.marketingCodigoDescuento.createMany({ data: [
    { empresa_id: empresaId, codigo: 'CUMBRE15', tipo: 'porcentaje', valor: 15, aplica_a: 'entradas', usos_maximos: 200, usos_actuales: 74, valido_hasta: new Date(now + 20 * DAY) },
    { empresa_id: empresaId, codigo: 'AMIGOS500', tipo: 'monto_fijo', valor: 500, aplica_a: 'todos', usos_maximos: 100, usos_actuales: 38, monto_minimo: 5000 },
    { empresa_id: empresaId, codigo: 'BARRALIBRE', tipo: 'porcentaje', valor: 10, aplica_a: 'consumibles', usos_maximos: null, usos_actuales: 112 },
    { empresa_id: empresaId, codigo: 'VERANO24', tipo: 'porcentaje', valor: 25, aplica_a: 'todos', usos_maximos: 50, usos_actuales: 50, activo: false },
  ] as never })
  await prisma.marketingSegmento.deleteMany({ where: { empresa_id: empresaId } })
  const segs = await Promise.all(['Compradores recurrentes', 'Asistentes a Fiesta Retro 90s', 'Clientes VIP'].map((nombre, k) =>
    prisma.marketingSegmento.create({ data: { empresa_id: empresaId, nombre, descripcion: ['Compraron en 2 o más eventos.', 'Fueron al último evento pasado.', 'Compraron entradas VIP.'][k], tipo: 'manual' } as never })))
  await prisma.marketingCampana.deleteMany({ where: { empresa_id: empresaId } })
  await prisma.marketingCampana.createMany({ data: [
    { empresa_id: empresaId, nombre: 'Lanzamiento Festival Cumbre', tipo: 'manual', asunto: 'Ya están a la venta las entradas del Festival Cumbre 🎶', contenido_html: '<p>Early Bird por tiempo limitado.</p>', segmento_id: segs[0].id, evento_id: eventos[1]?.id, estado: 'enviada', enviada_at: new Date(now - 6 * DAY), total_destinatarios: 1840, total_enviados: 1812, total_abiertos: 902, total_clicks: 311, total_bounces: 28, total_spam: 3 },
    { empresa_id: empresaId, nombre: 'Gracias por venir — Sunset Sessions', tipo: 'manual', asunto: 'Gracias por una noche increíble', contenido_html: '<p>Tu opinión nos ayuda a mejorar.</p>', segmento_id: segs[1].id, evento_id: eventos[2]?.id, estado: 'enviada', enviada_at: new Date(now - 10 * DAY), total_destinatarios: 612, total_enviados: 608, total_abiertos: 355, total_clicks: 98, total_bounces: 4, total_spam: 0 },
    { empresa_id: empresaId, nombre: 'Última chance VIP', tipo: 'manual', asunto: 'Últimos lugares VIP para Noche Eléctrica', contenido_html: '<p>Quedan pocos.</p>', segmento_id: segs[2].id, evento_id: eventos[0]?.id, estado: 'borrador', programada_para: new Date(now + 3 * DAY) },
  ] as never })
  console.log('[marketing] 4 códigos, 3 segmentos, 3 campañas')

  // ── Reembolsos y lista de espera ─────────────────────────────────────────
  const checkout = await prisma.checkoutSession.findFirst({ where: { empresa_id: empresaId } }).catch(() => null)
  await prisma.refundManualCase.deleteMany({ where: { empresa_id: empresaId } })
  const motivos: Array<[string, string, number]> = [
    ['requested', 'Compré por error la categoría equivocada', 9000],
    ['under_review', 'No puedo asistir (viaje)', 18000],
    ['resolved_non_refundable', 'Fuera del plazo de reembolso', 6000],
    ['rejected', 'Entrada ya utilizada', 9000],
  ]
  for (const [k, [status, motivo, monto]] of motivos.entries()) {
    await prisma.refundManualCase.create({ data: {
      id: randomUUID(), empresa_id: empresaId, checkout_session_id: checkout?.id ?? `demo-checkout-${k}`, flow: 'entradas', status, requested_amount: monto,
      request_reason: motivo, requester_actor_id: usuarios['paula.ortega'], requester_actor_type: 'usuario', created_by: usuarios['paula.ortega'],
      created_at: new Date(now - (k + 1) * 2 * DAY),
    } as never }).catch((e) => console.log('[refund] omitido:', String(e.message).split('\n').pop()))
  }

  const cat = await prisma.entradaCategoria.findFirst({ where: { evento_id: eventos[0].id, nombre: 'VIP' } })
  const compradores = await prisma.comprador.findMany({ where: { empresa_id: empresaId }, take: 6 })
  await prisma.waitlistEntry.deleteMany({ where: { empresa_id: empresaId } })
  if (cat) await prisma.waitlistEntry.createMany({ data: compradores.map((c, k) => ({
    id: randomUUID(), empresa_id: empresaId, evento_id: eventos[0].id, categoria_id: cat.id, comprador_id: c.id,
    cantidad_solicitada: 1 + (k % 3), estado: k < 4 ? 'esperando' : 'notificado', created_at: new Date(now - k * DAY),
  })) as never })
  console.log('[reembolsos] 4 casos · [waitlist] 6 anotados')

  // ── Entradas usadas + reparto de comisiones de la plataforma (dashboard superadmin) ──
  await prisma.entrada.updateMany({ where: { usada_at: { not: null } }, data: { estado: 'usada' } })
  const admin = await prisma.platformAdminUser.findFirstOrThrow()
  await prisma.platformSaleAllocation.deleteMany({ where: { empresa_id: empresaId } })
  const ventasEntradas = await prisma.entrada.findMany({ where: { evento_id: { in: eventos.map((e) => e.id) } }, select: { id: true, comision: true, created_at: true } })
  const ventasBarra = await prisma.consumiblesVenta.findMany({ where: { empresa_id: empresaId }, select: { id: true, owner_fee_amount: true, created_at: true } })
  const alloc = (source_type: 'entrada' | 'consumible_venta', flow: 'entradas' | 'consumibles', source_id: string, fee: unknown, created_at: Date) => ({
    id: randomUUID(), source_type, source_id, empresa_id: empresaId, flow, owner_fee_amount: Number(fee), allocated_amount: Number(fee),
    allocation_percentage: 100, configured_platform_admin_user_id: admin.id, effective_platform_admin_user_id: admin.id, created_at,
  })
  await prisma.platformSaleAllocation.createMany({ data: [
    ...ventasEntradas.map((e) => alloc('entrada', 'entradas', e.id, e.comision, e.created_at)),
    ...ventasBarra.map((v) => alloc('consumible_venta', 'consumibles', v.id, v.owner_fee_amount ?? 0, v.created_at)),
  ] as never })
  // Stock realista: General y VIP disponibles (Early Bird queda agotado para mostrar la lista de espera)
  for (const ev of eventos) {
    const cats = await prisma.entradaCategoria.findMany({ where: { evento_id: ev.id } })
    for (const cat of cats) {
      const vendidas = await prisma.entrada.count({ where: { categoria_id: cat.id, estado: { not: 'cancelada' } } })
      const stock = cat.nombre === 'Early Bird' ? vendidas : cat.nombre === 'VIP' ? Math.max(60, vendidas + 25) : Math.max(250, vendidas + 80)
      await prisma.entradaCategoria.update({ where: { id: cat.id }, data: { stock, stock_disponible: stock - vendidas } })
    }
  }
  // ── Comprador demo con entradas (para "mis tickets", QR y checkout) ──
  const demoBuyer = await prisma.comprador.findFirstOrThrow({ where: { empresa_id: empresaId, email: 'comprador@demo.ticketera.test' } })
  await prisma.comprador.update({ where: { id: demoBuyer.id }, data: { nombre: 'Camila', apellido: 'Rossi', password: hash, activo: true } })
  await prisma.entrada.deleteMany({ where: { comprador_id: demoBuyer.id } })
  const evNombres = ['Noche Eléctrica Vol. 7', 'Festival Cumbre 2026', 'Sunset Rooftop Sessions']
  for (const [k, nombre] of evNombres.entries()) {
    const ev = eventos.find((e) => e.nombre === nombre)
    if (!ev) continue
    const cats = await prisma.entradaCategoria.findMany({ where: { evento_id: ev.id }, orderBy: { precio: 'desc' } })
    for (let n = 0; n < (k === 0 ? 2 : 1); n++) {
      const cat = cats[k % cats.length]
      await prisma.entrada.create({ data: {
        id: randomUUID(), evento_id: ev.id, categoria_id: cat.id, comprador_id: demoBuyer.id, qr_code: randomUUID(), clave_corta: clave(),
        estado: k === 2 ? 'usada' : 'valida', precio_pagado: cat.precio, comision: Number(cat.precio) * 0.12, nombre_comprador: 'Camila', apellido_comprador: 'Rossi',
        dni_comprador: '36123456', usada_at: k === 2 ? new Date(now - 12 * DAY) : null, created_at: new Date(now - (k + 1) * DAY),
      } as never })
    }
  }
  console.log('[comprador] Camila Rossi con entradas')
  console.log('[plataforma] allocations:', ventasEntradas.length + ventasBarra.length)
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
