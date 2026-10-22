
export const DEFAULT_EVENT_PUBLICATION_TIMEZONE = 'America/Argentina/Buenos_Aires'

export type EventPublicationMode = 'immediate' | 'scheduled'
export type EventPrePublishVisibility = 'hidden' | 'listado_solo' | 'detail_visible'
export type EventPublicationStatus = 'hidden' | 'listed' | 'live'
export type EventPublicationReason = 'manual_inactive' | 'scheduled_hidden' | 'scheduled_listed' | 'scheduled_detail_visible' | 'live'

export type EventPublicationSnapshot = {
  publication_status: EventPublicationStatus
  publication_reason: EventPublicationReason
  is_listed: boolean
  is_detail_visible: boolean
  is_checkout_open: boolean
  publication: {
    mode: EventPublicationMode
    pre_publish_visibility: EventPrePublishVisibility
    publish_at_utc: string | null
    publish_timezone: string | null
    published_live_at: string | null
  }
}

export type EventPublicationSource = {
  activo?: unknown
  publication_mode?: unknown
  pre_publish_visibility?: unknown
  publish_at_utc?: unknown
  publish_timezone?: unknown
  published_live_at?: unknown
}

type ZonedDateParts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

const zonedDateFormatterCache = new Map<string, Intl.DateTimeFormat>()

function getZonedDateFormatter(timeZone: string) {
  const cached = zonedDateFormatterCache.get(timeZone)
  if (cached) return cached

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })

  zonedDateFormatterCache.set(timeZone, formatter)
  return formatter
}

function pad(value: number) {
  return String(value).padStart(2, '0')
}

function normalizeMysqlUtcDate(value: unknown): Date | null {
  if (!value) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value

  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  if (!trimmed) return null

  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(trimmed)
    ? `${trimmed.replace(' ', 'T')}${trimmed.length === 16 ? ':00' : ''}Z`
    : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(trimmed)
      ? `${trimmed}${trimmed.length === 16 ? ':00' : ''}Z`
      : trimmed

  const parsed = new Date(normalized)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function getZonedDateParts(date: Date, timeZone: string): ZonedDateParts {
  const formatter = getZonedDateFormatter(timeZone)
  const parts = formatter.formatToParts(date)
  const resolved = {
    year: 0,
    month: 0,
    day: 0,
    hour: 0,
    minute: 0,
    second: 0,
  }

  for (const part of parts) {
    if (part.type === 'year') resolved.year = Number(part.value)
    if (part.type === 'month') resolved.month = Number(part.value)
    if (part.type === 'day') resolved.day = Number(part.value)
    if (part.type === 'hour') resolved.hour = Number(part.value)
    if (part.type === 'minute') resolved.minute = Number(part.value)
    if (part.type === 'second') resolved.second = Number(part.value)
  }

  return resolved
}

export function isValidIanaTimeZone(timeZone: string) {
  try {
    getZonedDateFormatter(timeZone)
    return true
  } catch {
    return false
  }
}

export function normalizePublicationMode(value: unknown): EventPublicationMode {
  return value === 'scheduled' ? 'scheduled' : 'immediate'
}

export function normalizePrePublishVisibility(value: unknown): EventPrePublishVisibility {
  if (value === 'detail_visible') return 'detail_visible'
  if (value === 'listado_solo') return 'listado_solo'
  return 'hidden'
}

export function formatUtcDateTimeForSql(date: Date) {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
}

export function formatUtcDateTimeForInput(value: string | null | undefined, timeZone: string | null | undefined) {
  if (!value) {
    return {
      publish_date_local: '',
      publish_time_local: '',
    }
  }

  const date = normalizeMysqlUtcDate(value)
  if (!date) {
    return {
      publish_date_local: '',
      publish_time_local: '',
    }
  }

  const resolvedTimeZone = timeZone || DEFAULT_EVENT_PUBLICATION_TIMEZONE
  const zoned = getZonedDateParts(date, resolvedTimeZone)
  return {
    publish_date_local: `${zoned.year}-${pad(zoned.month)}-${pad(zoned.day)}`,
    publish_time_local: `${pad(zoned.hour)}:${pad(zoned.minute)}`,
  }
}

export function zonedLocalDateTimeToUtc(dateValue: string, timeValue: string, timeZone: string): Date | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue)
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(timeValue)
  if (!dateMatch || !timeMatch || !isValidIanaTimeZone(timeZone)) return null

  const year = Number(dateMatch[1])
  const month = Number(dateMatch[2])
  const day = Number(dateMatch[3])
  const hour = Number(timeMatch[1])
  const minute = Number(timeMatch[2])

  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null

  const targetUtcEquivalent = Date.UTC(year, month - 1, day, hour, minute, 0)
  let guess = new Date(targetUtcEquivalent)

  for (let index = 0; index < 4; index += 1) {
    const zoned = getZonedDateParts(guess, timeZone)
    const zonedUtcEquivalent = Date.UTC(zoned.year, zoned.month - 1, zoned.day, zoned.hour, zoned.minute, zoned.second)
    const diff = targetUtcEquivalent - zonedUtcEquivalent

    if (diff === 0) {
      return guess
    }

    guess = new Date(guess.getTime() + diff)
  }

  const verified = getZonedDateParts(guess, timeZone)
  if (
    verified.year !== year ||
    verified.month !== month ||
    verified.day !== day ||
    verified.hour !== hour ||
    verified.minute !== minute
  ) {
    return null
  }

  return guess
}

