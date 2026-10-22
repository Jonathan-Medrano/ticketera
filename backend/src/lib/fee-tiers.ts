import { randomUUID as uuidv4 } from 'node:crypto'

import { prisma, prismaDirectUrl } from './prisma'
import { PLATFORM_FLOWS, getMarketplaceFeeSummariesByFlowBulk, type PlatformFlow } from './marketplace-fee'

/**
 * Motor de comisiones por volumen (fee tiers).
 *
 * Ver openspec/changes/fee-tiers-por-volumen/ para propuesta, spec y diseño.
 *
 * PRINCIPIO RECTOR: este módulo NO toca el camino del dinero.
 * Escribe en `empresa_marketplace_fee_overrides` y la cascada de resolución que
 * ya existe (`marketplace-fee.ts`) hace el resto. La comisión se congela en
 * `checkout_sessions` al crear la sesión, así que un cambio de tier NUNCA puede
 * alterar retroactivamente una venta ya cobrada.
 *
 * Si este motor tuviera un bug, el peor caso es un porcentaje mal escrito en una
 * tabla de configuración — nunca una venta corrompida.
 */

/** Ventana rolling para medir volumen. */
export const FEE_TIER_VENTANA_DIAS = 90

export type FeeTier = {
  id: string
  nombre: string
  min_entradas_90d: number
  pct_entradas: number
  pct_consumibles: number
  activo: boolean
  orden: number
}

export type FeeTierState = {
  empresa_id: string
  current_tier_id: string | null
  entradas_ventana: number
  evaluated_at: Date | null
  pending_downgrade_tier_id: string | null
  pending_desde: Date | null
  pinned: boolean
  pinned_por: string | null
  pinned_motivo: string | null
}

export type FeeTierEventOrigen = 'system' | 'admin'

export class FeeTierError extends Error {
  code: string
  status: number

  constructor(message: string, code: string, status = 400) {
    super(message)
    this.name = 'FeeTierError'
    this.code = code
    this.status = status
  }
}

function toNumber(value: unknown): number {
  return typeof value === 'number' ? value : Number(value ?? 0)
}

// ---------------------------------------------------------------------------
// Escalera
// ---------------------------------------------------------------------------

function mapTierRow(row: Record<string, unknown>): FeeTier {
  return {
    id: String(row.id),
    nombre: String(row.nombre),
    min_entradas_90d: toNumber(row.min_entradas_90d),
    pct_entradas: toNumber(row.pct_entradas),
    pct_consumibles: toNumber(row.pct_consumibles),
    activo: Boolean(row.activo),
    orden: toNumber(row.orden),
  }
}

/** Escalera completa, ordenada por umbral ascendente. */
export async function getTiers(): Promise<FeeTier[]> {
  const rows = await prisma.platformFeeTier.findMany({
    orderBy: { min_entradas_90d: 'asc' },
  })
  return rows.map((row) => mapTierRow(row as unknown as Record<string, unknown>))
}

/** Solo los tiers activos, ordenados por umbral ascendente. */
export async function getTiersActivos(): Promise<FeeTier[]> {
  const rows = await prisma.platformFeeTier.findMany({
    where: { activo: true },
    orderBy: { min_entradas_90d: 'asc' },
  })
  return rows.map((row) => mapTierRow(row as unknown as Record<string, unknown>))
}

export type ValidacionEscalera = {
  /** Problemas que impiden guardar (R1.3, R1.4, R1.5). */
  errores: string[]
  /** Configuraciones raras pero permitidas (R1.6). */
  advertencias: string[]
}

/**
 * Valida una escalera completa antes de persistirla.
 *
 * R1.3 umbral único entre activos · R1.4 tier base indeleble ·
 * R1.5 porcentajes en rango · R1.6 monotonía (solo advierte).
 */
