/**
 * Helpers para presets de rango de fechas usados en filtros y modales de export.
 *
 * Devuelven fechas en formato ISO YYYY-MM-DD para inputs type=date compatibles.
 * Usan la timezone local del browser — para reportes contables eso es lo que el
 * operador espera ("hoy" = hoy en mi zona).
 */

export type DatePreset = {
  id: string
  label: string
  /** Devuelve { desde, hasta } o null si el preset no aplica (poco común). */
  compute: () => { desde: string; hasta: string }
}

function toIsoDate(date: Date): string {
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, "0")
  const dd = String(date.getDate()).padStart(2, "0")
  return `${yyyy}-${mm}-${dd}`
}

function startOfDay(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0)
}

/**
 * Presets compartidos entre filtros del dashboard y modales de export.
 * Orden de aparición = orden lógico para el operador.
 */
export const DASHBOARD_DATE_PRESETS: DatePreset[] = [
  {
    id: "hoy",
    label: "Hoy",
    compute: () => {
      const today = startOfDay(new Date())
      return { desde: toIsoDate(today), hasta: toIsoDate(today) }
    },
  },
  {
    id: "ayer",
    label: "Ayer",
    compute: () => {
      const yesterday = addDays(startOfDay(new Date()), -1)
      return { desde: toIsoDate(yesterday), hasta: toIsoDate(yesterday) }
    },
  },
  {
    id: "ultimos-7-dias",
    label: "Últimos 7 días",
    compute: () => {
      const today = startOfDay(new Date())
      return { desde: toIsoDate(addDays(today, -6)), hasta: toIsoDate(today) }
    },
  },
  {
    id: "ultimos-30-dias",
    label: "Últimos 30 días",
    compute: () => {
      const today = startOfDay(new Date())
      return { desde: toIsoDate(addDays(today, -29)), hasta: toIsoDate(today) }
    },
  },
  {
    id: "este-mes",
    label: "Este mes",
    compute: () => {
      const today = startOfDay(new Date())
      return { desde: toIsoDate(startOfMonth(today)), hasta: toIsoDate(today) }
    },
  },
  {
    id: "mes-anterior",
    label: "Mes anterior",
    compute: () => {
      const today = startOfDay(new Date())
      const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1)
      return { desde: toIsoDate(startOfMonth(lastMonth)), hasta: toIsoDate(endOfMonth(lastMonth)) }
    },
  },
]

/**
 * Dado un rango activo (desde, hasta), devuelve el id del preset que matchea o null.
 * Útil para resaltar el preset activo en el UI.
 */
export function matchActivePreset(desde: string | null, hasta: string | null): string | null {
  if (!desde || !hasta) return null
  for (const preset of DASHBOARD_DATE_PRESETS) {
    const computed = preset.compute()
    if (computed.desde === desde && computed.hasta === hasta) return preset.id
  }
  return null
}
