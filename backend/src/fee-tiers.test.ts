import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import { Prisma } from '@prisma/client'

import { prismaDirectUrl } from './lib/prisma'
import {
  aplicarTier,
  calcularVolumenPorEmpresa,
  decidirAccion,
  getFeeTierState,
  getHistorialFeeTier,
  registrarEvaluacion,
  resolverTier,
  validarEscalera,
  type FeeTier,
} from './lib/fee-tiers'

/**
 * Tests del motor de comisiones por volumen.
 * Ver openspec/changes/fee-tiers-por-volumen/specs/.
 */

const PREFIX = 'feetier-test'
const TEST_PASSWORD_HASH = '$2a$12$4xM3C8z4Y4G1NeM9eY5Q7uy3x2kB1gVY0j9mJQ0k3kE4dN1s4R6Ku'

function tier(over: Partial<FeeTier> & { nombre: string; min_entradas_90d: number }): FeeTier {
  return {
    id: `${PREFIX}-tier-${over.nombre}`,
    pct_entradas: 4,
    pct_consumibles: 3,
    activo: true,
    orden: 0,
    ...over,
  }
}

const BASE = tier({ nombre: 'Base', min_entradas_90d: 0, pct_entradas: 4, pct_consumibles: 3 })
const PRO = tier({ nombre: 'Pro', min_entradas_90d: 2000, pct_entradas: 3.5, pct_consumibles: 2.5 })
const ALTO = tier({ nombre: 'Alto', min_entradas_90d: 6000, pct_entradas: 3, pct_consumibles: 2 })
const ESCALERA = [BASE, PRO, ALTO]

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

async function seedEmpresa(id: string, opts: { activa?: boolean; esPrueba?: boolean } = {}) {
  const { activa = true, esPrueba = false } = opts
  await prismaDirectUrl.$executeRaw(Prisma.sql`
    INSERT INTO empresas (id, nombre, slug, email, password, admin_nombre, activa, es_prueba)
    VALUES (${id}, 'Empresa FeeTier', ${`${id}-slug`}, ${`${id}@example.com`},
            ${TEST_PASSWORD_HASH}, 'Admin', ${activa}, ${esPrueba})
  `)
}

async function seedEvento(eventoId: string, empresaId: string) {
  await prismaDirectUrl.$executeRaw(Prisma.sql`
    INSERT INTO eventos (id, empresa_id, nombre)
    VALUES (${eventoId}, ${empresaId}, 'Evento FeeTier')
  `)
}

async function seedCategoria(categoriaId: string, eventoId: string) {
  await prismaDirectUrl.$executeRaw(Prisma.sql`
    INSERT INTO entrada_categorias (id, evento_id, nombre)
    VALUES (${categoriaId}, ${eventoId}, 'General')
  `)
}

async function seedComprador(compradorId: string, empresaId: string) {
  await prismaDirectUrl.$executeRaw(Prisma.sql`
    INSERT INTO compradores (id, empresa_id, nombre, email)
    VALUES (${compradorId}, ${empresaId}, 'Comprador', ${`${compradorId}@example.com`})
  `)
}

/** Inserta N entradas con control fino de canal, estado y antigüedad. */
async function seedEntradas(params: {
  eventoId: string
  categoriaId: string
  compradorId: string
  cantidad: number
  estado?: string
  presencial?: boolean
  diasAtras?: number
  tag: string
}) {
  const { eventoId, categoriaId, compradorId, cantidad, estado = 'valida', presencial = false, diasAtras = 1, tag } = params

  for (let i = 0; i < cantidad; i += 1) {
    const id = `${PREFIX}-en-${tag}-${i}`
    await prismaDirectUrl.$executeRaw(Prisma.sql`
      INSERT INTO entradas (
        id, evento_id, categoria_id, comprador_id, qr_code, clave_corta,
        estado, precio_pagado, medio_pago_presencial, created_at
      ) VALUES (
        ${id}, ${eventoId}, ${categoriaId}, ${compradorId}, ${`${id}-qr`}, ${`${id}-cc`},
        ${estado}, 1000, ${presencial ? 'efectivo' : null},
        NOW() - (${diasAtras} || ' days')::interval
      )
    `)
  }
}

