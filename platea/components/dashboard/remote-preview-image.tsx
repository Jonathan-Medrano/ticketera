"use client"

import { useState } from "react"

export default function RemotePreviewImage({
  src,
  alt,
  className,
  fallback,
}: {
  src?: string | null
  alt: string
  className?: string
  fallback?: React.ReactNode
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)

  if (!src || failedSrc === src) {
    return fallback ?? null
  }

  return <img src={src} alt={alt} className={className} onError={() => setFailedSrc(src)} />
}
