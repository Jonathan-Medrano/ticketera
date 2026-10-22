export interface CheckoutEntryData {
  nombre: string
  apellido: string
  dni: string
}

export interface CheckoutCartItem {
  categoriaId: string
  eventoId: string
  eventoNombre: string
  categoriaNombre: string
  precio: number
  cantidad: number
  fechaId?: string
  fechaNombre?: string
  kind?: "item" | "addon"
  addonId?: string
  // Seated events: cada asiento es un CartItem propio con cantidad=1. Sin este
  // campo, dos asientos de la MISMA sección (mismo categoriaId) colisionan en la
  // misma key de estado — ver buildExpandedEntryKey.
  asiento_id?: string
  asiento_fila?: string
  asiento_numero?: number
  asiento_seccion?: string
}

export type ExpandedEntry = CheckoutCartItem & {
  key: string
  index: number
}

export function buildExpandedEntryKey(
  categoriaId: string,
  fechaId: string | undefined,
  asientoId: string | undefined,
  index: number,
) {
  // Mismo criterio que getCartItemKey en cart-helpers.ts: si hay asiento_id, es la
  // parte que distingue la entrada (asientos siempre viajan con cantidad=1, así que
  // "index" solo sería 0 para todos los asientos de una misma sección).
  return `${categoriaId}::${fechaId ?? "sin-fecha"}::${asientoId ?? index}`
}

export function createEmptyDatosEntrada(): CheckoutEntryData {
  return { nombre: "", apellido: "", dni: "" }
}

export function sanitizeDniInput(value: string) {
  return value.replace(/\D/g, "").slice(0, 8)
}

export function isValidDni(value: string) {
  const dni = sanitizeDniInput(value)
  return dni.length >= 6 && dni.length <= 8
}

export function expandCartItems(items: CheckoutCartItem[]): ExpandedEntry[] {
  // Los addons no se expanden en entradas individuales con datos — viajan al backend
  // como un array aparte y no requieren nombre/apellido/DNI por unidad.
  return items
    .filter((item) => item.kind !== "addon")
    .flatMap((item) =>
      Array.from({ length: item.cantidad }, (_, index) => ({
        ...item,
        key: buildExpandedEntryKey(item.categoriaId, item.fechaId, item.asiento_id, index),
        index,
      }))
    )
}

export function syncCheckoutEntryState<T>(
  prev: Record<string, T>,
  nextEntries: ExpandedEntry[],
  createDefault: () => T,
) {
  return Object.fromEntries(
    nextEntries.map((entry) => [entry.key, prev[entry.key] ?? createDefault()])
  )
}

export function removeExpandedEntryState<T>(
  prev: Record<string, T>,
  item: { categoriaId: string; fechaId?: string; cantidad: number; asiento_id?: string },
  removedIndex: number,
) {
  const next: Record<string, T> = {}

  // Asientos: cada uno tiene su propia key (por asiento_id), no un rango
  // 0..cantidad como las categorías normales. Sacar SOLO esa key exacta — un
  // strip por prefijo categoriaId::fechaId:: acá borraría también el estado de
  // los OTROS asientos seleccionados en la misma sección (comparten categoriaId).
  if (item.asiento_id) {
    const targetKey = buildExpandedEntryKey(item.categoriaId, item.fechaId, item.asiento_id, 0)
    for (const [key, value] of Object.entries(prev)) {
      if (key !== targetKey) next[key] = value
    }
    return next
  }

  for (const [key, value] of Object.entries(prev)) {
    if (!key.startsWith(`${item.categoriaId}::${item.fechaId ?? "sin-fecha"}::`)) {
      next[key] = value
    }
  }

  for (let index = 0; index < item.cantidad; index += 1) {
    if (index === removedIndex) continue

    const sourceKey = buildExpandedEntryKey(item.categoriaId, item.fechaId, undefined, index)
    const targetKey = buildExpandedEntryKey(item.categoriaId, item.fechaId, undefined, index > removedIndex ? index - 1 : index)
    const value = prev[sourceKey]

    if (value !== undefined) {
      next[targetKey] = value
    }
  }

  return next
}
