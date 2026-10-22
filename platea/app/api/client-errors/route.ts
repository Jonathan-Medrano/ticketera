import { NextRequest, NextResponse } from "next/server"

const BACKEND_URL = process.env.BACKEND_URL
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET

// Public BFF — no auth required. Anonymous visitors (tenant buyers) and
// internal users (dashboard, super-admin) can all hit this. Backend enforces
// rate limit by IP via persistent-rate-limit.
export async function POST(req: NextRequest) {
  if (!BACKEND_URL || !INTERNAL_SECRET) {
    // Backend not configured — swallow the report client-side rather than 500.
    return new NextResponse(null, { status: 204 })
  }

  let body: unknown = null
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "JSON body inválido" }, { status: 400 })
  }

  // Forward to backend with internal secret. Best-effort: if backend is down
  // we don't surface that to the browser — it's just lost telemetry.
  try {
    const forwardedFor = req.headers.get("x-forwarded-for") ?? null
    const userAgent = req.headers.get("user-agent") ?? null

    const fwd = await fetch(`${BACKEND_URL}/api/client-errors`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-secret": INTERNAL_SECRET,
        ...(forwardedFor ? { "x-forwarded-for": forwardedFor } : {}),
        ...(userAgent ? { "user-agent": userAgent } : {}),
      },
      body: JSON.stringify(body),
      cache: "no-store",
    })

    if (fwd.status === 429) {
      return new NextResponse(null, { status: 204 })
    }
    return new NextResponse(null, { status: fwd.ok ? 204 : 502 })
  } catch {
    return new NextResponse(null, { status: 204 })
  }
}
