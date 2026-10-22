/**
 * seed-reel-demo.ts
 * =====================================================================
 * Siembra una productora DEMO completa y creíble, para poder grabar la app
 * real en los reels de Instagram sin mostrar datos de ningún cliente.
 *
 * POR QUÉ NO SE REUSÓ seed-events-demo.ts
 * Ese script es del stack anterior: su cabecera dice "Populates XAMPP MariaDB
 * (port 3306)" e importa `../src/db`. El proyecto ya migró a Postgres + Prisma,
 * así que no corre. Este usa Prisma y el schema actual.
 *
 * ⚠️ SEGURIDAD: se niega a correr contra una base que no sea local.
 * `backend/.env` apunta el entorno local a la base de PRODUCCIÓN en Supabase,
 * así que sin este chequeo un descuido mete una empresa falsa con ventas falsas
 * en la base real, y eso contamina las métricas del super-admin y los reportes
 * de facturación.
 *
 *   USO:
 *     cd backend
 *     DATABASE_URL="postgresql://postgres:postgres@localhost:5433/ticketera_demo" \
 *     DIRECT_URL="$DATABASE_URL" \
 *     npx tsx scripts/seed-reel-demo.ts
 *
 *   LIMPIEZA: la base entera es descartable (docker volume). Para rehacerla:
 *     docker exec platea-backend-postgres-test psql -U postgres \
 *       -c "DROP DATABASE ticketera_demo;" -c "CREATE DATABASE ticketera_demo;"
 * =====================================================================
 */

import { randomUUID } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { PrismaClient } from '@prisma/client'

// ── Guardia de destino ─────────────────────────────────────────────────────
const URL_DB = process.env.DATABASE_URL ?? ''
const HOSTS_OK = ['localhost', '127.0.0.1', '0.0.0.0']
const host = (() => {
  try { return new URL(URL_DB).hostname } catch { return '' }
})()

if (!HOSTS_OK.includes(host)) {
  console.error(
    `\n✗ Me niego a sembrar contra "${host || '(DATABASE_URL vacía)'}".\n` +
    `  Este seed crea una empresa y ventas FALSAS. Si eso entra en la base de\n` +
    `  producción contamina las métricas del super-admin y la facturación.\n` +
    `  Apuntá DATABASE_URL al Postgres local (localhost:5433).\n`,
  )
  process.exit(1)
}

const prisma = new PrismaClient()

// ── La productora inventada ────────────────────────────────────────────────
// Nombre deliberadamente inventado para no pisar el de ninguna productora real.
// Si alguna vez aparece una que se llame así, se cambia acá y se re-siembra.
const EMPRESA = {
  id: randomUUID(),
  nombre: 'Distrito Vinilo',
  slug: 'distrito-vinilo',
  email: 'hola@distritovinilo.demo',
  password: 'demo1234',
  color_primario: '#7c3aed',   // violeta: NO es el azul de TICKETERA a propósito,
  color_fondo: '#0b0710',      // así en cámara se ve que el tenant lleva SU marca
  color_texto: '#f5f3ff',
  descripcion: 'Fiestas de música electrónica en Córdoba. Line-ups rotativos, pista y patio.',
}

const NOMBRES = ['Sofía', 'Mateo', 'Valentina', 'Joaquín', 'Camila', 'Benjamín', 'Martina', 'Thiago', 'Emilia', 'Bautista', 'Catalina', 'Lautaro', 'Renata', 'Santino', 'Delfina', 'Ignacio', 'Julieta', 'Facundo', 'Pilar', 'Tomás']
const APELLIDOS = ['Gómez', 'Fernández', 'Rodríguez', 'López', 'Martínez', 'Sosa', 'Romero', 'Álvarez', 'Torres', 'Ruiz', 'Benítez', 'Acosta', 'Medina', 'Herrera', 'Aguirre']

/* Generador determinista: mismo seed = misma data. Importa para poder
 * re-grabar un reel y que las pantallas coincidan con la toma anterior. */