async function cleanup() {
  const like = `${PREFIX}-%`
  await prismaDirectUrl.$executeRaw(Prisma.sql`DELETE FROM empresa_fee_tier_events WHERE empresa_id LIKE ${like}`)
  await prismaDirectUrl.$executeRaw(Prisma.sql`DELETE FROM empresa_fee_tier_state WHERE empresa_id LIKE ${like}`)
  await prismaDirectUrl.$executeRaw(Prisma.sql`DELETE FROM empresa_marketplace_fee_overrides WHERE empresa_id LIKE ${like}`)
  await prismaDirectUrl.$executeRaw(Prisma.sql`DELETE FROM platform_messages WHERE target_empresa_id LIKE ${like}`)
  await prismaDirectUrl.$executeRaw(Prisma.sql`DELETE FROM entradas WHERE id LIKE ${like}`)
  await prismaDirectUrl.$executeRaw(Prisma.sql`DELETE FROM entrada_categorias WHERE id LIKE ${like}`)
  await prismaDirectUrl.$executeRaw(Prisma.sql`DELETE FROM eventos WHERE id LIKE ${like}`)
  await prismaDirectUrl.$executeRaw(Prisma.sql`DELETE FROM compradores WHERE id LIKE ${like}`)
  await prismaDirectUrl.$executeRaw(Prisma.sql`DELETE FROM empresas WHERE id LIKE ${like}`)
  await prismaDirectUrl.$executeRaw(Prisma.sql`DELETE FROM platform_fee_tiers WHERE id LIKE ${like}`)
}

beforeEach(cleanup)
after(cleanup)

// ---------------------------------------------------------------------------
// R2 — Cálculo del volumen
// ---------------------------------------------------------------------------

test('R2.1 — las ventas en puerta (POS presencial) NO cuentan para el volumen', async () => {
  const empresaId = `${PREFIX}-emp-puerta`
  await seedEmpresa(empresaId)
  await seedEvento(`${PREFIX}-ev-puerta`, empresaId)
  await seedCategoria(`${PREFIX}-cat-puerta`, `${PREFIX}-ev-puerta`)
  await seedComprador(`${PREFIX}-comp-puerta`, empresaId)

  const common = {
    eventoId: `${PREFIX}-ev-puerta`,
    categoriaId: `${PREFIX}-cat-puerta`,
    compradorId: `${PREFIX}-comp-puerta`,
  }
  await seedEntradas({ ...common, cantidad: 12, presencial: true, tag: 'pos' })
  await seedEntradas({ ...common, cantidad: 5, presencial: false, tag: 'online' })

  const volumenes = await calcularVolumenPorEmpresa()
  assert.equal(volumenes.get(empresaId), 5, 'solo deben contar las 5 ventas online')
})

test('R2.1 — las entradas canceladas (reembolsadas) NO cuentan', async () => {
  const empresaId = `${PREFIX}-emp-cancel`
  await seedEmpresa(empresaId)
  await seedEvento(`${PREFIX}-ev-cancel`, empresaId)
  await seedCategoria(`${PREFIX}-cat-cancel`, `${PREFIX}-ev-cancel`)
  await seedComprador(`${PREFIX}-comp-cancel`, empresaId)

  const common = {
    eventoId: `${PREFIX}-ev-cancel`,
    categoriaId: `${PREFIX}-cat-cancel`,
    compradorId: `${PREFIX}-comp-cancel`,
  }
  await seedEntradas({ ...common, cantidad: 7, estado: 'valida', tag: 'ok' })
  await seedEntradas({ ...common, cantidad: 2, estado: 'usada', tag: 'usada' })
  await seedEntradas({ ...common, cantidad: 4, estado: 'cancelada', tag: 'cancel' })

  const volumenes = await calcularVolumenPorEmpresa()
  assert.equal(volumenes.get(empresaId), 9, 'valida + usada cuentan; cancelada no')
})

