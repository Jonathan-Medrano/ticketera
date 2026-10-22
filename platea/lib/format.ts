// Formateadores compartidos para plata, enteros y fechas (es-AR / ARS).
// Fuente única para toda la app — evita los múltiples formatMoney dispersos y
// el formato de moneda inconsistente ("$" a mano vs nada).
//
// ⚠️ POR QUÉ ESTO NO USA `Intl` PARA LAS PALABRAS (leer antes de "simplificar")
// ---------------------------------------------------------------------------
// Estos formateadores corren en el servidor (SSR) y otra vez en el navegador
// (hidratación). Si los dos motores no producen EXACTAMENTE el mismo string,
// React tira un hydration mismatch (#418) y regenera el árbol en el cliente.
//
// Y no lo producen. Medido en producción el 07-ago-2026 en
// ctrlzfiesta.ticketera.com, con la huella de ICU que capturamos en el error:
//
//   formatDateTime  servidor "02/01/2026, 12:04 a. m."  cliente "02/01/2026 00:04"
//   fecha corta     servidor "vie, 2 ene"               cliente "vie, 2 ene."
//
// El teléfono tenía `navigator.language = es-419`: su ICU resuelve `es-AR`
// con reloj de 24h y con punto en la abreviatura del mes. El Node de Vercel lo
// resuelve con 12h y sin punto. Mismo código, distinto resultado.
//
// La regla que sale de eso, y que hay que respetar:
//
//   De `Intl` tomamos SOLO la aritmética de zona horaria (valores NUMÉRICOS,
//   que son iguales en todos los motores). Las palabras, los separadores y el
//   ciclo horario los ponemos nosotros con tablas fijas.
//
// Corolario: NO agregar `month: "short"`, `weekday: "long"`, `hour12`, ni
// `style: "currency"` a un `Intl` cuyo resultado se renderice en un componente
// que hidrate. Si necesitás un formato nuevo, agregalo acá abajo componiendo a
// mano.

const AR_TIMEZONE = "America/Argentina/Buenos_Aires"

// Palabras fijas. Son las que se renderizan; no dependen del motor.
const MESES_ABR = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]
const DIAS_ABR = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"]
const MESES_LARGOS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
]
const DIAS_LARGOS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"]

// Único uso de Intl: proyectar el instante UTC a la hora de pared argentina.
// Todo numérico y en en-US a propósito — así no entra ni una palabra de locale.
// `hourCycle: "h23"` fija 00-23 (sin esto, algunos motores devuelven "24" a
// medianoche y otros "00").
const arClock = new Intl.DateTimeFormat("en-US", {
  timeZone: AR_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
})

type PartesAR = {
  year: number
  month: number // 1-12
  day: number
  hour: number // 0-23
  minute: number
  weekday: number // 0 = domingo
}

function partesAR(d: Date): PartesAR {
  const p: Record<string, string> = {}
  for (const { type, value } of arClock.formatToParts(d)) p[type] = value

  const year = Number(p.year)
  const month = Number(p.month)
  const day = Number(p.day)
  // El día de la semana sale de la fecha de pared AR ya resuelta, con
  // aritmética UTC pura: determinista y sin tocar datos de locale.
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay()

  return { year, month, day, hour: Number(p.hour) % 24, minute: Number(p.minute), weekday }
}

const dos = (n: number) => String(n).padStart(2, "0")

function aFecha(iso: string | Date | null | undefined): Date | null {
  if (!iso) return null
  const d = iso instanceof Date ? iso : new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

// --- Plata y números --------------------------------------------------------
//
// Separador de miles "." y decimal "," (es-AR), compuestos a mano por el mismo
// motivo que las fechas: `Intl.NumberFormat` con `style: "currency"` mete un
// espacio entre el símbolo y el número cuyo codepoint cambió entre versiones de
// CLDR (U+00A0 vs U+202F vs sin espacio). Acá queda clavado en U+00A0, que es
// lo que venía renderizando producción.

const NBSP = " "

function agruparMiles(entero: string): string {
  return entero.replace(/\B(?=(\d{3})+(?!\d))/g, ".")
}

/** Formatea un valor monetario en ARS (es-AR). Devuelve "—" si no es un número finito. */
export function formatMoney(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—"
  const num = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(num)) return "—"

  const negativo = num < 0
  const abs = Math.abs(num)
  // Hasta 2 decimales, y sin decimales cuando es entero (mismo criterio que
  // tenía el Intl anterior: minimumFractionDigits 0 / maximumFractionDigits 2).
  const redondeado = Math.round(abs * 100) / 100
  const entero = Math.trunc(redondeado)
  const centavos = Math.round((redondeado - entero) * 100)

  let cuerpo = agruparMiles(String(entero))
  if (centavos > 0) cuerpo += `,${dos(centavos)}`

  return `${negativo ? "-" : ""}$${NBSP}${cuerpo}`
}

