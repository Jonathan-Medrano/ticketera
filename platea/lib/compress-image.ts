// Compresión de imágenes en el cliente, ANTES de subir a Supabase.
//
// Por qué: las imágenes subidas por el usuario llegaban en su tamaño/formato
// original (ej: PNG 1983×793 de 424KB para un logo que se muestra a 100×40, o
// PNG 1254×1254 de 1.3MB para una card). Medido: la home del tenant cargaba
// ~3.1MB de imágenes para mostrar ~150KB de contenido. Resize + WebP en el
// browser baja eso ~90% sin costo de optimizer en el host y achicando el storage.
//
// Estrategia: redimensionar al lado mayor permitido por tipo y re-encodear a WebP
// (preserva alpha, mejor compresión, soportado en navegadores modernos). Fallback
// al formato original si WebP no está disponible (Safari viejo) — el resize solo
// ya es la mayor parte del ahorro. Nunca devuelve un archivo más grande que el
// original, y deja pasar GIF (animado) y formatos no rasterizables sin tocar.

export type ImageUploadType = "logo" | "banner" | "evento" | "consumible" | "galeria" | "sponsor" | "marketing"

// Lado mayor (px) por tipo de uso. Margen para retina sobre el tamaño mostrado real.
const MAX_DIMENSION: Record<ImageUploadType, number> = {
  logo: 512, // navbar ~100-200px
  sponsor: 400, // logos chicos
  evento: 1280, // hero/cards de evento
  consumible: 1024,
  banner: 1920, // ancho completo
  galeria: 1920, // lightbox a pantalla completa
  marketing: 1200, // email body ~480-600px de ancho mostrado; margen retina
}

const DEFAULT_MAX_DIMENSION = 1600
const DEFAULT_QUALITY = 0.82
const COMPRESSIBLE = /^image\/(jpeg|png|webp)$/

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

async function encode(canvas: HTMLCanvasElement, originalType: string, quality: number): Promise<Blob | null> {
  const webp = await toBlob(canvas, "image/webp", quality)
  if (webp && webp.type === "image/webp") return webp
  // WebP no soportado: re-encodear al formato original (PNG conserva alpha; JPEG para fotos).
  const fallbackType = originalType === "image/png" ? "image/png" : "image/jpeg"
  return toBlob(canvas, fallbackType, quality)
}

/**
 * Devuelve una versión redimensionada + recomprimida del archivo, o el archivo
 * original si no aplica/no conviene comprimir (GIF, formato raro, ya chico, o si
 * el resultado sería más grande). Nunca lanza: ante cualquier fallo, original.
 */
export async function compressImage(
  file: File,
  type?: ImageUploadType,
  opts?: { maxDimension?: number; quality?: number },
): Promise<File> {
  if (typeof document === "undefined") return file // SSR guard
  if (file.type === "image/gif") return file // animado: no aplanar a 1 frame
  if (!COMPRESSIBLE.test(file.type)) return file

  const maxDim = opts?.maxDimension ?? (type ? MAX_DIMENSION[type] : DEFAULT_MAX_DIMENSION)
  const quality = opts?.quality ?? DEFAULT_QUALITY

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return file
  }

  const { width, height } = bitmap
  const scale = Math.min(1, maxDim / Math.max(width, height))

  // Ya está dentro de límite y en WebP: no hay nada que ganar.
  if (scale === 1 && file.type === "image/webp") {
    bitmap.close?.()
    return file
  }

  const targetW = Math.max(1, Math.round(width * scale))
  const targetH = Math.max(1, Math.round(height * scale))

  const canvas = document.createElement("canvas")
  canvas.width = targetW
  canvas.height = targetH
  const ctx = canvas.getContext("2d")
  if (!ctx) {
    bitmap.close?.()
    return file
  }
  ctx.drawImage(bitmap, 0, 0, targetW, targetH)
  bitmap.close?.()

  const blob = await encode(canvas, file.type, quality)
  // Si falló o quedó más pesado que el original, mejor el original.
  if (!blob || blob.size >= file.size) return file

  const ext = blob.type === "image/webp" ? "webp" : blob.type === "image/png" ? "png" : "jpg"
  const baseName = file.name.replace(/\.[^.]+$/, "") || "imagen"
  return new File([blob], `${baseName}.${ext}`, { type: blob.type, lastModified: Date.now() })
}
