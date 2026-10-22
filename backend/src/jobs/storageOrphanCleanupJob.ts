import { runStorageOrphanCleanup } from '../services/storageOrphanCleanup'
import { logServerError } from '../lib/safe-log'

export const STORAGE_ORPHAN_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000 // diario

const JOB_STATE_KEY = Symbol.for('platea.backend.storageOrphanCleanupJob')

let storageOrphanCleanupRunning = false

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

export function shouldStartStorageOrphanCleanupJob(env: NodeJS.ProcessEnv = process.env) {
  // Opt-out explícito (default ON)
  if (env.STORAGE_ORPHAN_CLEANUP_ENABLED === '0') {
    return false
  }

  if (env.NODE_ENV === 'test' && env.STORAGE_ORPHAN_CLEANUP_ENABLE_IN_TESTS !== '1') {
    return false
  }

  if (env.BACKEND_MIGRATION_MODE === '1' || env.MIGRATION_RUNNING === '1') {
    return false
  }

  // Sin credenciales Supabase, el job no tiene nada que hacer — opt-out automático
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return false
  }

  return true
}

export async function runStorageOrphanCleanupJob() {
  if (storageOrphanCleanupRunning) {
    return null
  }

  storageOrphanCleanupRunning = true
  try {
    return await runStorageOrphanCleanup({ triggeredBy: 'cron' })
  } catch {
    logServerError('storage orphan cleanup')
    return null
  } finally {
    storageOrphanCleanupRunning = false
  }
}

export function startStorageOrphanCleanupJob(intervalMs = STORAGE_ORPHAN_CLEANUP_INTERVAL_MS) {
  if (!shouldStartStorageOrphanCleanupJob()) {
    return null
  }

  const state = getJobState()
  if (state.timer) {
    return state.timer
  }

  state.timer = setInterval(() => {
    void runStorageOrphanCleanupJob()
  }, intervalMs)

  state.timer.unref?.()

  return state.timer
}

export function stopStorageOrphanCleanupJob() {
  const state = getJobState()
  if (state.timer) {
    clearInterval(state.timer)
    state.timer = null
  }
}
