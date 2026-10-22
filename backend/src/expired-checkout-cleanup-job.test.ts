import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'

import {
  startExpiredCheckoutCleanupJob,
  stopExpiredCheckoutCleanupJob,
  shouldStartExpiredCheckoutCleanupJob,
} from './jobs/expiredCheckoutCleanupJob'

const ORIGINAL_ENV = {
  NODE_ENV: process.env.NODE_ENV,
  CHECKOUT_CLEANUP_ENABLED: process.env.CHECKOUT_CLEANUP_ENABLED,
  CHECKOUT_CLEANUP_ENABLE_IN_TESTS: process.env.CHECKOUT_CLEANUP_ENABLE_IN_TESTS,
  BACKEND_MIGRATION_MODE: process.env.BACKEND_MIGRATION_MODE,
  MIGRATION_RUNNING: process.env.MIGRATION_RUNNING,
}

function restoreEnv() {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key]
      continue
    }

    process.env[key] = value
  }
}

afterEach(() => {
  stopExpiredCheckoutCleanupJob()
  restoreEnv()
})

test('cleanup job stays disabled during tests unless explicitly enabled', () => {
  process.env.NODE_ENV = 'test'
  delete process.env.CHECKOUT_CLEANUP_ENABLE_IN_TESTS

  assert.equal(shouldStartExpiredCheckoutCleanupJob(), false)
  assert.equal(startExpiredCheckoutCleanupJob(25), null)
})

test('cleanup job can be enabled explicitly during tests', () => {
  process.env.NODE_ENV = 'test'
  process.env.CHECKOUT_CLEANUP_ENABLE_IN_TESTS = '1'

  assert.equal(shouldStartExpiredCheckoutCleanupJob(), true)

  const timer = startExpiredCheckoutCleanupJob(25)
  assert.ok(timer)
})

test('cleanup job does not start during migrations', () => {
  process.env.NODE_ENV = 'development'
  process.env.BACKEND_MIGRATION_MODE = '1'

  assert.equal(shouldStartExpiredCheckoutCleanupJob(), false)
  assert.equal(startExpiredCheckoutCleanupJob(25), null)
})

test('cleanup job start is singleton-safe across repeated bootstraps', () => {
  process.env.NODE_ENV = 'development'
  delete process.env.BACKEND_MIGRATION_MODE

  const firstTimer = startExpiredCheckoutCleanupJob(25)
  const secondTimer = startExpiredCheckoutCleanupJob(25)

  assert.ok(firstTimer)
  assert.equal(firstTimer, secondTimer)
})
