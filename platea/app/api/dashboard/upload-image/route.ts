import { randomUUID } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { isSameOriginMutationAllowed } from "@/lib/csrf-origin"
import {
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE_BYTES,
  SUPABASE_STORAGE_BUCKET,
  extensionFromMime,
  getSupabaseServerClient,
  hasValidImageMagicBytes,
  isAllowedUploadType,
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
    return NextResponse.json({ error: "Solo cuentas empresa pueden subir imágenes" }, { status: 403 })
  }

  const empresaId = session.user.empresa_id ?? session.user.id
  const empresaSlug = session.user.empresa_slug ?? session.user.slug ?? empresaId

  if (!empresaId) {
    return NextResponse.json({ error: "No se pudo resolver la empresa" }, { status: 403 })
  }

  const client = getSupabaseServerClient()
  if (!client) {
    return NextResponse.json({ error: "El servicio de almacenamiento no está configurado" }, { status: 503 })
  }

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: "Falta el body multipart" }, { status: 400 })
  }

  const file = formData.get("file")
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Falta el archivo (campo "file")' }, { status: 400 })
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json({ error: "El archivo supera el tamaño máximo de 5MB" }, { status: 413 })
  }

  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return NextResponse.json({ error: "Tipo de archivo no permitido. Solo JPG, PNG, WEBP, GIF." }, { status: 415 })
  }

  const uploadTypeRaw = formData.get("type")
  if (!isAllowedUploadType(uploadTypeRaw)) {
    return NextResponse.json({ error: "El parámetro 'type' es inválido" }, { status: 400 })
  }

  const ext = extensionFromMime(file.type)
  const filename = `${randomUUID()}.${ext}`
  // Usamos empresaId (numérico/UUID estable) en lugar de empresaSlug para evitar
  // que empresa B tome el slug histórico de empresa A y borre sus imágenes.
  const path = `${empresaId}/${uploadTypeRaw}/${filename}`

  const arrayBuffer = await file.arrayBuffer()

  if (!hasValidImageMagicBytes(new Uint8Array(arrayBuffer.slice(0, 12)), file.type)) {
    return NextResponse.json({ error: "El archivo no es una imagen válida" }, { status: 415 })
  }

  const { error: uploadError } = await client.storage
    .from(SUPABASE_STORAGE_BUCKET)
    .upload(path, arrayBuffer, {
      contentType: file.type,
      cacheControl: "31536000",
      upsert: false,
    })

  if (uploadError) {
    const supaErr = uploadError as { name?: string; message?: string; status?: number; statusCode?: number | string; error?: string }
    console.error("[upload-image] supabase upload failed", {
      empresa_id: empresaId,
      type: uploadTypeRaw,
      bucket: SUPABASE_STORAGE_BUCKET,
      path,
      mime: file.type,
      size_bytes: file.size,
      errorName: supaErr.name ?? "unknown",
      errorMessage: supaErr.message ?? "unknown",
      status: supaErr.status ?? supaErr.statusCode ?? null,
      supabase_error: supaErr.error ?? null,
    })
    return NextResponse.json({ error: "No se pudo subir la imagen" }, { status: 502 })
  }

  const { data: urlData } = client.storage.from(SUPABASE_STORAGE_BUCKET).getPublicUrl(path)

  console.info(
    JSON.stringify({
      ts: new Date().toISOString(),
      event: "image_uploaded",
      empresa_id: empresaId,
      type: uploadTypeRaw,
      size_bytes: file.size,
      mime: file.type,
    }),
  )

  return NextResponse.json(
    {
      data: {
        url: urlData.publicUrl,
        path,
        size: file.size,
        mime: file.type,
      },
    },
    { status: 201 },
  )
}
