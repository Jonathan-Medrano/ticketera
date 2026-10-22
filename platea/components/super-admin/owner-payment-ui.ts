import type { PlatformOwnerPaymentAccount } from "./types"

export type OAuthFlash = {
  status?: string
  reason?: string
}

export type OwnerPaymentUiModel = {
  primaryAction: {
    label: string
    mode: "oauth"
    requiresManualToken: false
  }
  connectionModeLabel: string
  showLegacyManualBanner: boolean
}

export function getOwnerOauthBanner(flash?: OAuthFlash) {
  if (flash?.status === "connected") {
    return {
      tone: "success" as const,
      text: "Mercado Pago owner quedó conectado correctamente. La plataforma ya usa OAuth como camino principal.",
    }
  }

  if (flash?.status === "error") {
    const reason = flash.reason
    return {
      tone: "error" as const,
      text:
        reason === "sin_permiso"
          ? "No tenés permiso para conectar la cuenta owner."
          : reason === "state_mismatch"
            ? "La validación de seguridad del OAuth no coincidió. Reintentá la conexión."
            : reason === "oauth_exchange_failed"
              ? "Mercado Pago no permitió completar la autorización owner. Reintentá la conexión."
              : "No se pudo completar la conexión owner con Mercado Pago.",
    }
  }

  return null
}

export function buildOwnerPaymentUiModel(ownerPayment: PlatformOwnerPaymentAccount): OwnerPaymentUiModel {
  return {
    primaryAction: {
      label: ownerPayment ? "Reconectar Mercado Pago" : "Conectar Mercado Pago",
      mode: "oauth",
      requiresManualToken: false,
    },
    connectionModeLabel: !ownerPayment ? "Sin conexión" : ownerPayment.connectionMode === "manual" ? "Manual legacy" : "OAuth",
    showLegacyManualBanner: ownerPayment?.connectionMode === "manual",
  }
}
