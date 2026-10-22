import assert from "node:assert/strict"
import test from "node:test"

import { writeDashboardSearchParam } from "@/lib/dashboard-grid-search"

test("dashboard search writer preserves raw spaced values", () => {
  const params = new URLSearchParams()

  writeDashboardSearchParam(params, "busqueda", "rock ")

  assert.equal(params.get("busqueda"), "rock ")
})

test("dashboard search writer deletes trim-empty values", () => {
  const params = new URLSearchParams("busqueda=rock")

  writeDashboardSearchParam(params, "busqueda", "   ")

  assert.equal(params.get("busqueda"), null)
})

test("dashboard search writer keeps leading and inner spaces", () => {
  const params = new URLSearchParams()

  writeDashboardSearchParam(params, "busqueda", "  foo bar")

  assert.equal(params.get("busqueda"), "  foo bar")
})
