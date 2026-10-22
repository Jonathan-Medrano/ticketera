import { NextRequest, NextResponse } from "next/server"
import { revalidateTag } from "next/cache"

// Internal endpoint called from the Express backend when an event's publication
// state changes in a way that could affect the vidriera (home teaser + /eventos).
// Authenticated via the shared INTERNAL_API_SECRET that the backend already uses
// for its dashboard guards. No body needed — the vidriera has no per-tenant slug,
// it aggregates across all empresas, so there's a single cache tag to bust.
export async function POST(req: NextRequest) {
  const expected = process.env.INTERNAL_API_SECRET
  if (!expected) {
    return NextResponse.json({ error: "Revalidation not configured" }, { status: 503 })
  }

  const provided = req.headers.get("x-internal-secret")
  if (provided !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  revalidateTag("vidriera:eventos", "default")

  return NextResponse.json({ ok: true, revalidatedAt: new Date().toISOString() })
}
