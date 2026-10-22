import { formatMoney } from "@/lib/format"

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Debe coincidir con MAX_CATEGORY_PRICE del backend (validación de categorías de entrada).
const MAX_CATEGORY_PRICE = 10_000_000

export type EventoFormStep = "info" | "agenda" | "venta" | "publicacion"

export type EventoPublicationTiming = "immediate" | "scheduled"

export type EventoPrePublishVisibility = "hidden" | "listado_solo" | "detail_visible"

export type EventoPublicationDraft = {
  publication_timing: EventoPublicationTiming
  pre_publish_visibility: EventoPrePublishVisibility
  publish_date_local: string
  publish_time_local: string
  publish_timezone: string
}

export type EventoFormFechaDraft = {
  id: string
  fecha: string
}

export type EventoFormCategoriaDraft = {
  id: string
  nombre: string
  descripcion: string
  imagen_url: string
  precio: string
  stock: string
  tanda_id: string
  // Pack model: cantidad de QRs que se generan por unidad comprada. Default 1 = entrada normal.
  // Si 2 → "Pack 2x1" (compra 1, recibe 2). String para input HTML.
  entradas_por_unidad: string
}

export type EventoFormTandaDraft = {
  id: string
  nombre: string
  descripcion: string
  imagen_url: string
  estado: "activa" | "proxima" | "inactiva" | "agotada"
  activa_desde: string
}

export type EventoFormCoreState = {
  nombre: string
  descripcion: string
  lugar: string
  ciudad: string
  modo_fecha: "unica" | "multiple"
  imagen_url: string
  venta_consumibles_habilitada: boolean
  buyer_event_refunds_enabled: boolean
  tipo_mapa: "libre" | "numerado"
}

export type EventoFormValidationPayload = {
  form: EventoFormCoreState
  fechas: EventoFormFechaDraft[]
  categorias: EventoFormCategoriaDraft[]
  tandas: EventoFormTandaDraft[]
  usarTandas: boolean
  publication: EventoPublicationDraft
}

export type EventoFormValidationResult = {
  valid: boolean
  errors: string[]
  fieldErrors: Record<string, string>
}

export const EVENTO_FORM_STEPS: Array<{
  id: EventoFormStep
  label: string
  shortLabel: string
  description: string
}> = [
  {
    id: "info",
    label: "Información",
    shortLabel: "Info",
    description: "Datos generales e imagen del evento",
  },
  {
    id: "agenda",
    label: "Agenda",
    shortLabel: "Agenda",
    description: "Fechas y funciones disponibles",
  },
  {
    id: "venta",
    label: "Venta",
    shortLabel: "Venta",
    description: "Categorías, stock y tandas",
  },
  {
    id: "publicacion",
    label: "Publicación",
    shortLabel: "Publicación",
    description: "Refunds, timing y envío final",
  },
]

function buildResult(errors: string[], fieldErrors: Record<string, string>): EventoFormValidationResult {
  return {
    valid: errors.length === 0,
    errors,
    fieldErrors,
  }
}

export function getNextEventoFormStep(step: EventoFormStep): EventoFormStep | null {
  const index = EVENTO_FORM_STEPS.findIndex((candidate) => candidate.id === step)
  if (index === -1 || index === EVENTO_FORM_STEPS.length - 1) return null
  return EVENTO_FORM_STEPS[index + 1]?.id ?? null
}

export function getPreviousEventoFormStep(step: EventoFormStep): EventoFormStep | null {
  const index = EVENTO_FORM_STEPS.findIndex((candidate) => candidate.id === step)
  if (index <= 0) return null
  return EVENTO_FORM_STEPS[index - 1]?.id ?? null
}

export function isFinalEventoFormStep(step: EventoFormStep) {
  return step === "publicacion"
}

export function shouldShowEventoFormSubmit(step: EventoFormStep) {
  return isFinalEventoFormStep(step)
}

export function validateInfoStep(form: EventoFormCoreState): EventoFormValidationResult {
  const errors: string[] = []
  const fieldErrors: Record<string, string> = {}

  if (!form.nombre.trim()) {
    const message = "Ingresá el nombre del evento."
    errors.push(message)
    fieldErrors.nombre = message
  }

  if (!form.modo_fecha) {
    const message = "Elegí cómo se cargan las fechas del evento."
    errors.push(message)
    fieldErrors.modo_fecha = message
  }

  return buildResult(errors, fieldErrors)
}

