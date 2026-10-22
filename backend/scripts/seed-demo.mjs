/**
 * seed-demo.mjs
 * =====================================================================
 * Crea (o reutiliza) una CUENTA DEMO completa para que los bots de auditoria
 * (ticketera-ux-audit) y los testers puedan loguear y navegar el sistema vivo
 * SIN tocar produccion. Pensado para correrse contra una DB local o el
 * contenedor de test (ticketera_test).
 *
 * Marca de lo demo (ver lib/demo-seed-shared.mjs):
 *   - empresa.es_prueba = true  (flag REAL, ya en el schema, ya indexado)
 *   - email en dominio dedicado @demo.ticketera.test  (sufijo exacto para cleanup)
 *
 * La empresa demo queda:
 *   - AUTO-APROBADA (aprobada=true) — sin pasar por el superadmin.
 *   - email_verificado=true, activa=true, consumibles + POS movil habilitados.
 *   - Login como EMPRESA (admin): email + password directos sobre `empresas`.
 *     El empresa-admin tiene TODOS los permisos (authz.ts: requirePermission
 *     devuelve true para userType !== 'empleado'), asi que un solo login cubre
 *     el dashboard, el POS de entradas y el POS de barra.
 *
 * Datos navegables minimos (clave: cubren la ASIMETRIA entre los dos POS):
 *   - 1 evento activo con flyer + 1 fecha futura.
 *   - 3 categorias de entrada: General (stock), VIP (stock), Early Bird (AGOTADA)
 *     -> da material al POS de ENTRADAS (incluido el estado agotado).
 *   - 1 barra activa + 6 consumibles + barra_stock (1 ilimitado, 1 agotado)
 *     -> da material al POS de BARRA.
 *   - 1 comprador demo + algunas entradas 'valida' vendidas, para que el
 *     dashboard / KPIs no esten vacios.
 *
 * IDEMPOTENTE: busca por clave natural (slug / nombre) antes de insertar;
 * correrlo dos veces no duplica.
 *
 * GUARDIA: se niega a correr si la DB destino no es local/test (default-deny),
 * salvo override consciente TICKETERA_ALLOW_PROD=1.
 *
 *   Uso:
 *     npm run test:postgres:up                 # levanta el contenedor de test
 *     npm run seed:demo -- --test-db           # seedea en ticketera_test
 *   o, si el .env ya apunta a una DB local/test:
 *     npm run seed:demo
 * =====================================================================
 */

import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import bcrypt from 'bcryptjs'
import {
  DEMO_EMPRESA_SLUG,
  DEMO_EMPRESA_EMAIL,
  DEMO_EMPRESA_PASSWORD,
  DEMO_COMPRADOR_EMAIL,
  bootstrapDemoPrisma,
} from './lib/demo-seed-shared.mjs'

const { prisma, source } = bootstrapDemoPrisma()

const EVENTO_NOMBRE = '[DEMO] Noche TICKETERA'
const BARRA_NOMBRE = 'Barra Principal'

// Imagenes Unsplash (mismas usadas por los seeds de empresaprueba — links estables).
const IMG_FLYER     = 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=1200&q=80'
const IMG_GENERAL   = 'https://images.unsplash.com/photo-1429962714451-bb934ecdc4ec?w=400&q=80'
const IMG_VIP       = 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=400&q=80'
const IMG_EARLYBIRD = 'https://images.unsplash.com/photo-1459749411175-04bf5292ceea?w=400&q=80'
const IMG_FERNET    = 'https://images.unsplash.com/photo-1551538827-9c037cb4f32a?w=400&q=80'
const IMG_CERVEZA   = 'https://images.unsplash.com/photo-1608270586620-248524c67de9?w=400&q=80'
const IMG_GINTONIC  = 'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?w=400&q=80'