test('R2.1 — la ventana de 90 días es móvil: lo viejo cae', async () => {
  const empresaId = `${PREFIX}-emp-ventana`
  await seedEmpresa(empresaId)
  await seedEvento(`${PREFIX}-ev-ventana`, empresaId)
  await seedCategoria(`${PREFIX}-cat-ventana`, `${PREFIX}-ev-ventana`)
  await seedComprador(`${PREFIX}-comp-ventana`, empresaId)

  const common = {
    eventoId: `${PREFIX}-ev-ventana`,
    categoriaId: `${PREFIX}-cat-ventana`,
    compradorId: `${PREFIX}-comp-ventana`,
  }
  await seedEntradas({ ...common, cantidad: 8, diasAtras: 120, tag: 'viejo' })
  await seedEntradas({ ...common, cantidad: 3, diasAtras: 10, tag: 'nuevo' })

  const volumenes = await calcularVolumenPorEmpresa()
  assert.equal(volumenes.get(empresaId), 3, 'solo las de los últimos 90 días')
})

// ---------------------------------------------------------------------------
// R1 — Validación de la escalera
// ---------------------------------------------------------------------------

test('R1.3 — dos tiers activos con el mismo umbral son inválidos', () => {
  const dup = tier({ nombre: 'Duplicado', min_entradas_90d: 2000, pct_entradas: 3.9, pct_consumibles: 2.9 })
  const { errores } = validarEscalera([BASE, PRO, dup])
  assert.ok(errores.some((e) => e.includes('umbral')), 'debe reportar el umbral duplicado')
})

test('R1.4 — una escalera activa sin tier base es inválida', () => {
  const { errores } = validarEscalera([PRO, ALTO])
  assert.ok(errores.some((e) => e.includes('umbral 0')), 'debe exigir un piso')
})

test('R1.5 — porcentajes fuera de rango son inválidos', () => {
  const malo = tier({ nombre: 'Malo', min_entradas_90d: 100, pct_entradas: 150, pct_consumibles: -3 })
  const { errores } = validarEscalera([BASE, malo])
  assert.equal(errores.filter((e) => e.includes('Malo')).length, 2)
})

test('R1.6 — vender más y pagar más se advierte, pero no se bloquea', () => {
  const invertido = tier({ nombre: 'Invertido', min_entradas_90d: 5000, pct_entradas: 9, pct_consumibles: 9 })
  const { errores, advertencias } = validarEscalera([BASE, invertido])
  assert.equal(errores.length, 0)
  assert.ok(advertencias.some((a) => a.includes('MÁS')), 'debe advertir la no-monotonía')
})

test('R1 — la escalera semilla es válida y sin advertencias', () => {
  const { errores, advertencias } = validarEscalera(ESCALERA)
  assert.deepEqual(errores, [])
  assert.deepEqual(advertencias, [])
})

// ---------------------------------------------------------------------------
// Resolución de tier (función pura)
// ---------------------------------------------------------------------------

test('resolverTier — elige el mayor umbral alcanzado', () => {
  assert.equal(resolverTier(0, ESCALERA)?.nombre, 'Base')
  assert.equal(resolverTier(1999, ESCALERA)?.nombre, 'Base')
  assert.equal(resolverTier(2000, ESCALERA)?.nombre, 'Pro', 'el umbral es inclusivo')
  assert.equal(resolverTier(5999, ESCALERA)?.nombre, 'Pro')
  assert.equal(resolverTier(6000, ESCALERA)?.nombre, 'Alto')
  assert.equal(resolverTier(999999, ESCALERA)?.nombre, 'Alto')
})

test('resolverTier — sin escalera activa devuelve null', () => {
  assert.equal(resolverTier(50000, []), null)
})

// ---------------------------------------------------------------------------
// R3 / R4 — El ratchet
// ---------------------------------------------------------------------------

test('R3.1 — si la comisión baja, es ascenso (se aplica solo)', () => {
  const d = decidirAccion({
    volumen: 2400,
    tiersActivos: ESCALERA,
    pctVigente: { entradas: 4, consumibles: 3 },
    pinned: false,
  })
  assert.equal(d.accion, 'ascenso')
  assert.equal(d.accion === 'ascenso' && d.tier.nombre, 'Pro')
})

