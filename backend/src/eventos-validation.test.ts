import assert from 'node:assert/strict'
import { test } from 'node:test'

import { formatUtcDateTimeForSql } from './lib/event-publication'
import {
  EventoValidationError,
  MAX_CATEGORY_PRICE,
  bodyHasPublicationPolicyFields,
  formatActivaDesdeForSql,
  isTipoMapaValido,
  normalizeEventoPublicationPolicy,
  parseEventoFechaToUtc,
  validateFechasNoPasadas,
  validateTandas,
  withSerializableRetry,
  type EventoCategoriaInput,
} from './routes/eventos'

// ---------------------------------------------------------------------------
// parseEventoFechaToUtc
// ---------------------------------------------------------------------------
// Sin Docker/Postgres disponibles en este entorno: estos son tests unitarios
// puros (sin DB), corridos con `node --import tsx --test`. Cubren las
// funciones nuevas/modificadas de eventos.ts que son puras (no tocan Prisma).

test('parseEventoFechaToUtc convierte un datetime-local naive a UTC asumiendo AR (UTC-3)', () => {
  const result = parseEventoFechaToUtc('2026-08-20T22:00')
  assert.equal(result.toISOString(), '2026-08-21T01:00:00.000Z')
})

test('parseEventoFechaToUtc acepta separador con espacio en vez de "T"', () => {
  const result = parseEventoFechaToUtc('2026-08-20 22:00')
  assert.equal(result.toISOString(), '2026-08-21T01:00:00.000Z')
})

test('parseEventoFechaToUtc maneja medianoche AR', () => {
  // 00:00 AR == 03:00 UTC del mismo día (AR es UTC-3 todo el año, sin DST)
  const result = parseEventoFechaToUtc('2026-08-20T00:00')
  assert.equal(result.toISOString(), '2026-08-20T03:00:00.000Z')
})

test('parseEventoFechaToUtc hace rollover de día al cruzar medianoche UTC', () => {
  // 22:00 AR -> 01:00 UTC del día siguiente
  const result = parseEventoFechaToUtc('2026-08-20T22:30')
  assert.equal(result.toISOString(), '2026-08-21T01:30:00.000Z')
})

test('parseEventoFechaToUtc hace rollover de mes y año (31 dic 23:00 AR -> 1 ene UTC)', () => {
  const result = parseEventoFechaToUtc('2026-12-31T23:00')
  assert.equal(result.toISOString(), '2027-01-01T02:00:00.000Z')
})

test('parseEventoFechaToUtc rechaza un string que no matchea el formato esperado', () => {
  assert.throws(() => parseEventoFechaToUtc('no-es-una-fecha'), EventoValidationError)
  assert.throws(() => parseEventoFechaToUtc('2026-08-20'), EventoValidationError)
  assert.throws(() => parseEventoFechaToUtc(''), EventoValidationError)
})

test('parseEventoFechaToUtc devuelve un Date consumible por formatUtcDateTimeForSql sin errores', () => {
  const result = parseEventoFechaToUtc('2026-08-20T22:00')
  const sql = formatUtcDateTimeForSql(result)
  assert.equal(sql, '2026-08-21 01:00:00')
})

// ---------------------------------------------------------------------------
// validateFechasNoPasadas
// ---------------------------------------------------------------------------
// Usamos fechas muy lejanas en el pasado/futuro (año 2000 / 2099) para que el
// test no dependa de cuándo se corre realmente la suite.

test('validateFechasNoPasadas no lanza si la fecha nueva (sin id) es futura', () => {
  assert.doesNotThrow(() => validateFechasNoPasadas([{ fecha: '2099-01-01T20:00' }]))
})

test('validateFechasNoPasadas lanza EventoValidationError si la fecha nueva (sin id) es pasada', () => {
  assert.throws(
    () => validateFechasNoPasadas([{ fecha: '2000-01-01T20:00' }]),
    EventoValidationError
  )
})

test('validateFechasNoPasadas NO lanza para una fecha existente (con id UUID real) aunque sea pasada', () => {
  assert.doesNotThrow(() =>
    validateFechasNoPasadas([
      { id: '11111111-1111-1111-1111-111111111111', fecha: '2000-01-01T20:00' },
    ])
  )
})

test('validateFechasNoPasadas ignora un id que no es un UUID válido (lo trata como fecha nueva)', () => {
  assert.throws(
    () => validateFechasNoPasadas([{ id: 'temp-id-no-uuid', fecha: '2000-01-01T20:00' }]),
    EventoValidationError
  )
})

test('validateFechasNoPasadas con mezcla de fecha existente (pasada) y fecha nueva (futura) no lanza', () => {
  assert.doesNotThrow(() =>
    validateFechasNoPasadas([
      { id: '22222222-2222-2222-2222-222222222222', fecha: '2000-01-01T20:00' },
      { fecha: '2099-01-01T20:00' },
    ])
  )
})

