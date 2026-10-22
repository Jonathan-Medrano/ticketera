import assert from "node:assert/strict"
import test from "node:test"

import type { CartItem } from "./cart-provider"
import { addCartItem, removeCartItem, removeCartItemUnit } from "./cart-helpers"

const baseItem: CartItem = {
  categoriaId: "cat-1",
  eventoId: "evt-1",
  eventoNombre: "Festival",
  categoriaNombre: "General",
  precio: 10000,
  cantidad: 1,
}

test("cart provider decrements only one entry for matching category/date", () => {
  const items = addCartItem([baseItem], { ...baseItem, cantidad: 2 })

  assert.deepEqual(removeCartItemUnit(items, "cat-1"), [{ ...baseItem, cantidad: 2 }])
})

test("cart provider removes the whole line only when quantity reaches zero", () => {
  assert.deepEqual(removeCartItemUnit([baseItem], "cat-1"), [])
})

test("cart provider keeps other dates and categories untouched", () => {
  const items: CartItem[] = [
    { ...baseItem, cantidad: 2, fechaId: "fecha-1", fechaNombre: "Viernes" },
    { ...baseItem, categoriaId: "cat-2", categoriaNombre: "VIP", fechaId: "fecha-1", fechaNombre: "Viernes" },
    { ...baseItem, fechaId: "fecha-2", fechaNombre: "Sábado" },
  ]

  assert.deepEqual(removeCartItem(items, "cat-1", "fecha-1"), [items[1], items[2]])
  assert.deepEqual(removeCartItemUnit(items, "cat-1", "fecha-1"), [{ ...items[0], cantidad: 1 }, items[1], items[2]])
})
