/**
 * seed-portfolio.ts — completa la empresa demo (seed:demo) con datos creíbles para capturas:
 * varios eventos (pasados y futuros), ventas repartidas en 30 días, compradores y Mercado Pago "conectado".
 * Solo base local. Uso: set -a; . ./.env; set +a; npx tsx scripts/seed-portfolio.ts
 */
import { randomUUID } from 'node:crypto'
import { prisma } from '../src/lib/prisma'
import { upsertPaymentAccountByEmpresaId } from '../src/lib/payment-accounts'

const url = process.env.DATABASE_URL ?? ''
if (!/localhost|127\.0\.0\.1/.test(url)) throw new Error('Solo contra una base local.')

const DAY = 24 * 3600 * 1000
const now = Date.now()
// Arte propio generado por scripts/arte-demo.mjs (sin fotos de stock).
const IMG = {
  a: 'http://localhost:3000/demo/flyer-noche-electrica.jpg',
  b: 'http://localhost:3000/demo/flyer-festival-cumbre.jpg',
  c: 'http://localhost:3000/demo/flyer-sunset-rooftop.jpg',
  d: 'http://localhost:3000/demo/flyer-fiesta-retro.jpg',
}
const NOMBRES = ['Lucas', 'Martina', 'Joaquín', 'Camila', 'Santiago', 'Valentina', 'Mateo', 'Julieta', 'Franco', 'Sofía', 'Tomás', 'Agustina', 'Nicolás', 'Milagros', 'Bruno', 'Florencia', 'Facundo', 'Lucía', 'Ignacio', 'Carolina']
const APELLIDOS = ['Gómez', 'Rodríguez', 'Fernández', 'López', 'Martínez', 'Pérez', 'Sosa', 'Romero', 'Díaz', 'Torres', 'Álvarez', 'Ruiz', 'Acosta', 'Benítez', 'Molina']
const pick = <T,>(a: T[], i: number) => a[i % a.length]
const rnd = (seed: number) => { const x = Math.sin(seed) * 10000; return x - Math.floor(x) }

