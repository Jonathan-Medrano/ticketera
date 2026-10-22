export interface CartItemSnapshot {
  categoriaId: string
  fechaId?: string
  cantidad: number
  // Seated events: asiento_id makes each seat a unique cart line
  asiento_id?: string
}

export function getCartItemKey(categoriaId: string, fechaId?: string, asientoId?: string) {
  if (asientoId) return `asiento::${asientoId}`
  return `${categoriaId}::${fechaId ?? "sin-fecha"}`
}

export function addCartItem<T extends CartItemSnapshot>(items: T[], item: T) {
  const itemKey = getCartItemKey(item.categoriaId, item.fechaId, item.asiento_id)
  const existing = items.find(
    (entry) => getCartItemKey(entry.categoriaId, entry.fechaId, entry.asiento_id) === itemKey,
  )

  if (!existing) {
    return [...items, item]
  }

  // Seated items are always quantity=1 and should not aggregate
  if (item.asiento_id) return items

  return items.map((entry) =>
    getCartItemKey(entry.categoriaId, entry.fechaId, entry.asiento_id) === itemKey
      ? { ...entry, cantidad: entry.cantidad + item.cantidad }
      : entry,
  )
}

export function removeCartItem<T extends CartItemSnapshot>(
  items: T[],
  categoriaId: string,
  fechaId?: string,
  asientoId?: string,
) {
  const itemKey = getCartItemKey(categoriaId, fechaId, asientoId)
  return items.filter(
    (entry) => getCartItemKey(entry.categoriaId, entry.fechaId, entry.asiento_id) !== itemKey,
  )
}

export function removeCartItemUnit<T extends CartItemSnapshot>(
  items: T[],
  categoriaId: string,
  fechaId?: string,
  asientoId?: string,
) {
  const itemKey = getCartItemKey(categoriaId, fechaId, asientoId)

  return items.flatMap((entry) => {
    if (getCartItemKey(entry.categoriaId, entry.fechaId, entry.asiento_id) !== itemKey) {
      return [entry]
    }

    if (entry.cantidad <= 1) {
      return []
    }

    return [{ ...entry, cantidad: entry.cantidad - 1 }]
  })
}
