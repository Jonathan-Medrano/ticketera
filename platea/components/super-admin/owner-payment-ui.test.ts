import assert from "node:assert/strict"
import { test } from "node:test"
import { buildOwnerPaymentUiModel, getOwnerOauthBanner } from "./owner-payment-ui"

test("owner payment UI makes OAuth the primary connection path", () => {
  const ui = buildOwnerPaymentUiModel(null)

  assert.equal(ui.primaryAction.label, "Conectar Mercado Pago")
  assert.equal(ui.primaryAction.mode, "oauth")
  assert.equal(ui.primaryAction.requiresManualToken, false)
  assert.equal(ui.connectionModeLabel, "Sin conexión")
  assert.equal(ui.showLegacyManualBanner, false)
})

test("owner payment UI keeps reconnect and legacy banner behavior without restoring manual as primary", () => {
  const oauthUi = buildOwnerPaymentUiModel({
    id: "owner-oauth",
    provider: "mercadopago",
    status: "ready_to_sell",
    reason: null,
    credentialLast4: "1234",
    providerAccountLabel: "Owner OAuth",
    connectionMode: "oauth",
    oauthConnectedAt: "2026-05-10T10:00:00.000Z",
    validatedAt: "2026-05-10T10:00:00.000Z",
    blockedAt: null,
    updatedAt: "2026-05-10T10:00:00.000Z",
  })

  assert.equal(oauthUi.primaryAction.label, "Reconectar Mercado Pago")
  assert.equal(oauthUi.primaryAction.mode, "oauth")
  assert.equal(oauthUi.primaryAction.requiresManualToken, false)
  assert.equal(oauthUi.connectionModeLabel, "OAuth")
  assert.equal(oauthUi.showLegacyManualBanner, false)

  const legacyUi = buildOwnerPaymentUiModel({
    id: "owner-manual",
    provider: "mercadopago",
    status: "pending_validation",
    reason: "validation_pending",
    credentialLast4: "5678",
    providerAccountLabel: "Owner Legacy",
    connectionMode: "manual",
    oauthConnectedAt: null,
    validatedAt: null,
    blockedAt: null,
    updatedAt: "2026-05-10T10:00:00.000Z",
  })

  assert.equal(legacyUi.primaryAction.label, "Reconectar Mercado Pago")
  assert.equal(legacyUi.primaryAction.mode, "oauth")
  assert.equal(legacyUi.primaryAction.requiresManualToken, false)
  assert.equal(legacyUi.connectionModeLabel, "Manual legacy")
  assert.equal(legacyUi.showLegacyManualBanner, true)
})

test("owner oauth banner exposes success and guarded error copy", () => {
  assert.deepEqual(getOwnerOauthBanner({ status: "connected" }), {
    tone: "success",
    text: "Mercado Pago owner quedó conectado correctamente. La plataforma ya usa OAuth como camino principal.",
  })

  assert.deepEqual(getOwnerOauthBanner({ status: "error", reason: "state_mismatch" }), {
    tone: "error",
    text: "La validación de seguridad del OAuth no coincidió. Reintentá la conexión.",
  })

  assert.deepEqual(getOwnerOauthBanner({ status: "error", reason: "oauth_exchange_failed" }), {
    tone: "error",
    text: "Mercado Pago no permitió completar la autorización owner. Reintentá la conexión.",
  })
})