test('R4.1 — si la comisión sube, NO se aplica: queda pendiente', () => {
  const d = decidirAccion({
    volumen: 800,
    tiersActivos: ESCALERA,
    pctVigente: { entradas: 3.5, consumibles: 2.5 },
    pinned: false,
  })
  assert.equal(d.accion, 'descenso_pendiente', 'nunca se sube la comisión sin aprobación humana')
  assert.equal(d.accion === 'descenso_pendiente' && d.tier.nombre, 'Base')
})

test('R4.5 — si el volumen coincide con la comisión vigente, no hay cambio', () => {
  const d = decidirAccion({
    volumen: 2400,
    tiersActivos: ESCALERA,
    pctVigente: { entradas: 3.5, consumibles: 2.5 },
    pinned: false,
  })
  assert.equal(d.accion, 'sin_cambio')
})

test('sin escalera activa el motor no propone nada', () => {
  const d = decidirAccion({
    volumen: 999999,
    tiersActivos: [],
    pctVigente: { entradas: 4, consumibles: 3 },
    pinned: false,
  })
  assert.equal(d.accion, 'sin_escalera', 'el código se despliega apagado')
})

// ---------------------------------------------------------------------------
// R5 — pinned
// ---------------------------------------------------------------------------

test('R5.2 — una empresa pinned no se toca ni para bajar ni para subir', () => {
  const bajaria = decidirAccion({
    volumen: 9000,
    tiersActivos: ESCALERA,
    pctVigente: { entradas: 2, consumibles: 1.5 },
    pinned: true,
  })
  assert.equal(bajaria.accion, 'pinned')

  const subiria = decidirAccion({
    volumen: 10,
    tiersActivos: ESCALERA,
    pctVigente: { entradas: 2, consumibles: 1.5 },
    pinned: true,
  })
  assert.equal(subiria.accion, 'pinned')
})

test('R5.3 — pinned igual expone el tier que le correspondería', () => {
  const d = decidirAccion({
    volumen: 7000,
    tiersActivos: ESCALERA,
    pctVigente: { entradas: 2, consumibles: 1.5 },
    pinned: true,
  })
  assert.equal(d.accion === 'pinned' && d.tierCalculado?.nombre, 'Alto')
})

// ---------------------------------------------------------------------------
// R7 — Auditoría (invariante transaccional)
// ---------------------------------------------------------------------------

test('R7.1 — no puede existir un cambio de comisión sin su fila de auditoría', async () => {
  const empresaId = `${PREFIX}-emp-audit`
  await seedEmpresa(empresaId)

  await aplicarTier({
    empresaId,
    tier: PRO,
    entradasVentana: 2400,
    origen: 'system',
    aplicadoPor: null,
    pctVigente: { entradas: 4, consumibles: 3 },
  })

  const overrides = await prismaDirectUrl.$queryRaw<{ flow: string; percentage: string }[]>(Prisma.sql`
    SELECT flow, percentage FROM empresa_marketplace_fee_overrides WHERE empresa_id = ${empresaId} ORDER BY flow
  `)
  assert.equal(overrides.length, 2, 'se escriben ambos flows')
  assert.equal(Number(overrides.find((o) => o.flow === 'entradas')?.percentage), 3.5)
  assert.equal(Number(overrides.find((o) => o.flow === 'consumibles')?.percentage), 2.5)

  const historial = await getHistorialFeeTier(empresaId)
  assert.equal(historial.length, 2, 'una fila de auditoría por flow')
  for (const evento of historial) {
    assert.equal(evento.origen, 'system')
    assert.equal(evento.entradas_ventana, 2400, 'el conteo que motivó la decisión queda registrado')
    assert.equal(evento.tier_nombre, 'Pro')
  }

  const state = await getFeeTierState(empresaId)
  assert.equal(state?.current_tier_id, PRO.id)
  assert.equal(state?.pending_downgrade_tier_id, null)
})