export function validateAgendaStep(
  form: Pick<EventoFormCoreState, "modo_fecha">,
  fechas: EventoFormFechaDraft[]
): EventoFormValidationResult {
  const errors: string[] = []
  const fieldErrors: Record<string, string> = {}

  if (fechas.length === 0) {
    const message = "Agregá al menos una fecha para continuar."
    errors.push(message)
    fieldErrors.fechas = message
    return buildResult(errors, fieldErrors)
  }

  const emptyIndexes = fechas
    .map((fecha, index) => ({ fecha, index }))
    .filter(({ fecha }) => !fecha.fecha.trim())

  if (emptyIndexes.length > 0) {
    const message =
      form.modo_fecha === "multiple"
        ? "Completá todas las funciones antes de continuar."
        : "Completá la fecha del evento antes de continuar."

    errors.push(message)
    for (const { index } of emptyIndexes) {
      fieldErrors[`fechas.${index}`] = message
    }
  }

  // Client-side UX check only: catches an obviously-past date before submit so the user
  // doesn't have to wait for the server round-trip to find out. The server is the source
  // of truth and re-validates on submit. `fecha.fecha` is a `datetime-local` input value
  // (tz-free per project convention), so we compare it against the current instant.
  // Only checked for NEW dates (no existing UUID id) — mirrors backend's
  // validateFechasNoPasadas, which skips already-persisted dates so editing an
  // already-finished event (e.g. toggling buyer_event_refunds_enabled) doesn't break.
  const now = Date.now()
  const isExistingFecha = (id: string) => UUID_REGEX.test(id)
  const pastIndexes = fechas
    .map((fecha, index) => ({ fecha, index }))
    .filter(
      ({ fecha }) =>
        !isExistingFecha(fecha.id) && fecha.fecha.trim() && new Date(fecha.fecha).getTime() < now
    )

  if (pastIndexes.length > 0) {
    const message = "La fecha del evento no puede ser en el pasado."
    errors.push(message)
    for (const { index } of pastIndexes) {
      fieldErrors[`fechas.${index}`] = message
    }
  }

  return buildResult(errors, fieldErrors)
}

export function validateVentaStep(
  categorias: EventoFormCategoriaDraft[],
  tandas: EventoFormTandaDraft[],
  usarTandas: boolean
): EventoFormValidationResult {
  const errors: string[] = []
  const fieldErrors: Record<string, string> = {}

  if (categorias.length === 0) {
    const message = "Agregá al menos una categoría para vender entradas."
    errors.push(message)
    fieldErrors.categorias = message
  }

  categorias.forEach((categoria, index) => {
    if (!categoria.nombre.trim()) {
      const message = `La categoría ${index + 1} necesita un nombre.`
      errors.push(message)
      fieldErrors[`categorias.${index}.nombre`] = message
    }

    const precioNum = Number(categoria.precio)
    if (categoria.precio === "" || precioNum < 0 || Number.isNaN(precioNum)) {
      const message = `La categoría ${index + 1} necesita un precio válido.`
      errors.push(message)
      fieldErrors[`categorias.${index}.precio`] = message
    } else if (precioNum > MAX_CATEGORY_PRICE) {
      const message = `La categoría ${index + 1}: el precio no puede superar ${formatMoney(MAX_CATEGORY_PRICE)}.`
      errors.push(message)
      fieldErrors[`categorias.${index}.precio`] = message
    }

    const stockNum = Number(categoria.stock)
    if (!categoria.stock || Number.isNaN(stockNum) || stockNum <= 0) {
      const message = `La categoría ${index + 1}: el stock debe ser mayor a 0.`
      errors.push(message)
      fieldErrors[`categorias.${index}.stock`] = message
    } else if (!Number.isInteger(stockNum)) {
      const message = `La categoría ${index + 1}: el stock debe ser un número entero.`
      errors.push(message)
      fieldErrors[`categorias.${index}.stock`] = message
    }
  })

  if (usarTandas) {
    if (tandas.length === 0) {
      const message = "Si activás tandas, creá al menos una antes de continuar."
      errors.push(message)
      fieldErrors.tandas = message
    }

    tandas.forEach((tanda, index) => {
      if (!tanda.nombre.trim()) {
        const message = `La tanda ${index + 1} necesita un nombre.`
        errors.push(message)
        fieldErrors[`tandas.${index}.nombre`] = message
      }
    })

    // Mirror backend validateTandas: at most 1 active tanda, and that tanda must have categories.
    const activas = tandas.filter((t) => t.estado === "activa")
    if (activas.length > 1) {
      const message = "Solo puede haber una tanda activa a la vez."
      errors.push(message)
      fieldErrors.tandas_activas = message
    } else if (activas.length === 1) {
      const activaTanda = activas[0]
      const categoriasDeActiva = categorias.filter((c) => c.tanda_id === activaTanda.id)
      if (categoriasDeActiva.length === 0) {
        const message = `La tanda activa "${activaTanda.nombre.trim() || "sin nombre"}" necesita al menos una categoría asociada.`
        errors.push(message)
        fieldErrors.tanda_activa_sin_categorias = message
      }
    }
  }

  return buildResult([...new Set(errors)], fieldErrors)
}

