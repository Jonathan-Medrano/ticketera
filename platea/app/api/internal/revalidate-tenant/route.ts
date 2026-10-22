import { NextRequest, NextResponse } from "next/server"
import { revalidatePath, revalidateTag } from "next/cache"

// Internal endpoint called from the Express backend when a tenant-visible
// mutation succeeds (branding edits, public-status toggle, suspension,
// etc.). Authenticated via the shared INTERNAL_API_SECRET that the backend
// already uses for its dashboard guards.
//
// Body: { slug: string }
// Effect: revalidates /t/[slug] at the layout level so all tenant pages
// (home, evento, checkout, mis-tickets, etc.) refetch their server data
// on the next request — no time-based wait.
export async function POST(req: NextRequest) {
  const expected = process.env.INTERNAL_API_SECRET
  if (!expected) {
    return NextResponse.json({ error: "Revalidation not configured" }, { status: 503 })
  }

  const provided = req.headers.get("x-internal-secret")
  if (provided !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: { slug?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const slug = typeof body.slug === "string" ? body.slug.trim() : ""
  if (!slug) {
    return NextResponse.json({ error: "slug is required" }, { status: 400 })
  }

  // Tag invalidates the underlying fetch() Data Cache entries; path invalidates
  // the rendered Full Route Cache. Both are needed because revalidatePath alone
  // does not consistently bust the Data Cache for fetches that opt in via
  // `next: { revalidate }`.
  revalidateTag(`tenant:${slug}`, "default")
  revalidatePath(`/t/${slug}`, "layout")

  return NextResponse.json({ ok: true, slug, revalidatedAt: new Date().toISOString() })
}
