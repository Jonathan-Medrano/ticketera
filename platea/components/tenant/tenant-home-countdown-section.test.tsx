import assert from "node:assert/strict"
import test from "node:test"
import { renderToStaticMarkup } from "react-dom/server"
import type { TenantEmpresa } from "@/lib/tenant"
import type { TenantEventoResumen } from "@/lib/tenant"
import type { TenantHomeCountdownSection as TenantHomeCountdownSectionData } from "@/lib/tenant-home-sections"
import TenantProvider from "./tenant-provider"
import {
  TenantHomeCountdownSection,
  arDatetimeLocalToUtcMs,
  computeTimeLeft,
  pickProximoEventoTargetMs,
} from "./tenant-home-countdown-section"

// ---------------------------------------------------------------------------
// arDatetimeLocalToUtcMs — converts a wall-clock `datetime-local` value (always
// Argentina local time, per CLAUDE.md) into the real UTC instant, using the
// fixed -03:00 offset (Argentina never observes DST).
// ---------------------------------------------------------------------------

test("arDatetimeLocalToUtcMs converts a valid datetime-local value using the fixed AR -03:00 offset", () => {
  const result = arDatetimeLocalToUtcMs("2026-07-14T20:30")
  assert.equal(result, Date.UTC(2026, 6, 14, 23, 30, 0))
})

test("arDatetimeLocalToUtcMs returns null for malformed or incomplete input", () => {
  assert.equal(arDatetimeLocalToUtcMs(""), null)
  assert.equal(arDatetimeLocalToUtcMs("not-a-date"), null)
  assert.equal(arDatetimeLocalToUtcMs("2026-07-14"), null) // date-only, no time component
  assert.equal(arDatetimeLocalToUtcMs("14/07/2026 20:30"), null) // wrong separator format
})

test("arDatetimeLocalToUtcMs returns null for a calendar-invalid month", () => {
  assert.equal(arDatetimeLocalToUtcMs("2026-13-01T10:00"), null)
})

test("arDatetimeLocalToUtcMs handles midnight boundary correctly", () => {
  const result = arDatetimeLocalToUtcMs("2026-01-01T00:00")
  assert.equal(result, Date.UTC(2026, 0, 1, 3, 0, 0))
})

test("arDatetimeLocalToUtcMs handles end-of-month / leap-year boundary correctly", () => {
  // 2028 is a leap year -> Feb 29 exists.
  const result = arDatetimeLocalToUtcMs("2028-02-29T23:59")
  assert.equal(result, Date.UTC(2028, 2, 1, 2, 59, 0))
})

test("arDatetimeLocalToUtcMs tolerates surrounding whitespace and a trailing seconds component", () => {
  assert.equal(arDatetimeLocalToUtcMs("  2026-07-14T20:30  "), Date.UTC(2026, 6, 14, 23, 30, 0))
  assert.equal(arDatetimeLocalToUtcMs("2026-07-14T20:30:45"), Date.UTC(2026, 6, 14, 23, 30, 0))
})

// ---------------------------------------------------------------------------
// pickProximoEventoTargetMs — "próximo evento" mode target selection
// ---------------------------------------------------------------------------

function makeEvento(overrides: Partial<TenantEventoResumen> & { id: string }): TenantEventoResumen {
  return {
    nombre: `Evento ${overrides.id}`,
    modo_fecha: "unica",
    publication_status: "live",
    publication_reason: "live",
    is_listed: true,
    is_detail_visible: true,
    is_checkout_open: true,
    publication: {
      mode: "immediate",
      pre_publish_visibility: "detail_visible",
      publish_at_utc: null,
      publish_timezone: null,
      published_live_at: null,
    },
    proxima_fecha: null,
    ...overrides,
  }
}

test("pickProximoEventoTargetMs picks the soonest future event with checkout open among several", () => {
  const now = Date.UTC(2026, 0, 1, 0, 0, 0)
  const eventos: TenantEventoResumen[] = [
    makeEvento({ id: "far", proxima_fecha: new Date(now + 30 * 86_400_000).toISOString(), is_checkout_open: true }),
    makeEvento({ id: "closest", proxima_fecha: new Date(now + 5 * 86_400_000).toISOString(), is_checkout_open: true }),
    makeEvento({ id: "mid", proxima_fecha: new Date(now + 15 * 86_400_000).toISOString(), is_checkout_open: true }),
  ]

  assert.equal(pickProximoEventoTargetMs(eventos, now), now + 5 * 86_400_000)
})