// nombre, precio, stock, imagen_url
const CATEGORIAS = [
  { nombre: 'General',    precio: 8000,  stock: 100, imagen_url: IMG_GENERAL },
  { nombre: 'VIP',        precio: 15000, stock: 30,  imagen_url: IMG_VIP },
  { nombre: 'Early Bird', precio: 6000,  stock: 0,   imagen_url: IMG_EARLYBIRD }, // AGOTADA
]

// nombre, precio, imagen_url (null = sin foto -> prueba fallback), ilimitado, agotado
const CONSUMIBLES = [
  { nombre: 'Fernet con Coca', precio: 6000, imagen_url: IMG_FERNET,   ilimitado: false, agotado: false },
  { nombre: 'Cerveza Quilmes', precio: 4500, imagen_url: IMG_CERVEZA,  ilimitado: false, agotado: false },
  { nombre: 'Gin Tonic',       precio: 8000, imagen_url: IMG_GINTONIC, ilimitado: false, agotado: false },
  { nombre: 'Vodka',           precio: 7000, imagen_url: null,         ilimitado: false, agotado: false },
  { nombre: 'Red Bull',        precio: 5000, imagen_url: null,         ilimitado: true,  agotado: false },
  { nombre: 'Agua sin gas',    precio: 2500, imagen_url: null,         ilimitado: false, agotado: true  }, // kill-switch agotado
]

/** 6-char alfanumerico para clave_corta (UNIQUE). */
function makeClaveCorta() {
  return randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase()
}

