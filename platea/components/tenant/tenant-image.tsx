"use client"

import { useState, type CSSProperties } from "react"
import Image from "next/image"

const DEFAULT_REMOTE_IMAGE_HOSTS = ["images.unsplash.com"]
const CONFIGURED_REMOTE_IMAGE_HOSTS = (process.env.NEXT_PUBLIC_TENANT_IMAGE_HOSTS ?? "")
  .split(",")
  .map((host) => host.trim().toLowerCase())
  .filter(Boolean)
const ALLOWED_REMOTE_IMAGE_HOSTS = [...new Set([...DEFAULT_REMOTE_IMAGE_HOSTS, ...CONFIGURED_REMOTE_IMAGE_HOSTS])]

function matchesRemoteHost(hostname: string, pattern: string) {
  if (pattern.startsWith("**.")) {
    const baseHost = pattern.slice(3)
    return hostname === baseHost || hostname.endsWith(`.${baseHost}`)
  }

  return hostname === pattern
}

function canUseNextImage(src: string) {
  if (src.startsWith("/")) return true

  try {
    const url = new URL(src)
    if (url.protocol !== "https:") return false

    return ALLOWED_REMOTE_IMAGE_HOSTS.some((pattern) => matchesRemoteHost(url.hostname.toLowerCase(), pattern))
  } catch {
    return false
  }
}

function isSvgSource(src: string) {
  return /\.svg(?:$|[?#])/i.test(src)
}

export default function TenantImage({
  src,
  alt,
  className,
  fallback,
  fill = false,
  sizes,
  width = 1200,
  height = 1200,
  preload = false,
  priority = false,
  loading,
  style,
}: {
  src?: string | null
  alt: string
  className?: string
  fallback?: React.ReactNode
  fill?: boolean
  sizes?: string
  width?: number
  height?: number
  preload?: boolean
  priority?: boolean
  loading?: "lazy" | "eager"
  style?: CSSProperties
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)

  if (!src || failedSrc === src) {
    return fallback ?? null
  }

  const handleError = () => setFailedSrc(src)

  if (canUseNextImage(src)) {
    const unoptimized = isSvgSource(src)

    if (fill) {
      return (
        <Image
          src={src}
          alt={alt}
          fill
          sizes={sizes ?? "100vw"}
          className={className}
          style={style}
          onError={handleError}
          preload={preload}
          priority={preload ? false : priority}
          loading={priority || preload ? undefined : loading}
          unoptimized={unoptimized}
        />
      )
    }

    return (
      <Image
        src={src}
        alt={alt}
        width={width}
        height={height}
        sizes={sizes}
        className={className}
        style={style}
        onError={handleError}
        preload={preload}
        priority={preload ? false : priority}
        loading={priority || preload ? undefined : loading}
        unoptimized={unoptimized}
      />
    )
  }

  // Fallback para hosts fuera de ALLOWED_REMOTE_IMAGE_HOSTS.
  //
  // OJO: acá hay que respetar `fill` a mano. `next/image` con fill posiciona la
  // imagen en absolute; este <img> no, y si no se replica queda EN EL FLUJO con
  // su alto natural. El sintoma: en el hero de Cartelera, el fondo difuminado
  // (que deberia ser puro fondo) sumaba ~480px de espacio vacio arriba del
  // contenido en un flyer vertical a 390px — el hero pasaba de 344 a 848px.
  // Afecta a CUALQUIER uso de fill con imagen de host no permitido, no solo al
  // hero.
  const estiloFill = fill
    ? { position: "absolute" as const, inset: 0, width: "100%", height: "100%", ...style }
    : style

  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className={className} style={estiloFill} onError={handleError} loading={loading ?? "lazy"} decoding="async" />
}
