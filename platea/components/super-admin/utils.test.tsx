import assert from "node:assert/strict"
import { test } from "node:test"
import {
  formatPlatformTimestamp,
  formatFeeSummary,
  formatFlowLabel,
  getFeeSourceLabel,
  getPlatformRoleLabel,
  getReadinessLabel,
  isSingletonOnlyRole,
} from "@/components/super-admin/utils"

test("superadmin utils format fee summaries and sources by flow honestly", () => {
  assert.equal(formatFlowLabel("entradas"), "Entradas")
  assert.equal(formatFlowLabel("consumibles"), "Consumibles")

  assert.equal(formatFeeSummary(null), "Sin definir")
  assert.equal(
    formatFeeSummary({
      flow: "entradas",
      configured: true,
      source: "global",
      legacyFallback: null,
      mode: "percentage",
      percentage: 12.5,
      fixedAmount: null,
    }),
    "12,5%"
  )
  assert.equal(
    formatFeeSummary({
      flow: "consumibles",
      configured: true,
      source: "empresa",
      legacyFallback: null,
      mode: "hybrid",
      percentage: 7.5,
      fixedAmount: 3.33,
    }),
    "7,5% + $ 3"
  )

  assert.equal(getFeeSourceLabel(undefined), "Sin configurar")
  assert.equal(
    getFeeSourceLabel({
      flow: "consumibles",
      configured: true,
      source: "empresa",
      legacyFallback: null,
      mode: "fixed",
      percentage: null,
      fixedAmount: 12,
    }),
    "Override empresa"
  )
  assert.equal(
    getFeeSourceLabel({
      flow: "entradas",
      configured: true,
      source: "global",
      legacyFallback: "env_legacy",
      mode: "percentage",
      percentage: 10,
      fixedAmount: null,
    }),
    "Default legacy"
  )
})

test("superadmin utils expose role, readiness and singleton labels", () => {
  assert.equal(getReadinessLabel({ status: "ready_to_sell", reason: null, canSell: true }), "Lista para vender")
  assert.equal(getReadinessLabel({ status: "pending_validation", reason: "missing_marketplace_fee", canSell: false }), "Sin cobros")
  assert.equal(getReadinessLabel({ status: "blocked", reason: "manual_block", canSell: false }), "Sin cobros")
  assert.equal(getReadinessLabel(undefined), "Sin cobros")
  assert.equal(getReadinessLabel({ status: "blocked", reason: "manual_block", canSell: false }, true), "Dado de baja")

  assert.equal(getPlatformRoleLabel("superadmin"), "Superadmin")
  assert.equal(getPlatformRoleLabel("staff"), "Staff platform")
  assert.equal(getPlatformRoleLabel(undefined), "Staff platform")

  assert.equal(isSingletonOnlyRole("superadmin", "superadmin"), true)
  assert.equal(isSingletonOnlyRole("superadmin", null), false)
  assert.equal(isSingletonOnlyRole("staff", "superadmin"), false)

  assert.equal(formatPlatformTimestamp(null, "Pendiente"), "Pendiente")
  assert.match(formatPlatformTimestamp("2026-05-10T12:00:00.000Z", "Pendiente"), /2026|10\/5\/2026/)
})
