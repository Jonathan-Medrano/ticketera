import assert from "node:assert/strict"
import test from "node:test"

import {
  buildInitialConsumibleResolutionDrafts,
  buildConsumiblesResolutionPayload,
  isConsumibleResolutionComplete,
  updateConsumibleUnitStatus,
} from "./consumibles-canjear-helpers"

const previewItems = [
  { venta_item_id: "item-1", nombre: "Cerveza", cantidad: 2, precio_unitario: 300, subtotal: 600 },
  { venta_item_id: "item-2", nombre: "Papas", cantidad: 1, precio_unitario: 400, subtotal: 400 },
]

test("resolution drafts start unresolved and require explicit unit decision", () => {
  const drafts = buildInitialConsumibleResolutionDrafts(previewItems)

  assert.deepEqual(drafts, [
    {
      venta_item_id: "item-1",
      cantidad_total: 2,
      cantidad_entregada: 0,
      cantidad_reembolsada: 0,
      status: "mixed",
      units: [
        { id: "item-1-1", status: null },
        { id: "item-1-2", status: null },
      ],
    },
    {
      venta_item_id: "item-2",
      cantidad_total: 1,
      cantidad_entregada: 0,
      cantidad_reembolsada: 0,
      status: "mixed",
      units: [{ id: "item-2-1", status: null }],
    },
  ])

  assert.equal(isConsumibleResolutionComplete(drafts), false)
})

test("updating unit status derives delivered, refunded, and mixed line states", () => {
  const firstPass = updateConsumibleUnitStatus(buildInitialConsumibleResolutionDrafts(previewItems), "item-1", "item-1-1", "delivered")
  const updated = updateConsumibleUnitStatus(firstPass, "item-1", "item-1-2", "refunded")

  assert.deepEqual(updated[0], {
    venta_item_id: "item-1",
    cantidad_total: 2,
    cantidad_entregada: 1,
    cantidad_reembolsada: 1,
    status: "mixed",
    units: [
      { id: "item-1-1", status: "delivered" },
      { id: "item-1-2", status: "refunded" },
    ],
  })

  const refunded = updateConsumibleUnitStatus(updated, "item-1", "item-1-1", "refunded")
  assert.equal(refunded[0]?.status, "refunded")

  const complete = updateConsumibleUnitStatus(refunded, "item-2", "item-2-1", "delivered")
  assert.equal(isConsumibleResolutionComplete(complete), true)
})

test("resolution payload only sends delivered and refunded quantities per venta item", () => {
  const payload = buildConsumiblesResolutionPayload(
    updateConsumibleUnitStatus(
      updateConsumibleUnitStatus(
        updateConsumibleUnitStatus(buildInitialConsumibleResolutionDrafts(previewItems), "item-1", "item-1-1", "delivered"),
        "item-1",
        "item-1-2",
        "refunded"
      ),
      "item-2",
      "item-2-1",
      "delivered"
    )
  )

  assert.deepEqual(payload, [
    { venta_item_id: "item-1", cantidad_entregada: 1, cantidad_reembolsada: 1, resolution_reason: "stock_shortage" },
    { venta_item_id: "item-2", cantidad_entregada: 1, cantidad_reembolsada: 0 },
  ])
})
