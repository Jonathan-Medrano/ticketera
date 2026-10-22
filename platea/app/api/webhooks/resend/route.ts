import { type NextRequest, NextResponse } from 'next/server'
import { verifyResendWebhook } from '@/lib/resend-webhook'

export async function POST(req: NextRequest) {
  const result = await verifyResendWebhook(req)

  if (!result.ok) {
    return NextResponse.json({ error: 'Firma inválida' }, { status: 401 })
  }

  const backendUrl = process.env.BACKEND_URL ?? 'http://localhost:3001'
  const secret = process.env.INTERNAL_API_SECRET ?? ''

  try {
    const backendRes = await fetch(`${backendUrl}/api/webhooks/resend`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-secret': secret,
      },
      body: JSON.stringify(result.payload),
    })

    const data = await backendRes.json().catch(() => ({}))
    return NextResponse.json(data, { status: backendRes.status })
  } catch {
    return NextResponse.json({ error: 'Error al procesar webhook' }, { status: 500 })
  }
}
