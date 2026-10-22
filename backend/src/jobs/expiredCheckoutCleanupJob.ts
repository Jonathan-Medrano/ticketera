import { cleanupExpiredCheckoutReservations } from '../services/checkoutCleanup'
import { logServerError } from '../lib/safe-log'

export const EXPIRED_CHECKOUT_CLEANUP_INTERVAL_MS = 30 * 1000

const CLEANUP_JOB_STATE_KEY = Symbol.for('platea.backend.expiredCheckoutCleanupJob')

let expiredCheckoutCleanupRunning = false

type CleanupJobTimer = ReturnType<typeof setInterval>
type CleanupJobState = {
  timer: CleanupJobTimer | null
}

function getCleanupJobState(): CleanupJobState {
  const scope = globalThis as typeof globalThis & {
    [CLEANUP_JOB_STATE_KEY]?: CleanupJobState
  }

  if (!scope[CLEANUP_JOB_STATE_KEY]) {
    scope[CLEANUP_JOB_STATE_KEY] = { timer: null }
  }

  return scope[CLEANUP_JOB_STATE_KEY]
}

export function shouldStartExpiredCheckoutCleanupJob(env: NodeJS.ProcessEnv = process.env) {
  if (env.CHECKOUT_CLEANUP_ENABLED === '0') {
    return false
  }

  if (env.NODE_ENV === 'test' && env.CHECKOUT_CLEANUP_ENABLE_IN_TESTS !== '1') {
    return false
  }

  if (env.BACKEND_MIGRATION_MODE === '1' || env.MIGRATION_RUNNING === '1') {
    return false
  }

  return true
}

export async function runExpiredCheckoutCleanupJob() {
  if (expiredCheckoutCleanupRunning) {
    return 0
  }

  expiredCheckoutCleanupRunning = true
  try {
    return await cleanupExpiredCheckoutReservations()
  } catch {
    logServerError('checkout cleanup')
    return 0
  } finally {
    expiredCheckoutCleanupRunning = false
  }
}

export function startExpiredCheckoutCleanupJob(intervalMs = EXPIRED_CHECKOUT_CLEANUP_INTERVAL_MS) {
  if (!shouldStartExpiredCheckoutCleanupJob()) {
    return null
  }

  const state = getCleanupJobState()
  if (state.timer) {
    return state.timer
  }

  state.timer = setInterval(() => {
    void runExpiredCheckoutCleanupJob()
  }, intervalMs)

  state.timer.unref?.()

  return state.timer
}

export function stopExpiredCheckoutCleanupJob() {
  const state = getCleanupJobState()

  if (state.timer) {
    clearInterval(state.timer)
    state.timer = null
  }
}