test('validateFechasNoPasadas con mezcla de fecha existente (pasada) y fecha nueva (pasada) lanza', () => {
  assert.throws(
    () =>
      validateFechasNoPasadas([
        { id: '33333333-3333-3333-3333-333333333333', fecha: '2000-01-01T20:00' },
        { fecha: '2000-06-01T20:00' },
      ]),
    EventoValidationError
  )
})

// ---------------------------------------------------------------------------
// validateTandas — techo de precio (MAX_CATEGORY_PRICE)
// ---------------------------------------------------------------------------

function baseCategoria(overrides: Partial<EventoCategoriaInput> = {}): EventoCategoriaInput {
  return {
    id: '44444444-4444-4444-4444-444444444444',
    nombre: 'General',
    descripcion: null,
    imagen_url: null,
    precio: 5000,
    stock: 100,
    tanda_id: null,
    entradas_por_unidad: 1,
    ...overrides,
  }
}

test('validateTandas acepta precio 0 (categoría gratis)', () => {
  const error = validateTandas([], [baseCategoria({ precio: 0 })])
  assert.equal(error, null)
})

test('validateTandas acepta un precio normal', () => {
  const error = validateTandas([], [baseCategoria({ precio: 5000 })])
  assert.equal(error, null)
})

test('validateTandas acepta un precio exactamente igual a MAX_CATEGORY_PRICE (el check es ">" estricto)', () => {
  const error = validateTandas([], [baseCategoria({ precio: MAX_CATEGORY_PRICE })])
  assert.equal(error, null)
})

test('validateTandas rechaza un precio por encima de MAX_CATEGORY_PRICE', () => {
  const error = validateTandas([], [baseCategoria({ precio: MAX_CATEGORY_PRICE + 1 })])
  assert.ok(error)
  assert.match(error as string, /supera el máximo permitido/)
})

test('validateTandas sigue rechazando precio negativo (comportamiento previo al fix)', () => {
  const error = validateTandas([], [baseCategoria({ precio: -100 })])
  assert.ok(error)
  assert.match(error as string, /mayor o igual a 0/)
})

// ---------------------------------------------------------------------------
// withSerializableRetry
// ---------------------------------------------------------------------------

function serializationError() {
  return Object.assign(new Error('serialization failure'), { code: 'P2034' })
}

test('withSerializableRetry reintenta ante P2034 y devuelve el resultado cuando después resuelve', async () => {
  let calls = 0
  const result = await withSerializableRetry(async () => {
    calls += 1
    if (calls <= 2) throw serializationError()
    return 'ok'
  }, 3, 1)

  assert.equal(result, 'ok')
  assert.equal(calls, 3)
})

test('withSerializableRetry deja de reintentar al agotar el límite y propaga el último error P2034', async () => {
  let calls = 0
  await assert.rejects(
    () =>
      withSerializableRetry(async () => {
        calls += 1
        throw serializationError()
      }, 2, 1),
    (err: unknown) => (err as { code?: string }).code === 'P2034'
  )
  // retries=2 -> intento inicial + 2 reintentos = 3 llamadas
  assert.equal(calls, 3)
})

test('withSerializableRetry propaga sin reintentar un error que no es P2034', async () => {
  let calls = 0
  await assert.rejects(
    () =>
      withSerializableRetry(async () => {
        calls += 1
        throw new Error('otro error cualquiera')
      }, 3, 1),
    /otro error cualquiera/
  )
  assert.equal(calls, 1)
})

// ---------------------------------------------------------------------------
// formatActivaDesdeForSql
// ---------------------------------------------------------------------------
// Mismo bug de timezone que tenía `fecha` (backend/eventos.ts) existía también
// en `evento_tandas.activa_desde` — este helper aplica el mismo fix.

test('formatActivaDesdeForSql convierte un datetime-local naive AR a UTC listo para SQL', () => {
  assert.equal(formatActivaDesdeForSql('2026-08-20T22:00'), '2026-08-21 01:00:00')
})

test('formatActivaDesdeForSql devuelve null si no hay activa_desde (tanda sin activación programada)', () => {
  assert.equal(formatActivaDesdeForSql(null), null)
  assert.equal(formatActivaDesdeForSql(undefined), null)
  assert.equal(formatActivaDesdeForSql(''), null)
  assert.equal(formatActivaDesdeForSql('   '), null)
})

test('formatActivaDesdeForSql rechaza un string con formato inválido', () => {
  assert.throws(() => formatActivaDesdeForSql('no-es-una-fecha'), EventoValidationError)
})

// ---------------------------------------------------------------------------
// normalizeEventoPublicationPolicy — publicación programada en el pasado
// ---------------------------------------------------------------------------

test('normalizeEventoPublicationPolicy acepta una publicación programada futura', () => {
  const result = normalizeEventoPublicationPolicy({
    publication_mode: 'scheduled',
    pre_publish_visibility: 'hidden',
    publish_date_local: '2099-01-01',
    publish_time_local: '20:00',
  })
  assert.equal(result.publicationMode, 'scheduled')
  assert.equal(result.publishedLiveAt, null)
})