/** Formatea un entero (stock, cantidades) con separadores de miles es-AR. Trunca decimales. */
export function formatInt(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—"
  const num = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(num)) return "—"
  const truncado = Math.trunc(num)
  return `${truncado < 0 ? "-" : ""}${agruparMiles(String(Math.abs(truncado)))}`
}

// --- Fechas -----------------------------------------------------------------
//
// App exclusivamente para Argentina: TODAS las fechas/horas se muestran en hora
// argentina, sin importar la zona horaria del navegador del usuario. Las fechas
// de la DB son timestamptz (instante UTC); acá se proyectan a hora AR.

/** Fecha + hora (dd/mm/aaaa, HH:mm en hora argentina). "—" si es inválida. */
export function formatDateTime(iso: string | Date | null | undefined): string {
  const d = aFecha(iso)
  if (!d) return "—"
  const { year, month, day, hour, minute } = partesAR(d)
  return `${dos(day)}/${dos(month)}/${year}, ${dos(hour)}:${dos(minute)}`
}

/** Solo fecha (dd/mm/aaaa, hora argentina). "—" si es inválida. */
export function formatDate(iso: string | Date | null | undefined): string {
  const d = aFecha(iso)
  if (!d) return "—"
  const { year, month, day } = partesAR(d)
  return `${dos(day)}/${dos(month)}/${year}`
}

/** Solo hora (HH:mm, hora argentina). "—" si es inválida. */
export function formatTime(iso: string | Date | null | undefined): string {
  const d = aFecha(iso)
  if (!d) return "—"
  const { hour, minute } = partesAR(d)
  return `${dos(hour)}:${dos(minute)}`
}

/**
 * Fecha corta con día de la semana: "sáb, 22 ago".
 * Es el formato de las tarjetas de evento del storefront. Existe acá — y no
 * como `toLocaleDateString` suelto en el componente — justamente porque era el
 * que rompía la hidratación (ver cabecera del archivo).
 */
export function formatDateShortWeekday(iso: string | Date | null | undefined): string {
  const d = aFecha(iso)
  if (!d) return "—"
  const { day, month, weekday } = partesAR(d)
  return `${DIAS_ABR[weekday]}, ${day} ${MESES_ABR[month - 1]}`
}

/** Fecha corta sin día de la semana: "22 ago". */
export function formatDateShort(iso: string | Date | null | undefined): string {
  const d = aFecha(iso)
  if (!d) return "—"
  const { day, month } = partesAR(d)
  return `${day} ${MESES_ABR[month - 1]}`
}

/** Fecha corta + hora: "22 ago, 23:30". Para avisos de publicación programada. */
export function formatDateShortTime(iso: string | Date | null | undefined): string {
  const d = aFecha(iso)
  if (!d) return "—"
  const { day, month, hour, minute } = partesAR(d)
  return `${day} ${MESES_ABR[month - 1]}, ${dos(hour)}:${dos(minute)}`
}

/** Solo el mes abreviado: "ago". Para los bloques tipo calendario (día arriba, mes abajo). */
export function formatMesAbr(iso: string | Date | null | undefined): string {
  const d = aFecha(iso)
  if (!d) return "—"
  return MESES_ABR[partesAR(d).month - 1]
}

/** Solo el día del mes con dos dígitos: "22". Compañero de `formatMesAbr`. */
export function formatDiaAR(iso: string | Date | null | undefined): string {
  const d = aFecha(iso)
  if (!d) return "—"
  return dos(partesAR(d).day)
}

/** Fecha larga con día de la semana: "sábado 22 de agosto". Para el detalle de evento. */
export function formatDateLong(iso: string | Date | null | undefined): string {
  const d = aFecha(iso)
  if (!d) return "—"
  const { day, month, weekday } = partesAR(d)
  return `${DIAS_LARGOS[weekday]} ${day} de ${MESES_LARGOS[month - 1]}`
}
