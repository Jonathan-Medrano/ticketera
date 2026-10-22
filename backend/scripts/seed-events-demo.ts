/**
 * seed-events-demo.ts
 * =====================================================================
 * Populates XAMPP MariaDB (port 3306) with realistic DEMO event + sales
 * data for smoke-testing dashboard features (KPI summary, compare mode,
 * sales velocity).
 *
 * All seeded rows use the DEMO_ prefix — cleanup is trivial:
 *
 *   DELETE FROM entradas
 *     WHERE evento_id IN (SELECT id FROM eventos WHERE nombre LIKE 'DEMO\_%' ESCAPE '\\');
 *   DELETE FROM entrada_categorias
 *     WHERE evento_id IN (SELECT id FROM eventos WHERE nombre LIKE 'DEMO\_%' ESCAPE '\\');
 *   DELETE FROM evento_fechas
 *     WHERE evento_id IN (SELECT id FROM eventos WHERE nombre LIKE 'DEMO\_%' ESCAPE '\\');
 *   DELETE FROM evento_ventas_snapshot
 *     WHERE evento_id IN (SELECT id FROM eventos WHERE nombre LIKE 'DEMO\_%' ESCAPE '\\');
 *   DELETE FROM compradores
 *     WHERE email LIKE 'demo+%@demoseed.internal';
 *   DELETE FROM eventos WHERE nombre LIKE 'DEMO\_%' ESCAPE '\\';
 *
 * After seeding, run velocity backfill:
 *   cd backend && npm run backfill:velocity -- --from=<90d-ago> --to=<today>
 *
 * Idempotent: exits immediately if DEMO_ events already exist.
 * =====================================================================
 */

import { randomUUID } from 'node:crypto'
import pool from '../src/db'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const TOTAL_EVENTS = 25
const VENUES = [
  'Niceto Club',
  'Teatro Vorterix',
  'C Art Media',
  'La Trastienda',
  'Movistar Arena',
  'Estadio Luna Park',
]

const ADJECTIVES = [
  'Festival', 'Show', 'Noche', 'Gala', 'Gran', 'Super',
  'Mega', 'Clasico', 'Especial', 'Unico',
]
const NOUNS = [
  'Verano', 'Invierno', 'Rock', 'Acustico', 'Jazz', 'Flamenco',
  'Teatro', 'Comedia', 'Tango', 'Pop', 'Electronico', 'Folk',
]

const CATEGORY_NAMES = ['VIP', 'General', 'Estudiantes', 'Pullman', 'Platea', 'Campo']

