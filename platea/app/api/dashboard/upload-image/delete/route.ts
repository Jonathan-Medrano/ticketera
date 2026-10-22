import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { isSameOriginMutationAllowed } from "@/lib/csrf-origin"
import {
  SUPABASE_STORAGE_BUCKET,
  extractPathFromPublicUrl,
  getSupabaseServerClient,
} from "@/lib/supabase-storage"

export const runtime = "nodejs"

export async function POST(req: NextRequest) {
  if (!isSameOriginMutationAllowed(req)) {
    return NextResponse.json({ error: "Origen inválido" }, { status: 403 })
  }

  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  }

  const userType = session.user.userType
  if (userType !== "empresa" && userType !== "empleado") {
    return NextResponse.json({ error: "Solo cuentas empresa pueden eliminar imágenes" }, { status: 403 })
  }

  let body: { url?: unknown } = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 })
  }

  const url = typeof body.url === "string" ? body.url.trim() : ""
  if (!url) {
    return NextResponse.json({ error: 'Falta el campo "url"' }, { status: 400 })
  }

  const path = extractPathFromPublicUrl(url)
  if (!path) {
    // URL externa (no Supabase) — nada que limpiar, responder idempotente
    return NextResponse.json({ data: { deleted: false, reason: "not_supabase_url" } }, { status: 200 })
  }

  // Validación crítica de ownership: el primer segmento del path debe pertenecer
  // a la empresa del session. Sin esto, empresa A podría borrar imágenes de empresa B.
  const firstSegment = path.split("/")[0]
  const empresaSlug = session.user.empresa_slug ?? session.user.slug ?? null
  const empresaId = session.user.empresa_id ?? session.user.id ?? null

  const allowedSegments = new Set<string>()
  if (empresaSlug) allowedSegments.add(empresaSlug)
  if (empresaId) allowedSegments.add(String(empresaId))

  if (!allowedSegments.has(firstSegment)) {
    return NextResponse.json(
      { error: "No tenés permiso para eliminar esta imagen" },
      { status: 403 },
    )
  }

  const client = getSupabaseServerClient()
  if (!client) {
    return NextResponse.json({ error: "Storage no configurado" }, { status: 503 })
  }

  const { error: deleteError } = await client.storage
    .from(SUPABASE_STORAGE_BUCKET)
    .remove([path])

  if (deleteError) {
    console.error("[upload-image:delete] supabase delete failed", {
      empresa_id: empresaId,
      path,
      errorName: deleteError.name ?? "unknown",
    })
    // Idempotente: si ya no existía o falló silenciosamente, no exponemos detalles
    return NextResponse.json({ data: { deleted: false } }, { status: 200 })
  }

  console.info(
    JSON.stringify({
      ts: new Date().toISOString(),
      event: "image_deleted",
      empresa_id: empresaId,
      path,
    }),
  )

  return NextResponse.json({ data: { deleted: true } }, { status: 200 })
}
