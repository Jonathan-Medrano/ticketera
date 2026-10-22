import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Request } from 'express'
import { parseActorContextHeaders } from './auth'

test('parseActorContextHeaders preserves buyer actor context', () => {
  const request = { headers: { 'x-actor-kind': 'buyer', 'x-tenant-slug': 'acme' } } as unknown as Request
  assert.deepEqual(parseActorContextHeaders(request), { actorKind: 'buyer', tenantSlug: 'acme' })
})

test('parseActorContextHeaders falls back to anonymous when headers are absent', () => {
  const request = { headers: {} } as unknown as Request
  assert.deepEqual(parseActorContextHeaders(request), { actorKind: 'anonymous', tenantSlug: null })
})