let semilla = 20260810
const rnd = () => {
  semilla = (semilla * 1103515245 + 12345) & 0x7fffffff
  return semilla / 0x7fffffff
}
const entre = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1))
const deLista = <T>(xs: T[]) => xs[entre(0, xs.length - 1)]

const dias = (n: number) => new Date(Date.now() + n * 86400_000)

async function main() {
  console.log(`▸ Sembrando "${EMPRESA.nombre}" en ${host}...\n`)

  const hash = await bcrypt.hash(EMPRESA.password, 12)

  await prisma.empresa.create({
    data: {
      id: EMPRESA.id,
      nombre: EMPRESA.nombre,
      slug: EMPRESA.slug,
      email: EMPRESA.email,
      password: hash,
      admin_nombre: 'Nico',
      admin_apellido: 'Duarte',
      activa: true,
      es_prueba: true,               // marcada como demo también en la propia DB
      color_primario: EMPRESA.color_primario,
      color_fondo: EMPRESA.color_fondo,
      color_texto: EMPRESA.color_texto,
      descripcion: EMPRESA.descripcion,
      whatsapp: '+543510000000',
      eventos_layout: 'cartelera',
      mostrar_tanda_activa_home: true,
      mostrar_badge_stock_home: true,
    },
  })
  console.log(`  ✓ empresa (login: ${EMPRESA.email} / ${EMPRESA.password})`)

  // ── Equipo: muestra los roles reales del producto en pantalla ────────────
  const equipo = [
    { nombre: 'Nico', apellido: 'Duarte', rol: 'admin', email: 'nico@distritovinilo.demo' },
    { nombre: 'Aye', apellido: 'Ferreyra', rol: 'puerta', email: 'aye@distritovinilo.demo' },
    { nombre: 'Rama', apellido: 'Quiroga', rol: 'barra', email: 'rama@distritovinilo.demo' },
    { nombre: 'Sol', apellido: 'Vera', rol: 'vendedor', email: 'sol@distritovinilo.demo' },
    { nombre: 'Fede', apellido: 'Paz', rol: 'revendedor', email: 'fede@distritovinilo.demo', comision: 10 },
  ]
  for (const u of equipo) {
    await prisma.usuario.create({
      data: {
        id: randomUUID(), empresa_id: EMPRESA.id,
        nombre: u.nombre, apellido: u.apellido, email: u.email,
        password: hash, rol: u.rol, activo: true,
        porcentaje_comision: u.comision ?? null,
      },
    })
  }
  console.log(`  ✓ equipo (${equipo.length} usuarios, roles reales)`)

  // ── Compradores ──────────────────────────────────────────────────────────
  const compradores: string[] = []
  for (let i = 0; i < 220; i++) {
    const id = randomUUID()
    const nombre = deLista(NOMBRES), apellido = deLista(APELLIDOS)
    await prisma.comprador.create({
      data: {
        id, empresa_id: EMPRESA.id, nombre, apellido,
        // .invalid es un TLD reservado por la RFC 2606: imposible que exista.
        email: `${nombre.toLowerCase()}.${apellido.toLowerCase()}${i}@demo.invalid`,
        dni: String(entre(28_000_000, 46_000_000)),
        created_at: dias(-entre(1, 120)),
      },
    })
    compradores.push(id)
  }
  console.log(`  ✓ compradores (${compradores.length})`)

  // ── Eventos ──────────────────────────────────────────────────────────────
  const EVENTOS = [
    {
      nombre: 'Vinilo Nights · Edición Invierno',
      lugar: 'Galpón 9', ciudad: 'Córdoba', enDias: 12, imagenVentas: 0.72,
      cats: [
        { nombre: 'Early Bird', precio: 9000, stock: 200, tanda: 'agotada' },
        { nombre: 'General', precio: 13500, stock: 500, tanda: 'activa' },
        { nombre: 'VIP · Patio', precio: 22000, stock: 120, tanda: 'activa' },
        { nombre: 'General · Última tanda', precio: 17000, stock: 300, tanda: 'proxima' },
      ],
    },
    {
      nombre: 'Techno Sur · B2B',
      lugar: 'Club Rotativo', ciudad: 'Córdoba', enDias: 26, imagenVentas: 0.31,
      cats: [
        { nombre: 'Early Bird', precio: 8000, stock: 150, tanda: 'activa' },
        { nombre: 'General', precio: 12000, stock: 400, tanda: 'proxima' },
      ],
    },
    {
      nombre: 'Aniversario · 5 Años',
      lugar: 'Galpón 9', ciudad: 'Córdoba', enDias: -21, imagenVentas: 0.98,
      cats: [
        { nombre: 'General', precio: 11000, stock: 450, tanda: 'agotada' },
        { nombre: 'VIP · Patio', precio: 19000, stock: 100, tanda: 'agotada' },
      ],
    },
  ]

  let totalEntradas = 0
  const eventoIds: { id: string; nombre: string; pasado: boolean }[] = []

  for (const ev of EVENTOS) {
    const eventoId = randomUUID()
    const pasado = ev.enDias < 0
    await prisma.evento.create({
      data: {
        id: eventoId, empresa_id: EMPRESA.id, nombre: ev.nombre,
        descripcion: 'Line-up completo en el flyer. Puertas 23:59. +18 con DNI.',
        lugar: ev.lugar, ciudad: ev.ciudad, modo_fecha: 'unica',
        activo: true, publication_mode: 'immediate',
        venta_consumibles_habilitada: true,
        created_at: dias(-entre(40, 90)),
      },
    })
    const fechaId = randomUUID()
    await prisma.eventoFecha.create({ data: { id: fechaId, evento_id: eventoId, fecha: dias(ev.enDias) } })
    eventoIds.push({ id: eventoId, nombre: ev.nombre, pasado })

    for (const c of ev.cats) {
      const tandaId = randomUUID()
      await prisma.eventoTanda.create({
        data: { id: tandaId, evento_id: eventoId, nombre: c.nombre, estado: c.tanda, orden: 0 },
      })

      // Las tandas próximas todavía no vendieron nada: es lo que hace creíble
      // el estado en pantalla.
      const ratio = c.tanda === 'proxima' ? 0 : c.tanda === 'agotada' ? 1 : ev.imagenVentas
      const vendidas = Math.round(c.stock * ratio)
      const catId = randomUUID()

      await prisma.entradaCategoria.create({
        data: {
          id: catId, evento_id: eventoId, tanda_id: tandaId, nombre: c.nombre,
          precio: c.precio, stock: c.stock, stock_disponible: c.stock - vendidas,
          activa: c.tanda !== 'proxima',
        },
      })

      for (let i = 0; i < vendidas; i++) {
        const compradorId = deLista(compradores)
        const precio = c.precio
        const comision = Math.round(precio * 0.04)   // 4% entradas (PRODUCT.md §5)
        // Del evento pasado, la mayoría entró; de los próximos, ninguna se usó.
        const usada = pasado && rnd() < 0.93
        await prisma.entrada.create({
          data: {
            id: randomUUID(), evento_id: eventoId, categoria_id: catId, fecha_id: fechaId,
            comprador_id: compradorId,
            qr_code: `DV-${randomUUID()}`,
            clave_corta: `${entre(100000, 999999)}${totalEntradas}`.slice(0, 12),
            estado: usada ? 'usada' : 'valida',
            precio_pagado: precio, comision,
            neto_empresa_amount: precio - comision,
            usada_at: usada ? dias(ev.enDias) : null,
            created_at: dias(ev.enDias - entre(1, 45)),
          },
        })
        totalEntradas++
      }
    }
    console.log(`  ✓ evento "${ev.nombre}"`)
  }
  console.log(`  ✓ entradas emitidas (${totalEntradas})`)

  // ── Barra ────────────────────────────────────────────────────────────────
  const CATALOGO = [
    { nombre: 'Fernet con Coca', categoria: 'Tragos', tipo: 'bebida_alcoholica', precio: 6500, ini: 400 },
    { nombre: 'Gin Tonic', categoria: 'Tragos', tipo: 'bebida_alcoholica', precio: 7800, ini: 300 },
    { nombre: 'Cerveza IPA 473ml', categoria: 'Cervezas', tipo: 'bebida_alcoholica', precio: 5200, ini: 500 },
    { nombre: 'Campari Tonic', categoria: 'Tragos', tipo: 'bebida_alcoholica', precio: 7200, ini: 200 },
    { nombre: 'Vodka Speed', categoria: 'Tragos', tipo: 'bebida_alcoholica', precio: 6800, ini: 350 },
    { nombre: 'Agua sin gas 500ml', categoria: 'Sin alcohol', tipo: 'bebida_sin_alcohol', precio: 2500, ini: 600 },
    { nombre: 'Coca Cola 500ml', categoria: 'Sin alcohol', tipo: 'bebida_sin_alcohol', precio: 3000, ini: 400 },
  ] as const

  const consumibleIds: { id: string; precio: number }[] = []
  for (const c of CATALOGO) {
    const id = randomUUID()
    await prisma.consumible.create({
      data: {
        id, empresa_id: EMPRESA.id, nombre: c.nombre, categoria: c.categoria,
        tipo: c.tipo, precio: c.precio, activo: true,
      },
    })
    consumibleIds.push({ id, precio: c.precio })
  }

  const eventoActivo = eventoIds[0]
  let ventasBarra = 0
  for (const nombreBarra of ['Barra Principal', 'Barra Patio']) {
    const barraId = randomUUID()
    await prisma.barra.create({
      data: { id: barraId, evento_id: eventoActivo.id, empresa_id: EMPRESA.id, nombre: nombreBarra, activa: true },
    })

    for (let k = 0; k < CATALOGO.length; k++) {
      const c = CATALOGO[k]
      const inicial = nombreBarra === 'Barra Patio' ? Math.round(c.ini * 0.5) : c.ini
      // Stock parcialmente consumido: una barra intacta se ve a demo de lejos.
      const actual = Math.max(0, inicial - entre(Math.round(inicial * 0.25), Math.round(inicial * 0.7)))
      await prisma.barraStock.create({
        data: {
          id: randomUUID(), barra_id: barraId, consumible_id: consumibleIds[k].id,
          stock_inicial: inicial, stock_actual: actual, activo: true,
        },
      })
    }

    // Ventas de barra, para que el POS y los reportes no estén en cero.
    for (let i = 0; i < 60; i++) {
      const idx = entre(0, CATALOGO.length - 1)
      const item = consumibleIds[idx]
      const cant = entre(1, 3)
      const total = item.precio * cant
      const ventaId = randomUUID()
      const canjeado = rnd() < 0.8
      await prisma.consumiblesVenta.create({
        data: {
          id: ventaId, barra_id: barraId, evento_id: eventoActivo.id, empresa_id: EMPRESA.id,
          comprador_id: deLista(compradores),
          origen: rnd() < 0.5 ? 'online' : 'pos',
          qr_code: `DVC-${randomUUID()}`,
          clave_corta: `C${entre(100000, 999999)}${i}`.slice(0, 12),
          total, estado: canjeado ? 'canjeado' : 'pendiente',
          canjeado_at: canjeado ? dias(-entre(0, 3)) : null,
          medio_pago: deLista(['efectivo', 'tarjeta_manual', 'transferencia']),
          owner_fee_percentage: 3,                       // 3% consumibles
          owner_fee_amount: Math.round(total * 0.03),
          created_at: dias(-entre(0, 20)),
        },
      })
      await prisma.consumiblesVentaItem.create({
        data: {
          id: randomUUID(), venta_id: ventaId, consumible_id: item.id,
          nombre_snapshot: CATALOGO[idx].nombre,
          cantidad: cant, precio_unitario: item.precio, subtotal: total,
        },
      })
      ventasBarra++
    }
    console.log(`  ✓ ${nombreBarra} (catálogo + stock parcial)`)
  }
  console.log(`  ✓ ventas de barra (${ventasBarra})`)

  console.log(`\n  Listo. Storefront: /t/${EMPRESA.slug}`)
  console.log(`  Login empresa: ${EMPRESA.email} / ${EMPRESA.password}\n`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