test('normalizeEventoPublicationPolicy rechaza una publicación programada en el pasado', () => {
  assert.throws(
    () =>
      normalizeEventoPublicationPolicy({
        publication_mode: 'scheduled',
        pre_publish_visibility: 'hidden',
        publish_date_local: '2000-01-01',
        publish_time_local: '20:00',
      }),
    EventoValidationError
  )
})

test('normalizeEventoPublicationPolicy no valida fecha pasada en modo immediate (no aplica)', () => {
  assert.doesNotThrow(() =>
    normalizeEventoPublicationPolicy({
      publication_mode: 'immediate',
      pre_publish_visibility: 'hidden',
    })
  )
})

// Regresión encontrada en code review: un evento scheduled que ya está en vivo (su
// publish_at_utc ya pasó) nunca cambia de modo a "immediate" — si se re-envía la MISMA
// fecha ya guardada al editar cualquier otro campo, no debe rechazarse, o el evento
// quedaría bloqueado para editarse para siempre.
test('normalizeEventoPublicationPolicy NO rechaza una fecha pasada si coincide con la ya guardada (evento scheduled ya vivo, sin cambios en su publicación)', () => {
  const existingPublishAtUtc = new Date('2000-06-01T23:00:00.000Z')
  assert.doesNotThrow(() =>
    normalizeEventoPublicationPolicy(
      {
        publication_mode: 'scheduled',
        pre_publish_visibility: 'hidden',
        // 2000-06-01T20:00 AR (UTC-3) == 2000-06-01T23:00:00.000Z — mismo instante que existingPublishAtUtc
        publish_date_local: '2000-06-01',
        publish_time_local: '20:00',
      },
      existingPublishAtUtc
    )
  )
})

test('normalizeEventoPublicationPolicy SÍ rechaza una fecha pasada distinta a la ya guardada (cambio real a un valor nuevo en el pasado)', () => {
  const existingPublishAtUtc = new Date('2099-01-01T23:00:00.000Z')
  assert.throws(
    () =>
      normalizeEventoPublicationPolicy(
        {
          publication_mode: 'scheduled',
          pre_publish_visibility: 'hidden',
          publish_date_local: '2000-01-01',
          publish_time_local: '20:00',
        },
        existingPublishAtUtc
      ),
    EventoValidationError
  )
})

test('normalizeEventoPublicationPolicy sin existingPublishAtUtc (evento nuevo, POST) sigue rechazando fecha pasada', () => {
  assert.throws(
    () =>
      normalizeEventoPublicationPolicy({
        publication_mode: 'scheduled',
        pre_publish_visibility: 'hidden',
        publish_date_local: '2000-01-01',
        publish_time_local: '20:00',
      }),
    EventoValidationError
  )
})

// ---------------------------------------------------------------------------
// bodyHasPublicationPolicyFields — PATCH /:id no debe resetear la política si el
// caller no la manda
// ---------------------------------------------------------------------------

test('bodyHasPublicationPolicyFields devuelve false si el body no incluye ningún campo de política', () => {
  assert.equal(bodyHasPublicationPolicyFields({ nombre: 'Evento', lugar: 'Club X' }), false)
})

test('bodyHasPublicationPolicyFields devuelve true si el body incluye publication_mode', () => {
  assert.equal(bodyHasPublicationPolicyFields({ publication_mode: 'immediate' }), true)
})

test('bodyHasPublicationPolicyFields devuelve true si el body incluye solo un campo parcial (ej. publish_timezone)', () => {
  assert.equal(bodyHasPublicationPolicyFields({ publish_timezone: 'America/Argentina/Buenos_Aires' }), true)
})

test('bodyHasPublicationPolicyFields ignora un valor undefined explícito (no cuenta como "mandado")', () => {
  assert.equal(bodyHasPublicationPolicyFields({ publication_mode: undefined }), false)
})

// ---------------------------------------------------------------------------
// isTipoMapaValido — regresión: tipo_mapa nunca se persistía porque POST/PATCH
// no lo leían del body ni lo validaban (siempre caía al default "libre" del schema).
// ---------------------------------------------------------------------------

test('isTipoMapaValido acepta "libre" y "numerado"', () => {
  assert.equal(isTipoMapaValido('libre'), true)
  assert.equal(isTipoMapaValido('numerado'), true)
})

test('isTipoMapaValido rechaza cualquier otro valor (incluyendo undefined, null y variantes de casing)', () => {
  assert.equal(isTipoMapaValido(undefined), false)
  assert.equal(isTipoMapaValido(null), false)
  assert.equal(isTipoMapaValido(''), false)
  assert.equal(isTipoMapaValido('Libre'), false)
  assert.equal(isTipoMapaValido('numerada'), false)
  assert.equal(isTipoMapaValido(123), false)
})
