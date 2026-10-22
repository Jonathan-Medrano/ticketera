import { runDeliveryRetry } from '../services/deliveryRetry'
import { logServerError } from '../lib/safe-log'

export const DELIVERY_RETRY_INTERVAL_MS = 60 * 1000 // 1 minuto

const JOB_STATE_KEY = Symbol.for('platea.backend.deliveryRetryJob')

let running = false

type JobTimer = ReturnType<typeof setInterval>
type JobState = { timer: JobTimer | null }

function getJobState(): JobState {
  const scope = globalThis as typeof globalThis & {
    [JOB_STATE_KEY]?: JobState
  }
  if (!scope[JOB_STATE_KEY]) {
    scope[JOB_STATE_KEY] = { timer: null }
  }
  return scope[JOB_STATE_KEY]
}

export function shouldStartDeliveryRetryJob(env: NodeJS.ProcessEnv = process.env) {
  if (env.DELIVERY_RETRY_ENABLED === '0') return false
  if (env.NODE_ENV === 'test' && env.DELIVERY_RETRY_ENABLE_IN_TESTS !== '1') return false
  if (env.BACKEND_MIGRATION_MODE === '1' || env.MIGRATION_RUNNING === '1') return false
  return true
}

export async function runDeliveryRetryJob() {
  if (running) return null
  running = true
  try {
    return await runDeliveryRetry()
  } catch {
    logServerError('delivery retry job')
    return null
  } finally {
    running = false
  }
}

export function startDeliveryRetryJob(intervalMs = DELIVERY_RETRY_INTERVAL_MS) {
  if (!shouldStartDeliveryRetryJob()) return null

  const state = getJobState()
  if (state.timer) return state.timer

  state.timer = setInterval(() => {
    void runDeliveryRetryJob()
  }, intervalMs)

  state.timer.unref?.()
  return state.timer
}

export function stopDeliveryRetryJob() {
  const state = getJobState()
  if (state.timer) {
    clearInterval(state.timer)
    state.timer = null
  }
}
