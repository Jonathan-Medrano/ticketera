import { autoApproveSlaExpiredRefunds } from '../services/refundSlaAutoApprove'
import { logServerError } from '../lib/safe-log'

// Frecuencia del job: 5 minutos. El SLA se mide en dias, asi que correr cada 5 minutos
// es suficiente para que en el peor caso un caso "vencido" se auto-apruebe dentro de
// los siguientes 5 minutos al vencimiento (latencia despreciable contra dias de SLA).
export const REFUND_SLA_AUTO_APPROVE_INTERVAL_MS = 5 * 60 * 1000

const SLA_JOB_STATE_KEY = Symbol.for('platea.backend.refundSlaAutoApproveJob')

let refundSlaAutoApproveRunning = false

type SlaJobTimer = ReturnType<typeof setInterval>
type SlaJobState = {
  timer: SlaJobTimer | null
}

function getSlaJobState(): SlaJobState {
  const scope = globalThis as typeof globalThis & {
    [SLA_JOB_STATE_KEY]?: SlaJobState
  }

  if (!scope[SLA_JOB_STATE_KEY]) {
    scope[SLA_JOB_STATE_KEY] = { timer: null }
  }

  return scope[SLA_JOB_STATE_KEY]
}

export function shouldStartRefundSlaAutoApproveJob(env: NodeJS.ProcessEnv = process.env) {
  if (env.REFUND_SLA_AUTO_APPROVE_ENABLED === '0') {
    return false
  }

  if (env.NODE_ENV === 'test' && env.REFUND_SLA_AUTO_APPROVE_ENABLE_IN_TESTS !== '1') {
    return false
  }

  if (env.BACKEND_MIGRATION_MODE === '1' || env.MIGRATION_RUNNING === '1') {
    return false
  }

  return true
}

export async function runRefundSlaAutoApproveJob() {
  if (refundSlaAutoApproveRunning) {
    return 0
  }

  refundSlaAutoApproveRunning = true
  try {
    return await autoApproveSlaExpiredRefunds()
  } catch {
    logServerError('refund sla auto-approve')
    return 0
  } finally {
    refundSlaAutoApproveRunning = false
  }
}

export function startRefundSlaAutoApproveJob(intervalMs = REFUND_SLA_AUTO_APPROVE_INTERVAL_MS) {
  if (!shouldStartRefundSlaAutoApproveJob()) {
    return null
  }

  const state = getSlaJobState()
  if (state.timer) {
    return state.timer
  }

  state.timer = setInterval(() => {
    void runRefundSlaAutoApproveJob()
  }, intervalMs)

  state.timer.unref?.()

  return state.timer
}

export function stopRefundSlaAutoApproveJob() {
  const state = getSlaJobState()

  if (state.timer) {
    clearInterval(state.timer)
    state.timer = null
  }
}
