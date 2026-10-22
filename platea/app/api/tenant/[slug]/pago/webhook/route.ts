import { NextRequest, NextResponse } from "next/server"
import { proxyToBackend } from "@/lib/backend-proxy"
import { verifyMercadoPagoSignature } from "@/lib/mercadopago-webhook"

export const POST = async (
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) => {
  const { slug } = await params

  const verification = verifyMercadoPagoSignature(req)
  if (!verification.ok) {
    // Log estructurado del intento fallido. No incluimos signature ni body.
    console.info(
      JSON.stringify({
        ts: new Date().toISOString(),
        event: "webhook_signature_failed",
        provider: "mercadopago",
        slug,
        reason: verification.reason,
      }),
    )
    return NextResponse.json({ ok: false, reason: "invalid_signature" }, { status: 401 })
  }

  return proxyToBackend(req, `/api/tenant/${slug}/pago/webhook`, {
    requireAuth: false,
    allowCrossOriginMutation: true,
    extraHeaders: {
      'x-signature': req.headers.get('x-signature') ?? '',
      'x-request-id': req.headers.get('x-request-id') ?? '',
    },
  })
}
