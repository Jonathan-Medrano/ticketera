import assert from "node:assert/strict"
import test from "node:test"

import {
  DASHBOARD_SEARCH_DEBOUNCE_MS,
  createDashboardDebouncedSearchController,
} from "@/lib/use-dashboard-debounced-search"

test("dashboard debounced search keeps typing immediate until idle threshold", () => {
  const controller = createDashboardDebouncedSearchController("")

  controller.input("r", 0)
  assert.equal(controller.value, "r")

  controller.input("ro", 200)
  assert.equal(controller.value, "ro")
  assert.deepEqual(controller.advance(200 + DASHBOARD_SEARCH_DEBOUNCE_MS - 1), [])
  assert.deepEqual(controller.advance(200 + DASHBOARD_SEARCH_DEBOUNCE_MS), ["ro"])
})

test("dashboard debounced search emits only once after the latest change", () => {
  const controller = createDashboardDebouncedSearchController("")

  controller.input("f", 0)
  controller.input("fe", 300)
  controller.input("fer", 600)

  assert.deepEqual(controller.advance(600 + DASHBOARD_SEARCH_DEBOUNCE_MS), ["fer"])
  assert.deepEqual(controller.advance(600 + DASHBOARD_SEARCH_DEBOUNCE_MS + 100), [])
})

test("dashboard debounced search resyncs visible state from external url updates", () => {
  const controller = createDashboardDebouncedSearchController("actual")

  controller.input("borrador", 0)
  assert.equal(controller.value, "borrador")

  controller.syncUrl("compartido")

  assert.equal(controller.value, "compartido")
  assert.deepEqual(controller.advance(DASHBOARD_SEARCH_DEBOUNCE_MS), [])
})

test("dashboard debounced search skips emits when debounced value already matches url", () => {
  const controller = createDashboardDebouncedSearchController("mesa")

  controller.input("mesa", 0)

  assert.deepEqual(controller.advance(DASHBOARD_SEARCH_DEBOUNCE_MS), [])
})