export function validarEscalera(tiers: FeeTier[]): ValidacionEscalera {
  const errores: string[] = []
  const advertencias: string[] = []

  const activos = tiers
    .filter((t) => t.activo)
    .slice()
    .sort((a, b) => a.min_entradas_90d - b.min_entradas_90d)

  // R1.5 — rango y enteros
  for (const tier of tiers) {
    for (const [label, pct] of [
      ['entradas', tier.pct_entradas],
      ['consumibles', tier.pct_consumibles],
    ] as const) {
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
        errores.push(`El tier "${tier.nombre}" tiene un porcentaje de ${label} inválido (debe estar entre 0 y 100)`)
      }
    }
    if (!Number.isInteger(tier.min_entradas_90d) || tier.min_entradas_90d < 0) {
      errores.push(`El tier "${tier.nombre}" tiene un umbral inválido (debe ser un entero >= 0)`)
    }
  }

  // R1.3 — umbral único entre activos
  const vistos = new Map<number, string>()
  for (const tier of activos) {
    const previo = vistos.get(tier.min_entradas_90d)
    if (previo) {
      errores.push(
        `Los tiers "${previo}" y "${tier.nombre}" comparten el umbral ${tier.min_entradas_90d}. Cada tier activo debe tener un umbral distinto.`,
      )
    } else {
      vistos.set(tier.min_entradas_90d, tier.nombre)
    }
  }

  // R1.4 — tiene que existir un piso
  if (activos.length > 0 && !activos.some((t) => t.min_entradas_90d === 0)) {
    errores.push('La escalera necesita un tier base activo con umbral 0. Sin piso, las empresas sin volumen quedan sin comisión definida.')
  }

  // R1.6 — monotonía: más volumen debería costar menos, no más
  for (let i = 1; i < activos.length; i += 1) {
    const anterior = activos[i - 1]
    const actual = activos[i]
    if (actual.pct_entradas > anterior.pct_entradas || actual.pct_consumibles > anterior.pct_consumibles) {
      advertencias.push(
        `El tier "${actual.nombre}" (umbral ${actual.min_entradas_90d}) cobra MÁS que "${anterior.nombre}" (umbral ${anterior.min_entradas_90d}). Vender más saldría más caro.`,
      )
    }
  }

  return { errores, advertencias }
}

/**
 * Resuelve qué tier le corresponde a un volumen dado.
 * Función pura, sin I/O — el corazón testeable del motor.
 *
 * Devuelve el tier activo con el mayor umbral que el volumen alcanza,
 * o null si no hay escalera activa.
 */
export function resolverTier(volumen: number, tiersActivos: FeeTier[]): FeeTier | null {
  let elegido: FeeTier | null = null
  for (const tier of tiersActivos) {
    if (volumen >= tier.min_entradas_90d) {
      if (!elegido || tier.min_entradas_90d > elegido.min_entradas_90d) {
        elegido = tier
      }
    }
  }
  return elegido
}

/** Porcentaje que define un tier para un flow dado. */
export function pctDelTier(tier: FeeTier, flow: PlatformFlow): number {
  return flow === 'consumibles' ? tier.pct_consumibles : tier.pct_entradas
}

// ---------------------------------------------------------------------------
// Volumen
// ---------------------------------------------------------------------------

/**
 * Cuenta entradas online no canceladas por empresa en la ventana rolling (R2.1).
 *
 * - `medio_pago_presencial IS NULL` → solo venta online. El POS presencial no
 *   paga comisión, así que tampoco debe contar para bajarla.
 * - `estado <> 'cancelada'` → no premiar volumen que después se reembolsó.
 *
 * En CANTIDAD, nunca en ARS (R2.2): un umbral en pesos se autodesactualiza con
 * la inflación y en ~1 año todas las empresas serían "alto volumen".
 *
 * Una sola query agregada para todas las empresas, no una por empresa.
 */
export async function calcularVolumenPorEmpresa(): Promise<Map<string, number>> {
  const rows = await prismaDirectUrl.$queryRaw<{ empresa_id: string; entradas_ventana: number }[]>`
    SELECT e.empresa_id, COUNT(*)::int AS entradas_ventana
    FROM entradas en
    JOIN eventos e ON e.id = en.evento_id
    WHERE en.medio_pago_presencial IS NULL
      AND en.estado <> 'cancelada'
      AND en.created_at >= now() - (${FEE_TIER_VENTANA_DIAS} || ' days')::interval
    GROUP BY e.empresa_id
  `

  const volumenes = new Map<string, number>()
  for (const row of rows) {
    volumenes.set(String(row.empresa_id), toNumber(row.entradas_ventana))
  }
  return volumenes
}

