import assert from "node:assert/strict"
import test from "node:test"

import { expandCartItems, isValidDni, removeExpandedEntryState, sanitizeDniInput, syncCheckoutEntryState } from "./checkout-entry-state"

test("checkout expands aggregated cart items into individual entry rows", () => {
  const expanded = expandCartItems([
    {
      categoriaId: "cat-1",
      eventoId: "evt-1",
      eventoNombre: "Festival",
      categoriaNombre: "General",
      precio: 12000,
      cantidad: 2,
    },
  ])

  assert.deepEqual(expanded.map((entry) => entry.key), [
    "cat-1::sin-fecha::0",
    "cat-1::sin-fecha::1",
  ])
})

test("checkout removal keeps later form data aligned after removing one ticket", () => {
  const prev = {
    "cat-1::sin-fecha::0": { nombre: "Ana" },
    "cat-1::sin-fecha::1": { nombre: "Beto" },
    "cat-1::sin-fecha::2": { nombre: "Carla" },
    "cat-2::sin-fecha::0": { nombre: "Otro" },
  }

  assert.deepEqual(
    removeExpandedEntryState(prev, { categoriaId: "cat-1", cantidad: 3 }, 1),
    {
      "cat-1::sin-fecha::0": { nombre: "Ana" },
      "cat-1::sin-fecha::1": { nombre: "Carla" },
      "cat-2::sin-fecha::0": { nombre: "Otro" },
    }
  )
})

test("checkout state sync adds missing entry keys and drops removed ones", () => {
  const synced = syncCheckoutEntryState(
    { "cat-1::sin-fecha::0": { nombre: "Ana" }, stale: { nombre: "Viejo" } },
    expandCartItems([
      {
        categoriaId: "cat-1",
        eventoId: "evt-1",
        eventoNombre: "Festival",
        categoriaNombre: "General",
        precio: 12000,
        cantidad: 2,
      },
    ]),
    () => ({ nombre: "" })
  )

  assert.deepEqual(synced, {
    "cat-1::sin-fecha::0": { nombre: "Ana" },
    "cat-1::sin-fecha::1": { nombre: "" },
  })
})

test("checkout DNI sanitizes to digits and enforces 6 to 8 digits", () => {
  assert.equal(sanitizeDniInput("12.345.678-9"), "12345678")
  assert.equal(isValidDni("12345"), false)
  assert.equal(isValidDni("123456"), true)
  assert.equal(isValidDni("12345678"), true)
  assert.equal(isValidDni("123456789"), true)
})

// Regression: two seats from the SAME section (same categoriaId) used to collide
// on `${categoriaId}::${fechaId}::0` because each seat is a separate cart item
// with cantidad=1 — see buildExpandedEntryKey / expandCartItems.
test("checkout expands two seats from the same section into distinct keys", () => {
  const expanded = expandCartItems([
    {
      categoriaId: "seccion-vip",
      eventoId: "evt-1",
      eventoNombre: "Teatro",
      categoriaNombre: "Fila A — Asiento 1",
      precio: 5000,
      cantidad: 1,
      asiento_id: "asiento-a1",
    },
    {
      categoriaId: "seccion-vip",
      eventoId: "evt-1",
      eventoNombre: "Teatro",
      categoriaNombre: "Fila A — Asiento 2",
      precio: 5000,
      cantidad: 1,
      asiento_id: "asiento-a2",
    },
  ])

  const keys = expanded.map((entry) => entry.key)
  assert.equal(new Set(keys).size, 2, "seat keys must not collide")
  assert.deepEqual(keys, [
    "seccion-vip::sin-fecha::asiento-a1",
    "seccion-vip::sin-fecha::asiento-a2",
  ])
})

// Regression: removing one seat must not wipe the sibling seat's entered data —
// a prefix-based strip (categoriaId::fechaId::) would nuke both since they share
// the same categoriaId (the section).
test("checkout removal of one seat preserves the sibling seat's data in the same section", () => {
  const prev = {
    "seccion-vip::sin-fecha::asiento-a1": { nombre: "Ana" },
    "seccion-vip::sin-fecha::asiento-a2": { nombre: "Beto" },
  }

  const next = removeExpandedEntryState(
    prev,
    { categoriaId: "seccion-vip", cantidad: 1, asiento_id: "asiento-a1" },
    0
  )

  assert.deepEqual(next, {
    "seccion-vip::sin-fecha::asiento-a2": { nombre: "Beto" },
  })
})