test("pickProximoEventoTargetMs ignores events with checkout closed even if they are the soonest", () => {
  const now = Date.UTC(2026, 0, 1, 0, 0, 0)
  const eventos: TenantEventoResumen[] = [
    makeEvento({ id: "closed-soon", proxima_fecha: new Date(now + 1 * 86_400_000).toISOString(), is_checkout_open: false }),
    makeEvento({ id: "open-later", proxima_fecha: new Date(now + 10 * 86_400_000).toISOString(), is_checkout_open: true }),
  ]

  assert.equal(pickProximoEventoTargetMs(eventos, now), now + 10 * 86_400_000)
})

test("pickProximoEventoTargetMs ignores past events and events without a proxima_fecha", () => {
  const now = Date.UTC(2026, 0, 1, 0, 0, 0)
  const eventos: TenantEventoResumen[] = [
    makeEvento({ id: "past", proxima_fecha: new Date(now - 86_400_000).toISOString(), is_checkout_open: true }),
    makeEvento({ id: "no-date", proxima_fecha: null, is_checkout_open: true }),
    makeEvento({ id: "future", proxima_fecha: new Date(now + 2 * 86_400_000).toISOString(), is_checkout_open: true }),
  ]

  assert.equal(pickProximoEventoTargetMs(eventos, now), now + 2 * 86_400_000)
})

test("pickProximoEventoTargetMs returns null when there are no eligible events", () => {
  const now = Date.UTC(2026, 0, 1, 0, 0, 0)
  assert.equal(pickProximoEventoTargetMs([], now), null)
  assert.equal(
    pickProximoEventoTargetMs(
      [makeEvento({ id: "closed", proxima_fecha: new Date(now + 86_400_000).toISOString(), is_checkout_open: false })],
      now
    ),
    null
  )
})

// ---------------------------------------------------------------------------
// computeTimeLeft — days/hours/minutes/seconds breakdown
// ---------------------------------------------------------------------------

test("computeTimeLeft breaks down a future target into days/hours/minutes/seconds", () => {
  const now = Date.UTC(2026, 0, 1, 0, 0, 0)
  const totalMs = ((2 * 24 + 3) * 3600 + 4 * 60 + 5) * 1000 // 2d 3h 4m 5s
  const result = computeTimeLeft(now + totalMs, now)

  assert.deepEqual(result, { days: 2, hours: 3, minutes: 4, seconds: 5, total: totalMs })
})

test("computeTimeLeft clamps to zero once the target has passed", () => {
  const now = Date.UTC(2026, 0, 1, 0, 0, 0)
  const result = computeTimeLeft(now - 5000, now)

  assert.deepEqual(result, { days: 0, hours: 0, minutes: 0, seconds: 0, total: 0 })
})

// ---------------------------------------------------------------------------
// Component render — SSR/hydration-safety contract: the very first render
// (before the client-only useEffect resolves `now`) must always be the
// loading skeleton, never real digits, regardless of section/eventos props —
// otherwise server and client markup diverge and React throws a hydration
// mismatch (per the component's own inline contract comment).
// ---------------------------------------------------------------------------

const tenantBase: TenantEmpresa = {
  id: "tenant-1",
  nombre: "Club Demo",
  slug: "club-demo",
  logo_url: null,
  color_primario: "#7c3aed",
  color_fondo: "#111827",
  color_texto: "#ffffff",
  mostrar_descripcion_home: true,
  mostrar_tanda_activa_home: true,
  mostrar_badge_stock_home: true,
  mostrar_fecha_home: true,
  mostrar_lugar_home: true,
  mostrar_precio_home: true,
  titulo_eventos_home: "Eventos",
  subtitulo_eventos_home: "Lo mejor",
  cta_eventos_home: "Comprar",
  banner_variant: "full",
  descripcion: "Experiencias en vivo",
  whatsapp: "+54911",
  banners: [],
  home_sections: null,
  faqs: null,
}

function renderCountdown(section: TenantHomeCountdownSectionData, eventos: TenantEventoResumen[] = []) {
  return renderToStaticMarkup(
    <TenantProvider empresa={tenantBase}>
      <TenantHomeCountdownSection section={section} eventos={eventos} />
    </TenantProvider>
  )
}

test("countdown section's first render is always the loading skeleton, never live digits (SSR/hydration safety)", () => {
  const manualSection: TenantHomeCountdownSectionData = {
    id: "cd-1",
    type: "countdown",
    titulo: "Arranca pronto",
    modo: "fecha_manual",
    fecha_manual: "2030-01-01T00:00",
    texto_finalizado: "¡Ya arrancó!",
    visible: true,
  }

  const markup = renderCountdown(manualSection)

  assert.match(markup, /aria-hidden="true"/)
  assert.doesNotMatch(markup, /role="timer"/)
  assert.doesNotMatch(markup, /Arranca pronto/)
})
