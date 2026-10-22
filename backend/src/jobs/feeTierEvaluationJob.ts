import { randomUUID as uuidv4 } from 'node:crypto'

import { prisma, prismaDirectUrl } from '../lib/prisma'
import { logServerError, logServerInfo } from '../lib/safe-log'
import {
  aplicarTier,
  calcularVolumenPorEmpresa,
  decidirAccion,
  getEmpresasEvaluables,
  getFeeTierState,
  getPctVigentePorEmpresa,
  getTiersActivos,
  pctDelTier,
  registrarEvaluacion,
} from '../lib/fee-tiers'

/**
 * Job de evaluación de comisiones por volumen.
 *
 * Ver openspec/changes/fee-tiers-por-volumen/.
 *
 * RATCHET (R3/R4): el ascenso (comisión baja) se aplica solo; el descenso
 * (comisión sube) NO — queda en cola de aprobación en super-admin.
 * Bajarle la comisión a alguien no requiere su consentimiento; subírsela sí.
 */

export const FEE_TIER_EVALUATION_INTERVAL_MS = 24 * 60 * 60 * 1000 // diario

// Advisory lock key — registro en CLAUDE.md:
//   4242 delivery-retry · 7701 carrito abandonado · 8823 checkoutCleanup
//   9001 platform-governance · 9002 platform-profit-sharing
//   9003 fee-tier-evaluation  ← este
const FEE_TIER_EVALUATION_LOCK_KEY = 9003

const JOB_STATE_KEY = Symbol.for('platea.backend.feeTierEvaluationJob')

let feeTierEvaluationRunning = false

type JobTimer = ReturnType<typeof setInterval>
type JobState = { timer: JobTimer | null }

function getJobState(): JobState {
  const scope = globalThis as typeof globalThis & { [JOB_STATE_KEY]?: JobState }
  if (!scope[JOB_STATE_KEY]) {
    scope[JOB_STATE_KEY] = { timer: null }
  }
  return scope[JOB_STATE_KEY]
}

export function shouldStartFeeTierEvaluationJob(env: NodeJS.ProcessEnv = process.env) {
  // Opt-out explícito — permite apagar el motor en Fly sin deploy de código (R6.4).
  if (env.FEE_TIER_EVALUATION_ENABLED === '0') {
    return false
  }

  if (env.NODE_ENV === 'test' && env.FEE_TIER_EVALUATION_ENABLE_IN_TESTS !== '1') {
    return false
  }

  if (env.BACKEND_MIGRATION_MODE === '1' || env.MIGRATION_RUNNING === '1') {
    return false
  }

  return true
}

export type FeeTierRunResult = {
  evaluadas: number
  ascensos: number
  descensosPendientes: number
  pinnedOmitidas: number
  sinCambio: number
  errores: number
  durationMs: number
}

const EMPTY_RESULT: FeeTierRunResult = {
  evaluadas: 0,
  ascensos: 0,
  descensosPendientes: 0,
  pinnedOmitidas: 0,
  sinCambio: 0,
  errores: 0,
  durationMs: 0,
}

/**
 * Avisa a la empresa que su comisión bajó (R3.4).
 * Reutiliza `platform_messages` — no hace falta email para un evento tan poco
 * frecuente, y evita acoplar el motor a Resend.
 */
async function notificarAscenso(params: {
  empresaId: string
  tierNombre: string
  pctEntradas: number
  pctConsumibles: number
}): Promise<void> {
  const { empresaId, tierNombre, pctEntradas, pctConsumibles } = params

  const fmt = (n: number) => n.toFixed(2).replace('.', ',')

  await prisma.platformMessage.create({
    data: {
      id: uuidv4(),
      titulo: `Bajamos tu comisión: ahora estás en ${tierNombre}`,
      cuerpo:
        `Por tu volumen de ventas de los últimos 90 días pasaste al nivel ${tierNombre}. ` +
        `Desde ahora pagás ${fmt(pctEntradas)}% sobre entradas vendidas online y ` +
        `${fmt(pctConsumibles)}% sobre consumibles vendidos online. ` +
        `Lo que cobrás en la puerta o en la barra sigue sin comisión. ` +
        `El cambio aplica a las ventas nuevas; las ya cobradas mantienen su comisión original.`,
      tipo: 'info',
      target_type: 'empresa',
      target_empresa_id: empresaId,
      activo: true,
      created_by: 'system:fee-tier-job',
    },
  })
}