const FAKE_NOMBRES = [
  'Valentina', 'Martín', 'Luciana', 'Federico', 'Camila',
  'Santiago', 'Florencia', 'Tomás', 'Agustina', 'Nicolás',
  'Sofía', 'Matías', 'Antonella', 'Ignacio', 'Rocío',
  'Lucas', 'Micaela', 'Leandro', 'Julieta', 'Ezequiel',
]
const FAKE_APELLIDOS = [
  'García', 'López', 'Martínez', 'González', 'Rodríguez',
  'Pérez', 'Fernández', 'Sánchez', 'Ramírez', 'Torres',
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rand(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function randFloat(min: number, max: number) {
  return Math.random() * (max - min) + min
}

function pick<T>(arr: T[]): T {
  return arr[rand(0, arr.length - 1)]
}

/** Return an ISO datetime string offset from today by `daysOffset` and a random hour */
function dayOffset(daysOffset: number): string {
  const d = new Date()
  d.setDate(d.getDate() + daysOffset)
  d.setHours(rand(10, 23), rand(0, 59), 0, 0)
  return d.toISOString().slice(0, 19).replace('T', ' ')
}

/** Bias-weighted random date within [-90d, 0d] relative to event's first date.
 *  The closer to the event date the higher the probability (realistic sales curve). */
function randomSaleDate(eventFirstDateStr: string | null): string {
  const now = new Date()
  const anchor = eventFirstDateStr ? new Date(eventFirstDateStr) : now
  const maxDaysBack = Math.min(90, Math.floor((anchor.getTime() - now.getTime() - 24 * 3600 * 1000) / (24 * 3600 * 1000)) + 90)
  // Bias: cube root gives more weight to values near maxDaysBack (closer to event)
  const bias = Math.pow(Math.random(), 2) // 0..1, squared → bias toward 0 (closer to event)
  const daysBack = Math.floor(bias * Math.min(maxDaysBack, 90))
  const d = new Date()
  d.setDate(d.getDate() - daysBack)
  d.setHours(rand(8, 23), rand(0, 59), rand(0, 59), 0)
  // Ensure we don't go into the future
  if (d > now) return now.toISOString().slice(0, 19).replace('T', ' ')
  return d.toISOString().slice(0, 19).replace('T', ' ')
}

/** 6-char alphanumeric code — used for clave_corta (UNIQUE) */
function makeClaveCorta(): string {
  return randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase()
}

// ---------------------------------------------------------------------------
// Event plan
// ---------------------------------------------------------------------------

type EventPlan = {
  idx: number
  nombre: string
  descripcion: string
  lugar: string
  imagen_url: string | null
  activo: number
  modo_fecha: 'unica' | 'multiple' | 'pase'
  // days offsets for fechas
  fechaDaysOffsets: number[]
  // occupancy bucket
  occupancy: 'sold_out' | 'healthy' | 'low' | 'empty'
  publication_mode: string
  pre_publish_visibility: string
  publish_at_utc: string | null
}

function buildEventPlans(): EventPlan[] {
  const plans: EventPlan[] = []

  // ----- 15 unica events -----
  // 5 future (7-60 days ahead)
  for (let i = 0; i < 5; i++) {
    const daysAhead = rand(7, 60)
    plans.push({
      idx: plans.length + 1,
      nombre: `DEMO_${pick(ADJECTIVES)}_${pick(NOUNS)}_${String(plans.length + 1).padStart(2, '0')}`,
      descripcion: `Una noche especial de música y arte en ${pick(VENUES)}.`,
      lugar: pick(VENUES),
      imagen_url: i % 2 === 0 ? null : `https://picsum.photos/seed/ev${plans.length}/400/400`,
      activo: Math.random() < 0.8 ? 1 : 0,
      modo_fecha: 'unica',
      fechaDaysOffsets: [daysAhead],
      occupancy: (() => {
        const r = Math.random()
        if (r < 0.3) return 'sold_out'
        if (r < 0.6) return 'healthy'
        if (r < 0.85) return 'low'
        return 'empty'
      })(),
      publication_mode: 'immediate',
      pre_publish_visibility: 'hidden',
      publish_at_utc: null,
    })
  }

  // 5 recent past (1-30 days ago)
  for (let i = 0; i < 5; i++) {
    const daysAgo = rand(1, 30)
    plans.push({
      idx: plans.length + 1,
      nombre: `DEMO_${pick(ADJECTIVES)}_${pick(NOUNS)}_${String(plans.length + 1).padStart(2, '0')}`,
      descripcion: `Show íntimo con artistas locales seleccionados en vivo.`,
      lugar: pick(VENUES),
      imagen_url: i % 2 === 0 ? `https://picsum.photos/seed/ev${plans.length}/400/400` : null,
      activo: Math.random() < 0.8 ? 1 : 0,
      modo_fecha: 'unica',
      fechaDaysOffsets: [-daysAgo],
      occupancy: (() => {
        const r = Math.random()
        if (r < 0.3) return 'sold_out'
        if (r < 0.6) return 'healthy'
        if (r < 0.85) return 'low'
        return 'empty'
      })(),
      publication_mode: 'immediate',
      pre_publish_visibility: 'hidden',
      publish_at_utc: null,
    })
  }

  // 5 medium-past (30-90 days ago)
  for (let i = 0; i < 5; i++) {
    const daysAgo = rand(30, 90)
    plans.push({
      idx: plans.length + 1,
      nombre: `DEMO_${pick(ADJECTIVES)}_${pick(NOUNS)}_${String(plans.length + 1).padStart(2, '0')}`,
      descripcion: `Gran evento de música electrónica con DJs internacionales.`,
      lugar: pick(VENUES),
      imagen_url: i % 3 === 0 ? null : `https://picsum.photos/seed/ev${plans.length}/400/400`,
      activo: Math.random() < 0.8 ? 1 : 0,
      modo_fecha: 'unica',
      fechaDaysOffsets: [-daysAgo],
      occupancy: (() => {
        const r = Math.random()
        if (r < 0.3) return 'sold_out'
        if (r < 0.6) return 'healthy'
        if (r < 0.85) return 'low'
        return 'empty'
      })(),
      publication_mode: 'immediate',
      pre_publish_visibility: 'hidden',
      publish_at_utc: null,
    })
  }

  // ----- 5 multiple events -----
  for (let i = 0; i < 5; i++) {
    const numFechas = rand(2, 4)
    const offsets: number[] = []
    for (let j = 0; j < numFechas; j++) {
      const base = i % 2 === 0 ? rand(-60, -5) : rand(5, 90)
      offsets.push(base + j * rand(7, 21))
    }
    plans.push({
      idx: plans.length + 1,
      nombre: `DEMO_${pick(ADJECTIVES)}_${pick(NOUNS)}_${String(plans.length + 1).padStart(2, '0')}`,
      descripcion: `Ciclo de funciones con artistas consagrados de la escena nacional.`,
      lugar: pick(VENUES),
      imagen_url: i % 2 === 0 ? `https://picsum.photos/seed/ev${plans.length}/400/400` : null,
      activo: Math.random() < 0.8 ? 1 : 0,
      modo_fecha: 'multiple',
      fechaDaysOffsets: offsets,
      occupancy: (() => {
        const r = Math.random()
        if (r < 0.3) return 'sold_out'
        if (r < 0.6) return 'healthy'
        if (r < 0.85) return 'low'
        return 'empty'
      })(),
      publication_mode: 'immediate',
      pre_publish_visibility: 'hidden',
      publish_at_utc: null,
    })
  }

  // ----- 5 pase events (no fechas) -----
  for (let i = 0; i < 5; i++) {
    plans.push({
      idx: plans.length + 1,
      nombre: `DEMO_${pick(ADJECTIVES)}_${pick(NOUNS)}_${String(plans.length + 1).padStart(2, '0')}`,
      descripcion: `Pase de temporada con acceso ilimitado durante todo el ciclo.`,
      lugar: pick(VENUES),
      imagen_url: i % 2 === 0 ? null : `https://picsum.photos/seed/ev${plans.length}/400/400`,
      activo: Math.random() < 0.8 ? 1 : 0,
      modo_fecha: 'pase',
      fechaDaysOffsets: [], // pase → no fechas
      occupancy: (() => {
        const r = Math.random()
        if (r < 0.3) return 'sold_out'
        if (r < 0.6) return 'healthy'
        if (r < 0.85) return 'low'
        return 'empty'
      })(),
      publication_mode: 'immediate',
      pre_publish_visibility: 'hidden',
      publish_at_utc: null,
    })
  }

  return plans
}

// ---------------------------------------------------------------------------
// Category plans
// ---------------------------------------------------------------------------

type CategoriaPlan = {
  id: string
  nombre: string
  precio: number
  stock: number
  stock_disponible: number // updated as entradas are inserted
}

function buildCategorias(): CategoriaPlan[] {
  const numCats = rand(2, 4)
  const stockOptions = [50, 100, 200, 500, 1000]
  const cats: CategoriaPlan[] = []

  // Randomly pick names without repeating
  const shuffled = [...CATEGORY_NAMES].sort(() => Math.random() - 0.5).slice(0, numCats)

  // Tiered pricing: some events have steep pricing, some flat
  const basePrice = rand(5000, 20000)
  const isTiered = Math.random() > 0.5

  for (let i = 0; i < numCats; i++) {
    const multiplier = isTiered ? 1 + i * rand(1, 3) : 1
    const precio = Math.min(Math.round(basePrice * multiplier / 100) * 100, 50000)
    const stock = pick(stockOptions)
    cats.push({
      id: randomUUID(),
      nombre: shuffled[i],
      precio,
      stock,
      stock_disponible: stock,
    })
  }
  return cats
}

// ---------------------------------------------------------------------------
// Comprador pool — create a set of fake compradores once per empresa
// ---------------------------------------------------------------------------

type CompradorRecord = {
  id: string
  nombre: string
  email: string
}

function buildCompradorPool(empresaId: string, size: number): CompradorRecord[] {
  const pool: CompradorRecord[] = []
  for (let i = 0; i < size; i++) {
    const nombre = pick(FAKE_NOMBRES)
    const apellido = pick(FAKE_APELLIDOS)
    pool.push({
      id: randomUUID(),
      nombre: `${nombre} ${apellido}`,
      email: `demo+${i}@demoseed.internal`,
    })
  }
  return pool
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // 1. Idempotency check
  const [existingRows] = await pool.query<any[]>(
    `SELECT COUNT(*) as cnt FROM eventos WHERE nombre LIKE 'DEMO\\_%' ESCAPE '\\\\'`
  )
  const existing = Number((existingRows as any[])[0]?.cnt ?? 0)
  if (existing > 0) {
    console.log(`⚠️  Ya existen ${existing} eventos DEMO_. Saliendo sin modificar datos.`)
    console.log(`   Para limpiar, ejecutá las queries del header del script.`)
    process.exit(0)
  }

  // 2. Detect empresa
  const [empresaRows] = await pool.query<any[]>(
    `SELECT id FROM empresas LIMIT 1`
  )
  let empresaId: string

  if ((empresaRows as any[]).length === 0) {
    empresaId = randomUUID()
    await pool.query(
      `INSERT INTO empresas (id, nombre, slug, email, activa) VALUES (?, ?, ?, ?, true)`,
      [empresaId, 'DEMO_Empresa Test', 'demo-empresa-test', 'demo@demoseed.internal']
    )
    console.log(`✅ Creada empresa DEMO: ${empresaId}`)
  } else {
    empresaId = String((empresaRows as any[])[0].id)
    console.log(`ℹ️  Usando empresa existente: ${empresaId}`)
  }

  // 3. Ensure modo_fecha enum supports 'pase' (idempotent ALTER)
  // NOTE: MySQL MODIFY COLUMN syntax removed — Postgres enums are altered differently.
  // If the enum doesn't include 'pase', run manually:
  //   ALTER TYPE modo_fecha_enum ADD VALUE IF NOT EXISTS 'pase';
  // (or check that the Prisma migration already includes it)

  // 4. Build comprador pool (150 fake compradores shared across all events)
  const COMPRADOR_POOL_SIZE = 150
  const compradorPool = buildCompradorPool(empresaId, COMPRADOR_POOL_SIZE)

  // Insert compradores (ignore duplicates on re-run would conflict with email uniqueness, but
  // we exit early above so this is always fresh)
  for (const c of compradorPool) {
    await pool.query(
      `INSERT INTO compradores (id, empresa_id, nombre, email) VALUES (?, ?, ?, ?)`,
      [c.id, empresaId, c.nombre, c.email]
    )
  }
  console.log(`ℹ️  Insertados ${COMPRADOR_POOL_SIZE} compradores demo`)

  // 5. Plan events
  const plans = buildEventPlans()

  let totalEventos = 0
  let totalCategorias = 0
  let totalEntradas = 0

  // Occupancy bucket distribution tracking
  const dist: Record<string, number> = { sold_out: 0, healthy: 0, low: 0, empty: 0 }
  const modeDist: Record<string, number> = { unica: 0, multiple: 0, pase: 0 }

  for (const plan of plans) {
    const eventoId = randomUUID()
    const connection = await pool.getConnection()

    try {
      await connection.beginTransaction()

      // Insert evento
      await connection.query(
        `INSERT INTO eventos (
          id, empresa_id, nombre, descripcion, lugar, modo_fecha,
          imagen_url, activo,
          publication_mode, pre_publish_visibility, publish_at_utc, publish_timezone, published_live_at,
          venta_consumibles_habilitada, buyer_event_refunds_enabled
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, false, false)`,
        [
          eventoId,
          empresaId,
          plan.nombre,
          plan.descripcion,
          plan.lugar,
          plan.modo_fecha,
          plan.imagen_url,
          plan.activo,
          plan.publication_mode,
          plan.pre_publish_visibility,
          plan.publish_at_utc,
          'America/Argentina/Buenos_Aires',
          null,
        ]
      )

      // Insert fechas
      const fechaIds: Array<string | null> = []
      const firstFechaStr: string | null = plan.fechaDaysOffsets.length > 0
        ? dayOffset(plan.fechaDaysOffsets[0])
        : null

      for (const daysOffset of plan.fechaDaysOffsets) {
        const fechaId = randomUUID()
        const fechaStr = dayOffset(daysOffset)
        await connection.query(
          `INSERT INTO evento_fechas (id, evento_id, fecha) VALUES (?, ?, ?)`,
          [fechaId, eventoId, fechaStr]
        )
        fechaIds.push(fechaId)
      }

      // Insert categorias
      const categorias = buildCategorias()
      for (const cat of categorias) {
        await connection.query(
          `INSERT INTO entrada_categorias (id, evento_id, nombre, precio, stock, stock_disponible, activa)
           VALUES (?, ?, ?, ?, ?, ?, true)`,
          [cat.id, eventoId, cat.nombre, cat.precio, cat.stock, cat.stock_disponible]
        )
      }

      // Compute how many entradas to generate
      const capacidadTotal = categorias.reduce((s, c) => s + c.stock, 0)
      let targetSold: number
      switch (plan.occupancy) {
        case 'sold_out': targetSold = Math.floor(capacidadTotal * randFloat(0.9, 1.0)); break
        case 'healthy':  targetSold = Math.floor(capacidadTotal * randFloat(0.4, 0.7)); break
        case 'low':      targetSold = Math.floor(capacidadTotal * randFloat(0.05, 0.3)); break
        case 'empty':    targetSold = 0; break
      }

      // Cap at 5000 total across all events — enforce per-event max too
      const maxPerEvent = Math.min(targetSold, 400)
      let entradasInserted = 0

      for (let i = 0; i < maxPerEvent; i++) {
        // Pick a categoria that still has stock
        const availableCats = categorias.filter(c => c.stock_disponible > 0)
        if (availableCats.length === 0) break

        const cat = pick(availableCats)
        const comprador = pick(compradorPool)
        const fechaId = fechaIds.length > 0 ? pick(fechaIds) : null

        // Financial fields
        const precioPagado = cat.precio
        const comision = rand(200, 1500)
        const mpFee = Math.round(precioPagado * 0.045 * 100) / 100
        const netoEmpresa = Math.max(0, Math.round((precioPagado - comision - mpFee) * 100) / 100)

        // Estado distribution: 85% valida, 10% usada, 5% cancelada
        const estadoRoll = Math.random()
        const estado = estadoRoll < 0.85 ? 'valida' : estadoRoll < 0.95 ? 'usada' : 'cancelada'

        const createdAt = randomSaleDate(firstFechaStr)
        const entradaId = randomUUID()
        const qrCode = randomUUID()
        const claveCorta = makeClaveCorta() + rand(1000, 9999).toString()

        // Parse nombre/apellido from full name
        const [nombreComp, apellidoComp] = comprador.nombre.split(' ')

        await connection.query(
          `INSERT INTO entradas (
            id, evento_id, categoria_id, fecha_id, comprador_id,
            qr_code, clave_corta, estado,
            precio_pagado, comision, mp_fee_amount, neto_empresa_amount,
            nombre_comprador, apellido_comprador, dni_comprador,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            entradaId,
            eventoId,
            cat.id,
            fechaId,
            comprador.id,
            qrCode,
            claveCorta,
            estado,
            precioPagado,
            comision,
            mpFee,
            netoEmpresa,
            nombreComp ?? null,
            apellidoComp ?? null,
            String(rand(10000000, 99999999)),
            createdAt,
          ]
        )

        // Decrement stock_disponible only for non-cancelled
        if (estado !== 'cancelada') {
          await connection.query(
            `UPDATE entrada_categorias SET stock_disponible = stock_disponible - 1 WHERE id = ?`,
            [cat.id]
          )
          cat.stock_disponible -= 1
        }

        entradasInserted++
      }

      await connection.commit()

      totalEventos++
      totalCategorias += categorias.length
      totalEntradas += entradasInserted
      dist[plan.occupancy]++
      modeDist[plan.modo_fecha]++

      console.log(
        `[${plan.idx}/${TOTAL_EVENTS}] ✅ ${plan.nombre} | modo=${plan.modo_fecha} | cats=${categorias.length} | entradas=${entradasInserted} | ocupacion=${plan.occupancy}`
      )
    } catch (err) {
      await connection.rollback()
      console.error(`[${plan.idx}/${TOTAL_EVENTS}] ❌ ERROR en ${plan.nombre}:`, err)
    } finally {
      connection.release()
    }
  }

  console.log('\n========================================')
  console.log(`Seed completado:`)
  console.log(`  Eventos:    ${totalEventos}`)
  console.log(`  Categorías: ${totalCategorias}`)
  console.log(`  Entradas:   ${totalEntradas}`)
  console.log(`\nDistribución por modo_fecha:`)
  console.log(`  unica=${modeDist.unica}  multiple=${modeDist.multiple}  pase=${modeDist.pase}`)
  console.log(`\nDistribución por ocupación:`)
  console.log(`  sold_out=${dist.sold_out}  healthy=${dist.healthy}  low=${dist.low}  empty=${dist.empty}`)
  console.log('\nPróximo paso:')
  const today = new Date().toISOString().slice(0, 10)
  const from90 = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString().slice(0, 10)
  console.log(`  npm run backfill:velocity -- --from=${from90} --to=${today}`)
  console.log('========================================\n')
}

main()
  .catch((err) => {
    console.error('Fatal error:', err)
    process.exit(1)
  })
  .finally(() => {
    pool.end()
  })