/** Empresas elegibles para evaluación: activas y no de prueba (R2.4). */
export async function getEmpresasEvaluables(): Promise<{ id: string; nombre: string }[]> {
  const rows = await prismaDirectUrl.$queryRaw<{ id: string; nombre: string }[]>`
    SELECT id, nombre FROM empresas WHERE activa = TRUE AND es_prueba = FALSE
  `
  return rows.map((row) => ({ id: String(row.id), nombre: String(row.nombre) }))
}

// ---------------------------------------------------------------------------
// Estado por empresa
// ---------------------------------------------------------------------------

export async function getFeeTierState(empresaId: string): Promise<FeeTierState | null> {
  const row = await prisma.empresaFeeTierState.findUnique({ where: { empresa_id: empresaId } })
  if (!row) return null
  return {
    empresa_id: String(row.empresa_id),
    current_tier_id: row.current_tier_id ? String(row.current_tier_id) : null,
    entradas_ventana: toNumber(row.entradas_ventana),
    evaluated_at: row.evaluated_at ?? null,
    pending_downgrade_tier_id: row.pending_downgrade_tier_id ? String(row.pending_downgrade_tier_id) : null,
    pending_desde: row.pending_desde ?? null,
    pinned: Boolean(row.pinned),
    pinned_por: row.pinned_por ? String(row.pinned_por) : null,
    pinned_motivo: row.pinned_motivo ? String(row.pinned_motivo) : null,
  }
}

/** Comisión vigente por flow para un conjunto de empresas. */
export async function getPctVigentePorEmpresa(
  empresaIds: string[],
): Promise<Map<string, Record<PlatformFlow, number | null>>> {
  const summaries = await getMarketplaceFeeSummariesByFlowBulk(empresaIds)
  const result = new Map<string, Record<PlatformFlow, number | null>>()

  for (const empresaId of empresaIds) {
    const porFlow = summaries.get(empresaId)
    result.set(empresaId, {
      entradas: porFlow?.entradas?.percentage ?? null,
      consumibles: porFlow?.consumibles?.percentage ?? null,
    })
  }
  return result
}

// ---------------------------------------------------------------------------
// Decisión
// ---------------------------------------------------------------------------

export type DecisionTier =
  | { accion: 'sin_escalera' }
  | { accion: 'pinned'; tierCalculado: FeeTier | null }
  | { accion: 'ascenso'; tier: FeeTier }
  | { accion: 'descenso_pendiente'; tier: FeeTier }
  | { accion: 'sin_cambio'; tier: FeeTier }

/**
 * Decide qué hacer con una empresa. Función pura — todo el ratchet vive acá,
 * lo que la hace testeable sin base de datos.
 *
 * R3 ascenso automático · R4 descenso a cola · R5 pinned intocable.
 */
export function decidirAccion(params: {
  volumen: number
  tiersActivos: FeeTier[]
  pctVigente: Record<PlatformFlow, number | null>
  pinned: boolean
}): DecisionTier {
  const { volumen, tiersActivos, pctVigente, pinned } = params

  const tier = resolverTier(volumen, tiersActivos)

  if (pinned) {
    // R5.2 — comisión negociada a mano: no se toca en ninguna dirección.
    // Igual devolvemos el tier calculado para que el panel lo muestre (R5.3).
    return { accion: 'pinned', tierCalculado: tier }
  }

  if (!tier) {
    // Sin escalera activa el motor no hace nada. Es el estado en el que se
    // despliega la feature: código encendido, escalera apagada.
    return { accion: 'sin_escalera' }
  }

  // Si algún flow bajaría de precio, es un ascenso. Si alguno subiría (y
  // ninguno baja), es un descenso. La comparación se hace flow por flow porque
  // un tier define ambos porcentajes.
  let algunoBaja = false
  let algunoSube = false

  for (const flow of PLATFORM_FLOWS) {
    const vigente = pctVigente[flow]
    const nuevo = pctDelTier(tier, flow)
    if (vigente === null) {
      // Sin comisión resuelta previa: aplicar el tier es siempre correcto.
      algunoBaja = true
      continue
    }
    if (nuevo < vigente) algunoBaja = true
    if (nuevo > vigente) algunoSube = true
  }

  if (algunoBaja) return { accion: 'ascenso', tier }
  if (algunoSube) return { accion: 'descenso_pendiente', tier }
  return { accion: 'sin_cambio', tier }
}

// ---------------------------------------------------------------------------
// Aplicación
// ---------------------------------------------------------------------------