test('R4.2 — un descenso pendiente NO escribe override, solo marca el state', async () => {
  const empresaId = `${PREFIX}-emp-pending`
  await seedEmpresa(empresaId)

  await registrarEvaluacion({
    empresaId,
    entradasVentana: 300,
    pendingDowngradeTierId: BASE.id,
  })

  const overrides = await prismaDirectUrl.$queryRaw<{ n: number }[]>(Prisma.sql`
    SELECT COUNT(*)::int AS n FROM empresa_marketplace_fee_overrides WHERE empresa_id = ${empresaId}
  `)
  assert.equal(overrides[0].n, 0, 'la comisión no se tocó')

  const eventos = await getHistorialFeeTier(empresaId)
  assert.equal(eventos.length, 0, 'no hubo cambio, no hay auditoría de cambio')

  const state = await getFeeTierState(empresaId)
  assert.equal(state?.pending_downgrade_tier_id, BASE.id)
  assert.ok(state?.pending_desde, 'se registra desde cuándo está pendiente')
})

// ---------------------------------------------------------------------------
// R3.5 — No retroactividad. LA propiedad de la que cuelga todo lo demás.
// ---------------------------------------------------------------------------

test('R3.5 — cambiar el tier NO altera la comisión de entradas ya vendidas', async () => {
  const empresaId = `${PREFIX}-emp-retro`
  await seedEmpresa(empresaId)
  await seedEvento(`${PREFIX}-ev-retro`, empresaId)
  await seedCategoria(`${PREFIX}-cat-retro`, `${PREFIX}-ev-retro`)
  await seedComprador(`${PREFIX}-comp-retro`, empresaId)

  // Una venta cobrada al 4%: la comisión quedó congelada en la fila.
  await prismaDirectUrl.$executeRaw(Prisma.sql`
    INSERT INTO entradas (
      id, evento_id, categoria_id, comprador_id, qr_code, clave_corta,
      estado, precio_pagado, comision, medio_pago_presencial, created_at
    ) VALUES (
      ${`${PREFIX}-en-retro-1`}, ${`${PREFIX}-ev-retro`}, ${`${PREFIX}-cat-retro`},
      ${`${PREFIX}-comp-retro`}, ${`${PREFIX}-en-retro-1-qr`}, ${`${PREFIX}-en-retro-1-cc`},
      'valida', 10000, 400, NULL, NOW() - interval '2 days'
    )
  `)

  const antes = await prismaDirectUrl.$queryRaw<{ comision: string; precio_pagado: string }[]>(Prisma.sql`
    SELECT comision, precio_pagado FROM entradas WHERE id = ${`${PREFIX}-en-retro-1`}
  `)
  assert.equal(Number(antes[0].comision), 400)

  // La empresa asciende a Pro (3,5%).
  await aplicarTier({
    empresaId,
    tier: PRO,
    entradasVentana: 2500,
    origen: 'system',
    aplicadoPor: null,
    pctVigente: { entradas: 4, consumibles: 3 },
  })

  const despues = await prismaDirectUrl.$queryRaw<{ comision: string; precio_pagado: string }[]>(Prisma.sql`
    SELECT comision, precio_pagado FROM entradas WHERE id = ${`${PREFIX}-en-retro-1`}
  `)

  assert.equal(
    Number(despues[0].comision),
    400,
    'la comisión de una venta ya cobrada NUNCA puede cambiar por un cambio de tier',
  )
  assert.equal(Number(despues[0].precio_pagado), 10000, 'el precio pagado tampoco se toca')

  // Y el override sí quedó actualizado para las ventas FUTURAS.
  const override = await prismaDirectUrl.$queryRaw<{ percentage: string }[]>(Prisma.sql`
    SELECT percentage FROM empresa_marketplace_fee_overrides
    WHERE empresa_id = ${empresaId} AND flow = 'entradas'
  `)
  assert.equal(Number(override[0].percentage), 3.5, 'las ventas nuevas sí usan la comisión nueva')
})

test('R4.2 — "pendiente desde" no se reinicia en cada corrida del job', async () => {
  const empresaId = `${PREFIX}-emp-desde`
  await seedEmpresa(empresaId)

  await registrarEvaluacion({ empresaId, entradasVentana: 300, pendingDowngradeTierId: BASE.id })
  const primera = (await getFeeTierState(empresaId))?.pending_desde

  await registrarEvaluacion({ empresaId, entradasVentana: 280, pendingDowngradeTierId: BASE.id })
  const segunda = (await getFeeTierState(empresaId))?.pending_desde

  assert.deepEqual(segunda, primera, 'los días pendiente se miden desde la detección')
})
