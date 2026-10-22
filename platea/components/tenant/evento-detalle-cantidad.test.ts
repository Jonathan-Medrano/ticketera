import assert from "node:assert/strict"
import test from "node:test"

import { normalizarCantidadTipeada } from "./evento-detalle-sections"

// El comprador puede escribir cualquier cosa en el campo de cantidad. Esto es
// lo que decide que numero termina saliendo, y de ahi sale el delta que se le
// pasa al handler que descuenta stock: si aca entra basura, entra basura al
// carrito.

test("toma el numero tipeado", () => {
  assert.equal(normalizarCantidadTipeada("10", 50), 10)
  assert.equal(normalizarCantidadTipeada("1", 50), 1)
})

test("vacio es cero (no NaN)", () => {
  assert.equal(normalizarCantidadTipeada("", 50), 0)
  assert.equal(normalizarCantidadTipeada("   ", 50), 0)
})

test("descarta lo que no sea digito", () => {
  assert.equal(normalizarCantidadTipeada("1a0", 50), 10)
  assert.equal(normalizarCantidadTipeada("abc", 50), 0)
  assert.equal(normalizarCantidadTipeada("-5", 50), 5, "el signo se descarta, no queda negativo")
  assert.equal(normalizarCantidadTipeada("2.5", 50), 25, "no hay fracciones de entrada")
})

test("nunca supera el maximo disponible", () => {
  assert.equal(normalizarCantidadTipeada("9999", 10), 10)
  assert.equal(normalizarCantidadTipeada("11", 10), 10)
  assert.equal(normalizarCantidadTipeada("10", 10), 10)
})

test("con stock cero no deja pedir nada", () => {
  assert.equal(normalizarCantidadTipeada("5", 0), 0)
})

test("un max negativo no genera cantidades negativas", () => {
  // defensivo: si alguna vez llega stock negativo por un bug de datos, el
  // comprador no puede terminar con una cantidad negativa en el carrito.
  assert.equal(normalizarCantidadTipeada("5", -3), 0)
})

test("nunca devuelve NaN ni decimales", () => {
  for (const raw of ["", "abc", "1e3", "٣", "10.9", "-", "+"]) {
    const r = normalizarCantidadTipeada(raw, 20)
    assert.ok(Number.isInteger(r), `"${raw}" devolvio ${r}, que no es entero`)
    assert.ok(r >= 0 && r <= 20, `"${raw}" devolvio ${r}, fuera de rango`)
  }
})