export function validatePublicacionStep(
  publication: EventoPublicationDraft,
  fechas: EventoFormFechaDraft[] = []
): EventoFormValidationResult {
  if (publication.publication_timing === "scheduled") {
    const errors: string[] = []
    const fieldErrors: Record<string, string> = {}

    if (!publication.publish_date_local.trim()) {
      const message = "Elegí la fecha de publicación."
      errors.push(message)
      fieldErrors.publish_date_local = message
    }

    if (!publication.publish_time_local.trim()) {
      const message = "Elegí la hora de publicación."
      errors.push(message)
      fieldErrors.publish_time_local = message
    }

    if (publication.publish_date_local && publication.publish_time_local) {
      const publishDateStr = `${publication.publish_date_local}T${publication.publish_time_local}`
      const publishDate = new Date(publishDateStr)
      if (publishDate.getTime() <= Date.now()) {
        const message = "La fecha de publicación debe ser en el futuro"
        errors.push(message)
        fieldErrors.publish_date_local = message
      } else {
        // La publicación programada no puede caer después de la fecha (más temprana) del
        // evento — si no, el evento nunca llega a estar "vivo" antes de haber pasado.
        // `fecha.fecha` son valores `datetime-local` (tz-free), igual que publish_date/time_local,
        // así que la comparación entre ambos naive Date es consistente.
        const fechaTimestamps = fechas
          .map((f) => new Date(f.fecha).getTime())
          .filter((t) => Number.isFinite(t))

        if (fechaTimestamps.length > 0) {
          const earliestFecha = Math.min(...fechaTimestamps)
          if (publishDate.getTime() > earliestFecha) {
            const message = "La publicación no puede programarse después de la fecha del evento."
            errors.push(message)
            fieldErrors.publish_date_local = message
          }
        }
      }
    }

    return buildResult(errors, fieldErrors)
  }

  return buildResult([], {})
}

export function validateEventoFormStep(
  step: EventoFormStep,
  payload: EventoFormValidationPayload
): EventoFormValidationResult {
  switch (step) {
    case "info":
      return validateInfoStep(payload.form)
    case "agenda":
      return validateAgendaStep(payload.form, payload.fechas)
    case "venta":
      return validateVentaStep(payload.categorias, payload.tandas, payload.usarTandas)
    case "publicacion":
      return validatePublicacionStep(payload.publication, payload.fechas)
  }
}

export function attemptAdvanceEventoFormStep(
  currentStep: EventoFormStep,
  payload: EventoFormValidationPayload
): {
  advanced: boolean
  nextStep: EventoFormStep | null
  validation: EventoFormValidationResult
} {
  const validation = validateEventoFormStep(currentStep, payload)
  if (!validation.valid) {
    return {
      advanced: false,
      nextStep: currentStep,
      validation,
    }
  }

  return {
    advanced: true,
    nextStep: getNextEventoFormStep(currentStep),
    validation,
  }
}

export function getEventoPublicationTimingCopy(modo: "crear" | "editar") {
  return {
    immediate:
      modo === "crear"
        ? "El evento queda listo para salir al público apenas esté operativo."
        : "Guardás el evento para que siga publicándose sin esperar una fecha futura.",
    scheduled:
      "Definís fecha, hora y si querés mostrarlo antes de publicar. Si activás visibilidad previa, el default visible es solo en listado y el checkout sigue cerrado hasta la publicación real.",
  }
}