/**
 * Aplica un tier a una empresa: UPSERT del override + auditoría, en UNA
 * transacción.
 *
 * INVARIANTE: no puede existir un cambio de comisión sin su fila de auditoría.
 * Por eso van juntos y no en dos llamadas separadas.
 */
export async function aplicarTier(params: {
  empresaId: string
  tier: FeeTier
  entradasVentana: number
  origen: FeeTierEventOrigen
  aplicadoPor?: string | null
  pctVigente: Record<PlatformFlow, number | null>
  limpiarPending?: boolean
}): Promise<void> {
  const { empresaId, tier, entradasVentana, origen, aplicadoPor = null, pctVigente } = params

  await prismaDirectUrl.$transaction(async (tx) => {
    for (const flow of PLATFORM_FLOWS) {
      const pctNuevo = pctDelTier(tier, flow)
      const pctAnterior = pctVigente[flow]

      await tx.empresaMarketplaceFeeOverride.upsert({
        where: { empresa_id_flow: { empresa_id: empresaId, flow } },
        create: {
          id: uuidv4(),
          empresa_id: empresaId,
          flow,
          mode: 'percentage',
          percentage: pctNuevo,
          fixed_amount: null,
          updated_by_platform_admin_id: aplicadoPor,
        },
        update: {
          mode: 'percentage',
          percentage: pctNuevo,
          fixed_amount: null,
          updated_by_platform_admin_id: aplicadoPor,
        },
      })

      await tx.empresaFeeTierEvent.create({
        data: {
          id: uuidv4(),
          empresa_id: empresaId,
          flow,
          pct_anterior: pctAnterior,
          pct_nuevo: pctNuevo,
          tier_id: tier.id,
          tier_nombre: tier.nombre,
          entradas_ventana: entradasVentana,
          origen,
          aplicado_por: aplicadoPor,
        },
      })
    }

    await tx.empresaFeeTierState.upsert({
      where: { empresa_id: empresaId },
      create: {
        empresa_id: empresaId,
        current_tier_id: tier.id,
        entradas_ventana: entradasVentana,
        evaluated_at: new Date(),
        pending_downgrade_tier_id: null,
        pending_desde: null,
      },
      update: {
        current_tier_id: tier.id,
        entradas_ventana: entradasVentana,
        evaluated_at: new Date(),
        pending_downgrade_tier_id: null,
        pending_desde: null,
      },
    })
  })
}

/** Registra volumen y tier calculado sin tocar la comisión. */
export async function registrarEvaluacion(params: {
  empresaId: string
  entradasVentana: number
  currentTierId?: string | null
  pendingDowngradeTierId?: string | null
}): Promise<void> {
  const { empresaId, entradasVentana, currentTierId, pendingDowngradeTierId = null } = params

  const pendingDesde = pendingDowngradeTierId ? new Date() : null

  const existente = await prisma.empresaFeeTierState.findUnique({ where: { empresa_id: empresaId } })

  // Si ya había un pending hacia el MISMO tier, conservar la fecha original:
  // "días pendiente" en el panel debe medir desde que se detectó, no desde la
  // última corrida del job.
  const pendingDesdeFinal =
    existente?.pending_downgrade_tier_id === pendingDowngradeTierId && existente?.pending_desde
      ? existente.pending_desde
      : pendingDesde

  await prisma.empresaFeeTierState.upsert({
    where: { empresa_id: empresaId },
    create: {
      empresa_id: empresaId,
      current_tier_id: currentTierId ?? null,
      entradas_ventana: entradasVentana,
      evaluated_at: new Date(),
      pending_downgrade_tier_id: pendingDowngradeTierId,
      pending_desde: pendingDesdeFinal,
    },
    update: {
      ...(currentTierId === undefined ? {} : { current_tier_id: currentTierId }),
      entradas_ventana: entradasVentana,
      evaluated_at: new Date(),
      pending_downgrade_tier_id: pendingDowngradeTierId,
      pending_desde: pendingDesdeFinal,
    },
  })
}

/** Historial de cambios de comisión de una empresa (R7.3). */
export async function getHistorialFeeTier(empresaId: string, limit = 50) {
  return prisma.empresaFeeTierEvent.findMany({
    where: { empresa_id: empresaId },
    orderBy: { created_at: 'desc' },
    take: limit,
  })
}