export async function runFeeTierEvaluationJob(): Promise<FeeTierRunResult> {
  if (feeTierEvaluationRunning) {
    return EMPTY_RESULT
  }

  feeTierEvaluationRunning = true
  const startedAt = Date.now()

  // pg_try_advisory_lock — no bloqueante, false si otra instancia lo tiene.
  // prismaDirectUrl (puerto 5432) porque los advisory locks son session-scoped
  // y PgBouncer en modo transacción los perdería (R6.2, R6.3).
  let lockResult: { acquired: boolean }[]
  try {
    lockResult = await prismaDirectUrl.$queryRaw<{ acquired: boolean }[]>`
      SELECT pg_try_advisory_lock(${FEE_TIER_EVALUATION_LOCK_KEY}) AS acquired
    `
  } catch (error) {
    logServerError('feeTierEvaluationJob: no se pudo tomar el advisory lock', error)
    feeTierEvaluationRunning = false
    return EMPTY_RESULT
  }

  if (!lockResult[0]?.acquired) {
    feeTierEvaluationRunning = false
    return EMPTY_RESULT
  }

  const result: FeeTierRunResult = { ...EMPTY_RESULT }

  try {
    const tiersActivos = await getTiersActivos()

    // Sin escalera activa el motor no cambia ninguna comisión. Es el estado en
    // el que se despliega la feature: código encendido, escalera apagada.
    // Igual seguimos para registrar volúmenes, que es lo que permite verificar
    // en producción que los conteos dan bien ANTES de activar nada.
    const empresas = await getEmpresasEvaluables()
    if (empresas.length === 0) {
      return result
    }

    const volumenes = await calcularVolumenPorEmpresa()
    const empresaIds = empresas.map((e) => e.id)
    const pctVigentePorEmpresa = await getPctVigentePorEmpresa(empresaIds)

    for (const empresa of empresas) {
      // Un fallo procesando una empresa no puede abortar la corrida (R6.6).
      try {
        const volumen = volumenes.get(empresa.id) ?? 0
        const state = await getFeeTierState(empresa.id)
        const pctVigente = pctVigentePorEmpresa.get(empresa.id) ?? { entradas: null, consumibles: null }

        const decision = decidirAccion({
          volumen,
          tiersActivos,
          pctVigente,
          pinned: state?.pinned ?? false,
        })

        result.evaluadas += 1

        switch (decision.accion) {
          case 'pinned': {
            // R5.2/R5.3 — no tocar la comisión, pero sí registrar el volumen
            // para que el panel muestre qué tier le correspondería.
            await registrarEvaluacion({
              empresaId: empresa.id,
              entradasVentana: volumen,
              pendingDowngradeTierId: null,
            })
            result.pinnedOmitidas += 1
            break
          }

          case 'sin_escalera': {
            await registrarEvaluacion({ empresaId: empresa.id, entradasVentana: volumen })
            result.sinCambio += 1
            break
          }

          case 'ascenso': {
            await aplicarTier({
              empresaId: empresa.id,
              tier: decision.tier,
              entradasVentana: volumen,
              origen: 'system',
              aplicadoPor: null,
              pctVigente,
            })
            // La notificación va fuera de la transacción a propósito: si Resend
            // o la escritura del mensaje fallan, el cambio de comisión y su
            // auditoría ya están firmes. Un aviso perdido es recuperable; una
            // comisión sin auditoría, no.
            try {
              await notificarAscenso({
                empresaId: empresa.id,
                tierNombre: decision.tier.nombre,
                pctEntradas: pctDelTier(decision.tier, 'entradas'),
                pctConsumibles: pctDelTier(decision.tier, 'consumibles'),
              })
            } catch (error) {
              logServerError(`feeTierEvaluationJob: no se pudo notificar a empresa ${empresa.id}`, error)
            }
            result.ascensos += 1
            break
          }

          case 'descenso_pendiente': {
            // R4.1 — NO se aplica. Solo se marca para revisión humana.
            await registrarEvaluacion({
              empresaId: empresa.id,
              entradasVentana: volumen,
              pendingDowngradeTierId: decision.tier.id,
            })
            result.descensosPendientes += 1
            break
          }

          case 'sin_cambio': {
            // R4.5 — el volumen coincide con la comisión vigente: si había un
            // descenso pendiente, se cancela.
            await registrarEvaluacion({
              empresaId: empresa.id,
              entradasVentana: volumen,
              currentTierId: decision.tier.id,
              pendingDowngradeTierId: null,
            })
            result.sinCambio += 1
            break
          }
        }
      } catch (error) {
        result.errores += 1
        logServerError(`feeTierEvaluationJob: fallo evaluando empresa ${empresa.id}`, error)
      }
    }

    return result
  } catch (error) {
    logServerError('feeTierEvaluationJob: fallo general', error)
    return result
  } finally {
    result.durationMs = Date.now() - startedAt
    await prismaDirectUrl
      .$queryRaw`SELECT pg_advisory_unlock(${FEE_TIER_EVALUATION_LOCK_KEY})`
      .catch(() => {
        /* ignoro errores del release */
      })
    feeTierEvaluationRunning = false
    logServerInfo(
      `[feeTierEvaluationJob] evaluadas=${result.evaluadas} ascensos=${result.ascensos} ` +
        `descensosPendientes=${result.descensosPendientes} pinned=${result.pinnedOmitidas} ` +
        `errores=${result.errores} ${result.durationMs}ms`,
    )
  }
}

export function startFeeTierEvaluationJob(env: NodeJS.ProcessEnv = process.env) {
  if (!shouldStartFeeTierEvaluationJob(env)) {
    return
  }

  const state = getJobState()
  if (state.timer) {
    return
  }

  state.timer = setInterval(() => {
    void runFeeTierEvaluationJob()
  }, FEE_TIER_EVALUATION_INTERVAL_MS)

  if (typeof state.timer.unref === 'function') {
    state.timer.unref()
  }

  logServerInfo('[feeTierEvaluationJob] iniciado (intervalo 24h)')
}

export function stopFeeTierEvaluationJob() {
  const state = getJobState()
  if (state.timer) {
    clearInterval(state.timer)
    state.timer = null
  }
}
