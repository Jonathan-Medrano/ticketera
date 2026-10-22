import crypto from "node:crypto"
import { NextRequest } from "next/server"

const SIGNATURE_HEADER = "x-signature"
const REQUEST_ID_HEADER = "x-request-id"
const MAX_TIMESTAMP_SKEW_MS = 5 * 60 * 1000

let warnedMissingSecret = false

export type MercadoPagoSignatureResult =
  | { ok: true; mode: "verified" }
  | { ok: true; mode: "skipped"; reason: "secret_not_configured" }
  | { ok: false; reason: "missing_signature" | "malformed_signature" | "missing_request_id" | "missing_data_id" | "expired_timestamp" | "invalid_signature" }

function parseSignatureHeader(value: string): { ts: string | null; v1: string | null } {
  const parts = value.split(",").map((p) => p.trim())
  let ts: string | null = null
  let v1: string | null = null
  for (const part of parts) {
    const [key, ...rest] = part.split("=")
    const val = rest.join("=")
    if (key === "ts") ts = val
    if (key === "v1") v1 = val
  }
  return { ts, v1 }
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  try {
    return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"))
  } catch {
    return false
  }
}

/**
 * Valida la firma HMAC-SHA256 de un webhook de Mercado Pago contra el secret
 * configurado en MERCADOPAGO_WEBHOOK_SECRET. Si el secret no está configurado,
 * loguea warning una vez y permite el request (modo dev).
 *
 * Template oficial: `id:<data.id>;request-id:<X-Request-Id>;ts:<ts>;`
 * Header esperado: `x-signature: ts=TS,v1=HMAC_HEX`
 */
export function verifyMercadoPagoSignature(req: NextRequest): MercadoPagoSignatureResult {
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET?.trim()

  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('MERCADOPAGO_WEBHOOK_SECRET is required in production')
    }
    if (!warnedMissingSecret) {
      warnedMissingSecret = true
      if (typeof console !== "undefined") {
        console.warn(
          "[mercadopago-webhook] MERCADOPAGO_WEBHOOK_SECRET no está configurado. " +
            "Los webhooks NO están validando firma — configuralo en producción.",
        )
      }
    }
    return { ok: true, mode: "skipped", reason: "secret_not_configured" }
  }

  const signatureHeader = req.headers.get(SIGNATURE_HEADER)
  if (!signatureHeader) {
    return { ok: false, reason: "missing_signature" }
  }

  const { ts, v1 } = parseSignatureHeader(signatureHeader)
  if (!ts || !v1) {
    return { ok: false, reason: "malformed_signature" }
  }

  const tsMs = Number(ts) * (ts.length <= 10 ? 1000 : 1)
  if (!Number.isFinite(tsMs) || Math.abs(Date.now() - tsMs) > MAX_TIMESTAMP_SKEW_MS) {
    return { ok: false, reason: "expired_timestamp" }
  }

  const requestId = req.headers.get(REQUEST_ID_HEADER)
  if (!requestId) {
    return { ok: false, reason: "missing_request_id" }
  }

  const dataId = req.nextUrl.searchParams.get("data.id") || req.nextUrl.searchParams.get("id")
  if (!dataId) {
    return { ok: false, reason: "missing_data_id" }
  }

  const template = `id:${dataId};request-id:${requestId};ts:${ts};`
  const expected = crypto.createHmac("sha256", secret).update(template).digest("hex")

  if (!timingSafeEqualHex(expected, v1)) {
    return { ok: false, reason: "invalid_signature" }
  }

  return { ok: true, mode: "verified" }
}