export function buildEventPublicationSnapshot(source: EventPublicationSource, now = new Date()): EventPublicationSnapshot {
  const manualActive = Number(source.activo ?? 0) === 1
  const mode = normalizePublicationMode(source.publication_mode)
  const prePublishVisibility = normalizePrePublishVisibility(source.pre_publish_visibility)
  const publishAtUtcDate = normalizeMysqlUtcDate(source.publish_at_utc)
  const publishedLiveAtDate = normalizeMysqlUtcDate(source.published_live_at)
  const publishAtUtc = publishAtUtcDate ? formatUtcDateTimeForSql(publishAtUtcDate) : null
  const publishedLiveAt = publishedLiveAtDate
    ? formatUtcDateTimeForSql(publishedLiveAtDate)
    : publishAtUtcDate && publishAtUtcDate.getTime() <= now.getTime()
      ? formatUtcDateTimeForSql(publishAtUtcDate)
      : null

  if (!manualActive) {
    return {
      publication_status: 'hidden',
      publication_reason: 'manual_inactive',
      is_listed: false,
      is_detail_visible: false,
      is_checkout_open: false,
      publication: {
        mode,
        pre_publish_visibility: prePublishVisibility,
        publish_at_utc: publishAtUtc,
        publish_timezone: typeof source.publish_timezone === 'string' ? source.publish_timezone : null,
        published_live_at: publishedLiveAt,
      },
    }
  }

  const scheduledIsLive =
    mode !== 'scheduled' ||
    !publishAtUtcDate ||
    publishAtUtcDate.getTime() <= now.getTime()

  if (scheduledIsLive) {
    return {
      publication_status: 'live',
      publication_reason: 'live',
      is_listed: true,
      is_detail_visible: true,
      is_checkout_open: true,
      publication: {
        mode,
        pre_publish_visibility: prePublishVisibility,
        publish_at_utc: publishAtUtc,
        publish_timezone: typeof source.publish_timezone === 'string' ? source.publish_timezone : null,
        published_live_at: publishedLiveAt,
      },
    }
  }

  if (prePublishVisibility === 'listado_solo') {
    return {
      publication_status: 'listed',
      publication_reason: 'scheduled_listed',
      is_listed: true,
      is_detail_visible: false,
      is_checkout_open: false,
      publication: {
        mode,
        pre_publish_visibility: prePublishVisibility,
        publish_at_utc: publishAtUtc,
        publish_timezone: typeof source.publish_timezone === 'string' ? source.publish_timezone : null,
        published_live_at: publishedLiveAt,
      },
    }
  }

  if (prePublishVisibility === 'detail_visible') {
    return {
      publication_status: 'listed',
      publication_reason: 'scheduled_detail_visible',
      is_listed: true,
      is_detail_visible: true,
      is_checkout_open: false,
      publication: {
        mode,
        pre_publish_visibility: prePublishVisibility,
        publish_at_utc: publishAtUtc,
        publish_timezone: typeof source.publish_timezone === 'string' ? source.publish_timezone : null,
        published_live_at: publishedLiveAt,
      },
    }
  }

  return {
    publication_status: 'hidden',
    publication_reason: 'scheduled_hidden',
    is_listed: false,
    is_detail_visible: false,
    is_checkout_open: false,
    publication: {
      mode,
      pre_publish_visibility: prePublishVisibility,
      publish_at_utc: publishAtUtc,
      publish_timezone: typeof source.publish_timezone === 'string' ? source.publish_timezone : null,
      published_live_at: publishedLiveAt,
    },
  }
}

export function attachEventPublicationSnapshot<T extends EventPublicationSource>(row: T): T & EventPublicationSnapshot {
  return {
    ...row,
    ...buildEventPublicationSnapshot(row),
  }
}

export type EventPublicationRow = EventPublicationSource & Record<string, unknown>
