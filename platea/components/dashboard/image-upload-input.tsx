"use client"

import { useCallback, useRef, useState, type DragEvent, type ChangeEvent } from "react"
import { Image as ImageIcon, Loader2, Trash2, Upload } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { compressImage } from "@/lib/compress-image"

type UploadType = "logo" | "banner" | "evento" | "consumible" | "galeria" | "sponsor" | "marketing"

type AspectHint = "square" | "wide" | "card"

export type ImageUploadInputProps = {
  value: string
  onChange: (url: string) => void
  type: UploadType
  label?: string
  description?: string
  aspect?: AspectHint
  disabled?: boolean
  className?: string
}

const ACCEPT_MIME = "image/jpeg,image/png,image/webp,image/gif"
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"])

function looksLikeSupabaseUrl(url: string): boolean {
  return url.includes("/storage/v1/object/public/")
}

// Fire-and-forget: pide borrado a Supabase. Si falla, queda como orphan (lo limpia
// el job periódico que corra en el futuro). No se le muestra error al usuario porque
// no es accionable — el archivo viejo no afecta el flujo activo.
async function requestDeleteStorageFile(url: string): Promise<void> {
  if (!url || !looksLikeSupabaseUrl(url)) return
  try {
    await fetch("/api/dashboard/upload-image/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    })
  } catch {
    // intencionalmente silencioso
  }
}

function aspectClass(aspect: AspectHint | undefined): string {
  switch (aspect) {
    case "square":
      return "aspect-square max-w-[128px]"
    case "wide":
      return "h-40 w-full"
    case "card":
      return "h-36 w-full"
    default:
      return "h-36 w-full"
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function ImageUploadInput({
  value,
  onChange,
  type,
  label,
  description,
  aspect,
  disabled = false,
  className,
}: ImageUploadInputProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [isDraggingOver, setIsDraggingOver] = useState(false)

  const uploadFile = useCallback(
    async (file: File) => {
      if (!ALLOWED_MIME_TYPES.has(file.type)) {
        toast.error("Tipo de archivo no permitido. Solo JPG, PNG, WEBP o GIF.")
        return
      }

      if (file.size > MAX_FILE_SIZE_BYTES) {
        toast.error(`El archivo supera el máximo de 5MB (subiste ${formatBytes(file.size)})`)
        return
      }

      setIsUploading(true)
      try {
        // Resize + WebP en el cliente antes de subir (baja ~90% el peso; ver lib/compress-image.ts).
        // Si la compresión no aplica o falla, devuelve el archivo original.
        const optimized = await compressImage(file, type)

        const formData = new FormData()
        formData.append("file", optimized)
        formData.append("type", type)

        const res = await fetch("/api/dashboard/upload-image", {
          method: "POST",
          body: formData,
        })

        const body = await res.json().catch(() => null)

        if (!res.ok) {
          toast.error(body?.error ?? "No se pudo subir la imagen")
          return
        }

        const url = body?.data?.url
        if (typeof url !== "string" || !url) {
          toast.error("Respuesta inesperada del servidor")
          return
        }

        onChange(url)
        toast.success("Imagen subida")

        // NO borramos el archivo reemplazado acá: si el usuario reemplaza la imagen y
        // después cancela el wizard sin guardar, el evento en DB seguiría apuntando al
        // archivo viejo — borrarlo ahora dejaría una imagen rota en producción. El archivo
        // queda huérfano y lo limpia el job de storage orphan cleanup existente (corre con
        // cooldown, no requiere acción manual).
      } catch {
        toast.error("No se pudo conectar con el servidor")
      } finally {
        setIsUploading(false)
      }
    },
    [onChange, type],
  )

  const onSelectClick = () => {
    if (disabled || isUploading) return
    inputRef.current?.click()
  }

  const onFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (file) {
      void uploadFile(file)
    }
  }

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (disabled || isUploading) return
    setIsDraggingOver(true)
  }

  const onDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDraggingOver(false)
  }

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDraggingOver(false)
    if (disabled || isUploading) return
    const file = event.dataTransfer.files?.[0]
    if (file) {
      void uploadFile(file)
    }
  }

  const onClear = () => {
    if (disabled || isUploading) return
    if (value) {
      void requestDeleteStorageFile(value)
    }
    onChange("")
  }

  const hasValue = typeof value === "string" && value.trim().length > 0

  return (
    <div className={cn("space-y-2", className)}>
      {label ? <p className="text-sm font-medium text-foreground">{label}</p> : null}

      {hasValue ? (
        <div className="space-y-2">
          <div className={cn("relative overflow-hidden rounded-2xl border border-border bg-muted/30", aspectClass(aspect))}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={value} alt={label ?? "Imagen subida"} className="h-full w-full object-cover" />
            {isUploading ? (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm">
                <Loader2 className="h-6 w-6 animate-spin text-white" />
              </div>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onSelectClick}
              disabled={disabled || isUploading}
              className="gap-2"
            >
              <Upload className="h-3.5 w-3.5" />
              Reemplazar
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClear}
              disabled={disabled || isUploading}
              className="gap-2 text-destructive hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Quitar
            </Button>
          </div>
        </div>
      ) : (
        <div
          onClick={onSelectClick}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          role="button"
          tabIndex={disabled ? -1 : 0}
          aria-disabled={disabled || isUploading}
          onKeyDown={(e) => {
            if ((e.key === "Enter" || e.key === " ") && !disabled && !isUploading) {
              e.preventDefault()
              onSelectClick()
            }
          }}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed bg-muted/20 px-6 py-6 text-center transition-all",
            isDraggingOver ? "border-primary bg-primary/10" : "border-border hover:border-primary/40 hover:bg-muted/30",
            (disabled || isUploading) && "cursor-not-allowed opacity-60",
          )}
        >
          {isUploading ? (
            <>
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <p className="text-sm font-medium text-foreground">Subiendo imagen...</p>
            </>
          ) : (
            <>
              <ImageIcon className="h-6 w-6 text-muted-foreground" />
              <p className="text-sm font-medium text-foreground">
                Click o arrastrá una imagen
              </p>
              <p className="text-xs text-muted-foreground">
                JPG, PNG, WEBP o GIF · hasta 5MB
              </p>
            </>
          )}
        </div>
      )}

      {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_MIME}
        onChange={onFileInputChange}
        className="hidden"
        disabled={disabled || isUploading}
      />
    </div>
  )
}
