import assert from "node:assert/strict"
import test from "node:test"

import {
  attemptAdvanceEventoFormStep,
  EVENTO_FORM_STEPS,
  type EventoPublicationDraft,
  getEventoPublicationTimingCopy,
  getNextEventoFormStep,
  getPreviousEventoFormStep,
  shouldShowEventoFormSubmit,
  validatePublicacionStep,
} from "./evento-form-navigation"
import {
  buildInitialPublicationState,
  getBuyerRefundToggleDescription,
  normalizeEventoFormModoFecha,
} from "./evento-form-content"

function buildPublicationDraft(overrides: Partial<EventoPublicationDraft> = {}): EventoPublicationDraft {
  return {
    publication_timing: "immediate",
    pre_publish_visibility: "hidden",
    publish_date_local: "",
    publish_time_local: "",
    publish_timezone: "America/Argentina/Buenos_Aires",
    ...overrides,
  }
}

function buildDraft(overrides: Partial<Parameters<typeof attemptAdvanceEventoFormStep>[1]> = {}) {
  return {
    form: {
      nombre: "Festival de Jazz",
        descripcion: "Demo",
        lugar: "Teatro",
        ciudad: "",
        modo_fecha: "unica" as const,
        imagen_url: "",
        venta_consumibles_habilitada: false,
        buyer_event_refunds_enabled: false,
        tipo_mapa: "libre" as const,
    },
    fechas: [{ id: "1", fecha: "2026-05-20T21:00" }],
    categorias: [{ id: "1", nombre: "General", descripcion: "", imagen_url: "", precio: "2500", stock: "100", tanda_id: "", entradas_por_unidad: "1" }],
    tandas: [],
    usarTandas: false,
    publication: buildPublicationDraft(),
    ...overrides,
  }
}

test("evento form exposes the expected tab order", () => {
  assert.deepEqual(
    EVENTO_FORM_STEPS.map((step) => step.id),
    ["info", "agenda", "venta", "publicacion"]
  )
  assert.equal(getNextEventoFormStep("info"), "agenda")
  assert.equal(getPreviousEventoFormStep("publicacion"), "venta")
})

test("evento form explains when buyer refunds are enabled at event level", () => {
  assert.match(getBuyerRefundToggleDescription(true), /puede recibir solicitudes de reembolso de comprador/i)
  assert.match(getBuyerRefundToggleDescription(false), /no va a mostrar CTA de reembolso/i)
})

test("evento form normalizes legacy pase mode before editing", () => {
  assert.equal(normalizeEventoFormModoFecha("pase"), "unica")
  assert.equal(normalizeEventoFormModoFecha("multiple"), "multiple")
})

test("continuar blocks invalid current step and keeps the same tab active", () => {
  const attempt = attemptAdvanceEventoFormStep(
    "info",
    buildDraft({
      form: {
        nombre: "",
        descripcion: "Demo",
        lugar: "Teatro",
        ciudad: "",
        modo_fecha: "unica",
        imagen_url: "",
        venta_consumibles_habilitada: false,
        buyer_event_refunds_enabled: false,
        tipo_mapa: "libre",
      },
    })
  )

  assert.equal(attempt.advanced, false)
  assert.equal(attempt.nextStep, "info")
  assert.match(attempt.validation.fieldErrors.nombre ?? "", /nombre del evento/i)
})

test("continuar advances sequentially when the current step is valid", () => {
  const attempt = attemptAdvanceEventoFormStep("info", buildDraft())

  assert.equal(attempt.advanced, true)
  assert.equal(attempt.nextStep, "agenda")
  assert.equal(attempt.validation.valid, true)
})

test("venta validation blocks advanced mode without named tandas", () => {
  const attempt = attemptAdvanceEventoFormStep(
    "venta",
    buildDraft({
      usarTandas: true,
      tandas: [{ id: "temp-1", nombre: "", descripcion: "", imagen_url: "", estado: "activa", activa_desde: "" }],
    })
  )

  assert.equal(attempt.advanced, false)
  assert.match(attempt.validation.fieldErrors["tandas.0.nombre"] ?? "", /tanda 1 necesita un nombre/i)
})

test("final step requires date and time when publication is scheduled", () => {
  const validation = validatePublicacionStep(
    buildPublicationDraft({
      publication_timing: "scheduled",
      publish_date_local: "",
      publish_time_local: "",
    })
  )
  const copy = getEventoPublicationTimingCopy("crear")

  assert.equal(validation.valid, false)
  assert.match(validation.fieldErrors.publish_date_local ?? "", /fecha de publicación/i)
  assert.match(validation.fieldErrors.publish_time_local ?? "", /hora de publicación/i)
  assert.match(copy.immediate, /listo para salir al público/i)
  assert.match(copy.scheduled, /default visible es solo en listado/i)
})

test("final submit CTA is only available on the publication step", () => {
  assert.equal(shouldShowEventoFormSubmit("info"), false)
  assert.equal(shouldShowEventoFormSubmit("agenda"), false)
  assert.equal(shouldShowEventoFormSubmit("venta"), false)
  assert.equal(shouldShowEventoFormSubmit("publicacion"), true)
})

test("publication copy branches between create and edit without changing semantics", () => {
  const createCopy = getEventoPublicationTimingCopy("crear")
  const editCopy = getEventoPublicationTimingCopy("editar")

  assert.match(createCopy.immediate, /salir al público/i)
  assert.match(editCopy.immediate, /fecha futura/i)
})

test("new events default pre-publish visibility to hidden until publish", () => {
  const initial = buildInitialPublicationState()

  assert.equal(initial.publication_timing, "immediate")
  assert.equal(initial.pre_publish_visibility, "hidden")
  assert.equal(initial.publish_timezone, "America/Argentina/Buenos_Aires")
})

test("editing a scheduled event hydrates stored publication policy", () => {
  const initial = buildInitialPublicationState({
    id: "evt-1",
    nombre: "Evento",
    modo_fecha: "unica",
    publication: {
      mode: "scheduled",
      pre_publish_visibility: "hidden",
      publish_at_utc: "2026-05-20 23:00:00",
      publish_timezone: "America/Argentina/Buenos_Aires",
      publish_date_local: "2026-05-20",
      publish_time_local: "20:00",
    },
  })

  assert.equal(initial.publication_timing, "scheduled")
  assert.equal(initial.pre_publish_visibility, "hidden")
  assert.equal(initial.publish_date_local, "2026-05-20")
  assert.equal(initial.publish_time_local, "20:00")
})

test("scheduled events can hydrate detail-visible pre-publish mode", () => {
  const initial = buildInitialPublicationState({
    id: "evt-2",
    nombre: "Evento detalle",
    modo_fecha: "unica",
    publication: {
      mode: "scheduled",
      pre_publish_visibility: "detail_visible",
      publish_at_utc: "2026-05-20 23:00:00",
      publish_timezone: "America/Argentina/Buenos_Aires",
      publish_date_local: "2026-05-20",
      publish_time_local: "20:00",
    },
  })

  assert.equal(initial.pre_publish_visibility, "detail_visible")
})
