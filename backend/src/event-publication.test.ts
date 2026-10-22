import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildEventPublicationSnapshot,
  formatUtcDateTimeForInput,
  zonedLocalDateTimeToUtc,
} from './lib/event-publication'

test('scheduled listed events are visible in listing only before publish time', () => {
  const snapshot = buildEventPublicationSnapshot({
    activo: 1,
    publication_mode: 'scheduled',
    pre_publish_visibility: 'listado_solo',
    publish_at_utc: '2026-05-20 23:00:00',
    publish_timezone: 'America/Argentina/Buenos_Aires',
  }, new Date('2026-05-20T22:00:00Z'))

  assert.equal(snapshot.publication_status, 'listed')
  assert.equal(snapshot.is_listed, true)
  assert.equal(snapshot.is_detail_visible, false)
  assert.equal(snapshot.is_checkout_open, false)
})

test('scheduled detail-visible events expose detail but keep checkout closed before publish time', () => {
  const snapshot = buildEventPublicationSnapshot({
    activo: 1,
    publication_mode: 'scheduled',
    pre_publish_visibility: 'detail_visible',
    publish_at_utc: '2026-05-20 23:00:00',
    publish_timezone: 'America/Argentina/Buenos_Aires',
  }, new Date('2026-05-20T22:00:00Z'))

  assert.equal(snapshot.publication_status, 'listed')
  assert.equal(snapshot.publication_reason, 'scheduled_detail_visible')
  assert.equal(snapshot.is_listed, true)
  assert.equal(snapshot.is_detail_visible, true)
  assert.equal(snapshot.is_checkout_open, false)
})

test('manual inactive stays hidden even if schedule would otherwise be live', () => {
  const snapshot = buildEventPublicationSnapshot({
    activo: 0,
    publication_mode: 'scheduled',
    pre_publish_visibility: 'listado_solo',
    publish_at_utc: '2026-05-20 20:00:00',
    publish_timezone: 'America/Argentina/Buenos_Aires',
  }, new Date('2026-05-21T00:00:00Z'))

  assert.equal(snapshot.publication_reason, 'manual_inactive')
  assert.equal(snapshot.publication_status, 'hidden')
})

test('scheduled hidden events become live after publish time', () => {
  const snapshot = buildEventPublicationSnapshot({
    activo: 1,
    publication_mode: 'scheduled',
    pre_publish_visibility: 'hidden',
    publish_at_utc: '2026-05-20 20:00:00',
    publish_timezone: 'America/Argentina/Buenos_Aires',
  }, new Date('2026-05-21T00:00:00Z'))

  assert.equal(snapshot.publication_status, 'live')
  assert.equal(snapshot.is_checkout_open, true)
})

test('publication timezone helpers roundtrip local schedule intent', () => {
  const utcDate = zonedLocalDateTimeToUtc('2026-05-20', '20:00', 'America/Argentina/Buenos_Aires')
  assert.ok(utcDate)
  assert.equal(utcDate?.toISOString(), '2026-05-20T23:00:00.000Z')

  const local = formatUtcDateTimeForInput('2026-05-20 23:00:00', 'America/Argentina/Buenos_Aires')
  assert.equal(local.publish_date_local, '2026-05-20')
  assert.equal(local.publish_time_local, '20:00')
})