async function main() {
  const empresa = await prisma.empresa.findFirstOrThrow({ where: { email: 'demo@demo.ticketera.test' } })
  const empresaId = empresa.id

  await prisma.empresa.update({
    where: { id: empresaId },
    data: { nombre: 'Nocturna Producciones', slug: 'nocturna', admin_nombre: 'Lucía', admin_apellido: 'Fernández' },
  })

  // Renombrar las empresas de la red (superadmin) con nombres creíbles
  const red: Record<string, string> = {
    'Demo Atlas Shows': 'Atlas Shows', 'Demo Brava Tickets': 'Brava Entradas', 'Demo Cobalto Venue': 'Cobalto Club',
    'Demo Delta Zero': 'Delta Eventos', 'Demo Épica Food & Live': 'Épica Food & Live',
  }
  for (const [from, to] of Object.entries(red)) await prisma.empresa.updateMany({ where: { nombre: from }, data: { nombre: to } })

  // Compradores
  const compradores: string[] = []
  for (let i = 0; i < 40; i++) {
    const nombre = pick(NOMBRES, i * 7), apellido = pick(APELLIDOS, i * 3 + 1)
    const email = `${nombre}.${apellido}${i}@example.com`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    const found = await prisma.comprador.findFirst({ where: { empresa_id: empresaId, email } })
    compradores.push(found?.id ?? (await prisma.comprador.create({
      data: { id: randomUUID(), empresa_id: empresaId, nombre, apellido, email, dni: String(30000000 + i * 91), password: 'x', activo: true },
    })).id)
  }

  // Eventos
  const existente = await prisma.evento.findFirst({ where: { empresa_id: empresaId }, orderBy: { created_at: 'asc' } })
  if (existente) await prisma.evento.update({ where: { id: existente.id }, data: { nombre: 'Noche Eléctrica Vol. 7', lugar: 'Complejo Forum, Córdoba', imagen_url: IMG.a, descripcion: 'Line-up de música electrónica con tres escenarios.' } })
  const eventos = [
    { id: existente?.id, nombre: 'Noche Eléctrica Vol. 7', lugar: 'Complejo Forum, Córdoba', img: IMG.a, dias: 21, ventas: 70 },
    { id: undefined, nombre: 'Festival Cumbre 2026', lugar: 'Parque Sarmiento, Córdoba', img: IMG.b, dias: 48, ventas: 120 },
    { id: undefined, nombre: 'Sunset Rooftop Sessions', lugar: 'Terraza Buen Pastor, Córdoba', img: IMG.c, dias: -12, ventas: 85 },
    { id: undefined, nombre: 'Fiesta Retro 90s', lugar: 'Quality Espacio, Córdoba', img: IMG.d, dias: -35, ventas: 60 },
  ]
  let seq = 0
  for (const ev of eventos) {
    let eventoId = ev.id
    if (!eventoId) {
      const e = await prisma.evento.create({ data: {
        id: randomUUID(), empresa_id: empresaId, nombre: ev.nombre, descripcion: 'Una noche pensada para vivir la música en vivo.', lugar: ev.lugar,
        modo_fecha: 'unica', imagen_url: ev.img, activo: true, venta_consumibles_habilitada: true,
        publication_mode: 'immediate', pre_publish_visibility: 'hidden', publish_timezone: 'America/Argentina/Buenos_Aires',
      } })
      eventoId = e.id
      await prisma.eventoFecha.create({ data: { id: randomUUID(), evento_id: eventoId, fecha: new Date(now + ev.dias * DAY) } })
    } else {
      await prisma.eventoFecha.updateMany({ where: { evento_id: eventoId }, data: { fecha: new Date(now + ev.dias * DAY) } })
      await prisma.entrada.deleteMany({ where: { evento_id: eventoId } })
    }
    if (!ev.id && (await prisma.entrada.count({ where: { evento_id: eventoId } })) > 0) continue

    let categorias = await prisma.entradaCategoria.findMany({ where: { evento_id: eventoId } })
    if (categorias.length === 0) {
      const defs = [['Early Bird', 6000, 40], ['General', 9000, 250], ['VIP', 18000, 60]] as const
      for (const [nombre, precio, stock] of defs) {
        categorias.push(await prisma.entradaCategoria.create({ data: { id: randomUUID(), evento_id: eventoId, nombre, precio, stock, stock_disponible: stock, activa: true, entradas_por_unidad: 1 } }))
      }
    }
    categorias = categorias.filter((c) => c.stock > 0)
    const pasado = ev.dias < 0
    const filas: Array<Record<string, unknown> & { _cat: string }> = []
    for (let i = 0; i < ev.ventas; i++) {
      const cat = categorias[Math.floor(rnd(seq + i) * categorias.length)]
      const precio = Number(cat.precio)
      const comision = Math.round(precio * 0.12 * 100) / 100
      const mpFee = Math.round(precio * 0.0399 * 100) / 100
      const diasAtras = Math.floor(rnd(seq * 3 + i * 5) * 30) + (pasado ? Math.abs(ev.dias) : 0)
      filas.push({
        id: randomUUID(), evento_id: eventoId, categoria_id: cat.id, comprador_id: pick(compradores, seq + i), qr_code: randomUUID(),
        clave_corta: randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase(), estado: 'valida', precio_pagado: precio,
        comision, mp_fee_amount: mpFee, neto_empresa_amount: Math.round((precio - comision - mpFee) * 100) / 100,
        nombre_comprador: pick(NOMBRES, seq + i * 7), apellido_comprador: pick(APELLIDOS, seq + i * 3 + 1),
        usada_at: pasado && rnd(i + seq) < 0.82 ? new Date(now + ev.dias * DAY) : null,
        created_at: new Date(now - diasAtras * DAY - Math.floor(rnd(i) * 20) * 3600 * 1000),
        _cat: cat.id,
      })
    }
    await prisma.entrada.createMany({ data: filas.map(({ _cat, ...f }) => f) as never })
    for (const c of categorias) {
      const n = filas.filter((f) => f._cat === c.id).length
      await prisma.entradaCategoria.update({ where: { id: c.id }, data: { stock: Math.max(c.stock, n), stock_disponible: Math.max(c.stock, n) - n } })
    }
    seq += ev.ventas
    console.log(`[evento] ${ev.nombre}: ${filas.length} entradas`)
  }

  // Mercado Pago "conectado": token ficticio cifrado con la clave local (no hay credenciales reales)
  await upsertPaymentAccountByEmpresaId({
    empresaId, accessToken: 'APP_USR-DEMO-0000000000', providerAccountLabel: 'Nocturna Producciones — Mercado Pago',
  })
  await prisma.empresaPaymentAccount.updateMany({
    where: { empresa_id: empresaId },
    data: { status: 'ready_to_sell' as never, reason: null, validated_at: new Date(), oauth_connected_at: new Date(), blocked_at: null, last_validation_error: null },
  })
  console.log('[mp] cuenta ficticia marcada ready_to_sell')
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
