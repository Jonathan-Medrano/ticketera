import { NextRequest, NextResponse } from "next/server"
import { proxyToBackend } from "@/lib/backend-proxy"
import { sanitizeAnnouncementHtml } from "@/lib/tenant-rich-text"

export async function GET(req: NextRequest) {
  return proxyToBackend(req, "/api/platform/landing-announcement")
}

export async function PUT(req: NextRequest) {
  let body: Record<string, unknown> = {}
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 })
  }

  const rawHtml = typeof body.contentHtml === "string" ? body.contentHtml : ""
  const sanitized = sanitizeAnnouncementHtml(rawHtml).trim()

  if (!sanitized) {
    return NextResponse.json({ error: "El contenido no puede estar vacío" }, { status: 400 })
  }

  const animationMode = typeof body.animationMode === "string" && ["static", "marquee_infinite", "marquee_finite"].includes(body.animationMode)
    ? body.animationMode
    : "static"
  const animationSpeed = typeof body.animationSpeed === "string" && ["slow", "normal", "fast"].includes(body.animationSpeed)
    ? body.animationSpeed
    : "normal"
  const rawBg = typeof body.backgroundColor === "string" ? body.backgroundColor.trim() : ""
  const backgroundColor = /^#[0-9a-fA-F]{6}$/.test(rawBg) ? rawBg : null

  const sanitizedBody = {
    contentHtml: sanitized,
    ctaLabel: typeof body.ctaLabel === "string" ? body.ctaLabel.slice(0, 120) : null,
    ctaHref: typeof body.ctaHref === "string" ? body.ctaHref.slice(0, 500) : null,
    active: body.active === true || body.active === "true" || body.active === 1,
    animationMode,
    animationSpeed,
    backgroundColor,
  }

  const proxiedReq = new NextRequest(req.url, {
    method: "PUT",
    headers: req.headers,
    body: JSON.stringify(sanitizedBody),
  })

  return proxyToBackend(proxiedReq, "/api/platform/landing-announcement")
}