async function main() {
  const now = new Date()
  console.log(`[seed-demo] destino: ${source}`)

  // 1) EMPRESA -----------------------------------------------------------
  let empresa = await prisma.empresa.findUnique({ where: { slug: DEMO_EMPRESA_SLUG } })
  const hashed = await bcrypt.hash(DEMO_EMPRESA_PASSWORD, 12)

  const empresaData = {
    nombre: '[DEMO] TICKETERA',
    email: DEMO_EMPRESA_EMAIL,
    password: hashed,
    admin_nombre: 'Demo',
    admin_apellido: 'TICKETERA',
    activa: true,
    es_prueba: true,            // <-- marca primaria
    aprobada: true,             // <-- auto-aprobada, no pasa por el superadmin
    aprobada_at: empresa?.aprobada_at ?? now,
    email_verificado: true,
    email_verificado_at: empresa?.email_verificado_at ?? now,
    consumibles_habilitado: true,
    pos_movil_habilitado: true, // gate del POS de entradas
    suspendido: false,
    tenant_public_disabled: false,
    color_primario: '#0052cc',
  }

  if (!empresa) {
    empresa = await prisma.empresa.create({
      data: { id: randomUUID(), slug: DEMO_EMPRESA_SLUG, ...empresaData },
    })
    console.log(`[empresa]  CREADA  id=${empresa.id} slug=${DEMO_EMPRESA_SLUG}`)
  } else {
    empresa = await prisma.empresa.update({ where: { id: empresa.id }, data: empresaData })
    console.log(`[empresa]  REUSADA id=${empresa.id} slug=${DEMO_EMPRESA_SLUG} (password reseteada)`)
  }
  const empresaId = empresa.id

  // 2) COMPRADOR demo ----------------------------------------------------
  let comprador = await prisma.comprador.findFirst({
    where: { empresa_id: empresaId, email: DEMO_COMPRADOR_EMAIL },
  })
  if (!comprador) {
    comprador = await prisma.comprador.create({
      data: {
        id: randomUUID(),
        empresa_id: empresaId,
        nombre: 'Comprador',
        apellido: 'Demo',
        email: DEMO_COMPRADOR_EMAIL,
        dni: '30111222',
        password: hashed, // misma password de prueba, por si se quiere loguear como comprador
        activo: true,
      },
    })
    console.log(`[comprador] CREADO id=${comprador.id} ${DEMO_COMPRADOR_EMAIL}`)
  } else {
    console.log(`[comprador] REUSADO id=${comprador.id} ${DEMO_COMPRADOR_EMAIL}`)
  }
  const compradorId = comprador.id

  // 3) EVENTO ------------------------------------------------------------
  let evento = await prisma.evento.findFirst({
    where: { empresa_id: empresaId, nombre: EVENTO_NOMBRE },
  })
  if (!evento) {
    evento = await prisma.evento.create({
      data: {
        id: randomUUID(),
        empresa_id: empresaId,
        nombre: EVENTO_NOMBRE,
        descripcion: 'Evento demo para auditar dashboard, POS de entradas y POS de barra.',
        lugar: 'Club Demo TICKETERA',
        modo_fecha: 'unica',
        imagen_url: IMG_FLYER,
        activo: true,
        venta_consumibles_habilitada: true,
        publication_mode: 'immediate',
        pre_publish_visibility: 'hidden',
        publish_timezone: 'America/Argentina/Buenos_Aires',
      },
    })
    const fecha = new Date(now.getTime() + 30 * 24 * 3600 * 1000) // ~30 dias futuro
    await prisma.eventoFecha.create({ data: { id: randomUUID(), evento_id: evento.id, fecha } })
    console.log(`[evento]   CREADO  id=${evento.id} "${EVENTO_NOMBRE}" (flyer + 1 fecha futura)`)
  } else {
    evento = await prisma.evento.update({
      where: { id: evento.id },
      data: { activo: true, imagen_url: IMG_FLYER, venta_consumibles_habilitada: true },
    })
    const tieneFecha = await prisma.eventoFecha.findFirst({ where: { evento_id: evento.id } })
    if (!tieneFecha) {
      const fecha = new Date(now.getTime() + 30 * 24 * 3600 * 1000)
      await prisma.eventoFecha.create({ data: { id: randomUUID(), evento_id: evento.id, fecha } })
    }
    console.log(`[evento]   REUSADO id=${evento.id} "${EVENTO_NOMBRE}"`)
  }
  const eventoId = evento.id

  // 4) CATEGORIAS DE ENTRADA --------------------------------------------
  const categoriaIds = {}
  for (const c of CATEGORIAS) {
    const existing = await prisma.entradaCategoria.findFirst({
      where: { evento_id: eventoId, nombre: c.nombre },
    })
    if (!existing) {
      const created = await prisma.entradaCategoria.create({
        data: {
          id: randomUUID(),
          evento_id: eventoId,
          nombre: c.nombre,
          imagen_url: c.imagen_url,
          precio: c.precio,
          stock: c.stock,
          stock_disponible: c.stock,
          activa: true,
          entradas_por_unidad: 1,
        },
      })
      categoriaIds[c.nombre] = created.id
    } else {
      await prisma.entradaCategoria.update({
        where: { id: existing.id },
        data: { imagen_url: c.imagen_url, precio: c.precio, stock: c.stock, stock_disponible: c.stock, activa: true },
      })
      categoriaIds[c.nombre] = existing.id
    }
    const estado = c.stock === 0 ? ' [AGOTADA]' : ''
    console.log(`  [categoria] ${c.nombre.padEnd(12)} $${c.precio} stock=${c.stock}${estado}`)
  }

  // 5) ENTRADAS de muestra (solo si el evento no tiene ninguna) ----------
  const yaHayEntradas = await prisma.entrada.count({ where: { evento_id: eventoId } })
  if (yaHayEntradas === 0) {
    const muestras = [
      { cat: 'General', precio: 8000,  n: 8 },
      { cat: 'VIP',     precio: 15000, n: 4 },
    ]
    let creadas = 0
    for (const m of muestras) {
      const catId = categoriaIds[m.cat]
      if (!catId) continue
      for (let i = 0; i < m.n; i++) {
        await prisma.entrada.create({
          data: {
            id: randomUUID(),
            evento_id: eventoId,
            categoria_id: catId,
            comprador_id: compradorId,
            qr_code: randomUUID(),
            clave_corta: `${makeClaveCorta()}${String(creadas).padStart(2, '0')}`,
            estado: 'valida',
            precio_pagado: m.precio,
            nombre_comprador: 'Comprador',
            apellido_comprador: 'Demo',
            dni_comprador: '30111222',
          },
        })
        // Descontar stock_disponible para que el numero cierre con lo vendido.
        await prisma.entradaCategoria.update({
          where: { id: catId },
          data: { stock_disponible: { decrement: 1 } },
        })
        creadas++
      }
    }
    console.log(`  [entradas]  ${creadas} entradas 'valida' de muestra (stock_disponible descontado)`)
  } else {
    console.log(`  [entradas]  ${yaHayEntradas} ya existian — no se generan nuevas (idempotente)`)
  }

  // 6) BARRA -------------------------------------------------------------
  let barra = await prisma.barra.findFirst({
    where: { empresa_id: empresaId, evento_id: eventoId, nombre: BARRA_NOMBRE },
  })
  if (!barra) {
    barra = await prisma.barra.create({
      data: { id: randomUUID(), evento_id: eventoId, empresa_id: empresaId, nombre: BARRA_NOMBRE, activa: true },
    })
    console.log(`[barra]    CREADA  id=${barra.id} "${BARRA_NOMBRE}"`)
  } else {
    barra = await prisma.barra.update({ where: { id: barra.id }, data: { activa: true, archived_at: null } })
    console.log(`[barra]    REUSADA id=${barra.id} "${BARRA_NOMBRE}"`)
  }
  const barraId = barra.id

  // 7) CONSUMIBLES + BARRA_STOCK ----------------------------------------
  for (const c of CONSUMIBLES) {
    let consumible = await prisma.consumible.findFirst({
      where: { empresa_id: empresaId, nombre: c.nombre },
    })
    if (!consumible) {
      consumible = await prisma.consumible.create({
        data: { id: randomUUID(), empresa_id: empresaId, nombre: c.nombre, precio: c.precio, imagen_url: c.imagen_url, activo: true },
      })
    } else {
      consumible = await prisma.consumible.update({
        where: { id: consumible.id },
        data: { precio: c.precio, imagen_url: c.imagen_url, activo: true, archived_at: null },
      })
    }

    const existing = await prisma.barraStock.findUnique({
      where: { barra_id_consumible_id: { barra_id: barraId, consumible_id: consumible.id } },
    })
    const stockData = {
      stock_inicial: 50,
      stock_actual: c.agotado ? 0 : 50,
      activo: true,
      stock_ilimitado: c.ilimitado,
      agotado: c.agotado,
    }
    if (!existing) {
      await prisma.barraStock.create({
        data: { id: randomUUID(), barra_id: barraId, consumible_id: consumible.id, ...stockData },
      })
    } else {
      await prisma.barraStock.update({ where: { id: existing.id }, data: stockData })
    }
    const foto = c.imagen_url ? 'con foto' : 'sin foto'
    const tag = c.ilimitado ? ' [ILIMITADO]' : c.agotado ? ' [AGOTADO]' : ''
    console.log(`  [consumible] ${c.nombre.padEnd(18)} $${c.precio} ${foto} stock=${stockData.stock_actual}${tag}`)
  }

  console.log('\n========================================')
  console.log('SEED DEMO OK')
  console.log(`  Empresa  : [DEMO] TICKETERA (slug=${DEMO_EMPRESA_SLUG}, id=${empresaId})`)
  console.log(`  Login    : ${DEMO_EMPRESA_EMAIL}  /  ${DEMO_EMPRESA_PASSWORD}`)
  console.log(`  Evento   : "${EVENTO_NOMBRE}"  |  Barra: "${BARRA_NOMBRE}"`)
  console.log(`  Entradas : General $8.000/100, VIP $15.000/30, Early Bird $6.000/0 (agotada)`)
  console.log(`  Barra    : 6 consumibles (1 ilimitado, 1 agotado, 3 con foto)`)
  console.log(`  Cleanup  : npm run seed:demo:clean ${source === 'test-container' ? '-- --test-db' : ''}`)
  console.log('========================================\n')
}

main()
  .catch((e) => {
    console.error('FATAL:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
