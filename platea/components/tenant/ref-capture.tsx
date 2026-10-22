"use client"

import { useEffect } from "react"
import { useSearchParams } from "next/navigation"

export default function RefCapture({ tenantSlug }: { tenantSlug: string }) {
  const searchParams = useSearchParams()

  useEffect(() => {
    const ref = searchParams.get("ref")
    if (ref && ref.trim()) {
      document.cookie = `ref_${tenantSlug}=${ref.trim()}; path=/; max-age=${60 * 60 * 24 * 7}; SameSite=Lax`
    }
  }, [searchParams, tenantSlug])

  return null
}
