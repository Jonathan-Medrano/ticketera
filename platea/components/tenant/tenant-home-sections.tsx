"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { ChevronLeft, ChevronRight } from "lucide-react"

function sanitizeHref(href: string | null | undefined): string {
  if (!href) return "#"
  try {
    const url = new URL(href)
    if (url.protocol === "https:" || url.protocol === "http:") return href
  } catch {
    if (href.startsWith("/")) return href
  }
  return "#"
}
import type { TenantEmpresa } from "@/lib/tenant"
import type { TenantHomeBannerSection as TenantHomeBannerSectionData, TenantHomeBannersGroupSection, TenantHomeSponsorsCarouselSection as TenantHomeSponsorsCarouselSectionData } from "@/lib/tenant-home-sections"
import { getRenderableSponsors, hasRenderableBannerContent } from "@/lib/tenant-home-sections"
import { tenantOverlayColor } from "@/lib/color-contrast"

/** CTA de banner: mismo mecanismo que las cards de evento en tenant-home.tsx (button_style + color_primario). */
function bannerCtaStyle(tenant: TenantEmpresa) {
  const isTransparent = tenant.button_style === "outline" || tenant.button_style === "ghost"
  return {
    background: isTransparent ? "transparent" : tenant.color_primario,
    border: tenant.button_style === "ghost" ? "none" : `2px solid ${tenant.color_primario}`,
    color: isTransparent ? tenant.color_primario : "#ffffff",
  }
}

export type TenantCategoria = {
  id: string
  nombre: string
  descripcion?: string | null
  precio: number
  stock_disponible: number
}

export function TenantHomeBannerSection({
  mode,
  tenant,
  section,
}: {
  mode: "public" | "editor"
  tenant: TenantEmpresa
  section: TenantHomeBannerSectionData
}) {
  const hasImage = Boolean(section.image_url)
  const hasCta = Boolean(section.cta_label && section.cta_href)
  const ctaStyle = bannerCtaStyle(tenant)

  return (
    <div className="relative w-full overflow-hidden rounded-2xl">
      {hasImage && (
        <div className="relative aspect-[16/6] w-full">
          <img
            src={section.image_url}
            alt={section.title || "Banner"}
            className="absolute inset-0 h-full w-full object-cover"
          />
        </div>
      )}
      {(section.title || section.subtitle || hasCta) && (
        <div
          className={`${hasImage ? "absolute inset-0 flex flex-col items-center justify-center p-6 text-center" : "py-10 px-6 text-center"}`}
          style={hasImage ? { background: tenantOverlayColor(tenant.color_primario, 0.45) } : undefined}
        >
          {section.title && (
            <h2 className="text-2xl font-black text-white drop-shadow mb-2">{section.title}</h2>
          )}
          {section.subtitle && (
            <p className="text-sm text-white/80 drop-shadow mb-4 max-w-lg">{section.subtitle}</p>
          )}
          {hasCta && (
            mode === "public"
              ? <Link href={sanitizeHref(section.cta_href)} className="inline-flex h-10 items-center rounded-xl px-5 text-sm font-bold transition-opacity hover:opacity-90" style={ctaStyle}>{section.cta_label}</Link>
              : <div className="inline-flex h-10 items-center rounded-xl px-5 text-sm font-bold opacity-70" style={ctaStyle}>{section.cta_label}</div>
          )}
        </div>
      )}
    </div>
  )
}

const BANNER_AUTO_SCROLL_MS = 5000
const BANNER_SWIPE_THRESHOLD = 48

export function TenantHomeBannersGroupCarousel({ section, tenant, mode = "public" }: { section: TenantHomeBannersGroupSection; tenant: TenantEmpresa; mode?: "public" | "editor" }) {
  const visibleBanners = section.banners.filter((b) => b.visible !== false && hasRenderableBannerContent(b))
  const [index, setIndex] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pointerIdRef = useRef<number | null>(null)
  const pointerStartXRef = useRef<number | null>(null)

  const count = visibleBanners.length
  const showControls = count > 1

  const clearTimer = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
  }, [])

  const startTimer = useCallback(() => {
    if (!showControls) return
    clearTimer()
    timerRef.current = setInterval(() => setIndex((i) => (i + 1) % count), BANNER_AUTO_SCROLL_MS)
  }, [showControls, count, clearTimer])

  useEffect(() => {
    startTimer()
    return clearTimer
  }, [startTimer, clearTimer])

  const prev = useCallback(() => { setIndex((i) => (i - 1 + count) % count); startTimer() }, [count, startTimer])
  const next = useCallback(() => { setIndex((i) => (i + 1) % count); startTimer() }, [count, startTimer])

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!showControls || !e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return
    pointerIdRef.current = e.pointerId
    pointerStartXRef.current = e.clientX
    clearTimer()
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (pointerIdRef.current !== e.pointerId || pointerStartXRef.current === null) return
    const delta = e.clientX - pointerStartXRef.current
    if (Math.abs(delta) > BANNER_SWIPE_THRESHOLD) setIndex((i) => (i + (delta < 0 ? 1 : -1) + count) % count)
    pointerIdRef.current = null
    pointerStartXRef.current = null
    startTimer()
  }

  function onPointerCancel() {
    pointerIdRef.current = null
    pointerStartXRef.current = null
    startTimer()
  }

  if (count === 0) return null

  const banner = visibleBanners[index]
  const hasImage = Boolean(banner.image_url)
  const hasCta = Boolean(banner.cta_label && banner.cta_href)
  const isFull = section.variant === "full"
  const ctaStyle = bannerCtaStyle(tenant)

  return (
    <div className={isFull ? "w-full py-10" : "w-full max-w-6xl mx-auto px-4 py-10"}>
      <div
        className={`relative w-full overflow-hidden select-none touch-pan-y ${isFull ? "" : "rounded-2xl"}`}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onPointerLeave={onPointerCancel}
      >
        {hasImage && (
          <div className="relative aspect-[16/6] w-full">
            <img
              src={banner.image_url}
              alt={banner.title || "Banner"}
              className="absolute inset-0 h-full w-full object-cover"
            />
          </div>
        )}

        {(banner.title || banner.subtitle || hasCta) && (
          <div
            className={hasImage ? "absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center" : "py-10 px-6 text-center"}
            style={hasImage ? { background: tenantOverlayColor(tenant.color_primario, 0.45) } : undefined}
          >
            {banner.title && <h2 className="text-2xl font-black text-white drop-shadow">{banner.title}</h2>}
            {banner.subtitle && <p className="text-sm text-white/80 drop-shadow max-w-lg">{banner.subtitle}</p>}
            {hasCta && (
              mode === "public"
                ? <Link href={sanitizeHref(banner.cta_href)} className="inline-flex h-10 items-center rounded-xl px-5 text-sm font-bold transition-opacity hover:opacity-90" style={ctaStyle}>{banner.cta_label}</Link>
                : <div className="inline-flex h-10 items-center rounded-xl px-5 text-sm font-bold opacity-70" style={ctaStyle}>{banner.cta_label}</div>
            )}
          </div>
        )}

      </div>

      {showControls && (
        <div className="mt-3 flex justify-center gap-1.5">
          {visibleBanners.map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Ir al banner ${i + 1}`}
              onClick={() => { setIndex(i); startTimer() }}
              className={`h-1.5 rounded-full transition-all ${i === index ? "w-4 bg-primary/70" : "w-1.5 bg-primary/20"}`}
            />
          ))}
        </div>
      )}
    </div>
  )
}

const VISIBLE_SPONSORS = 3
const AUTO_SCROLL_MS = 3000
const SWIPE_THRESHOLD = 48

export function TenantHomeSponsorsCarouselSection({
  section,
}: {
  section: TenantHomeSponsorsCarouselSectionData
}) {
  const sponsors = getRenderableSponsors(section)
  const [startIndex, setStartIndex] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pointerIdRef = useRef<number | null>(null)
  const pointerStartXRef = useRef<number | null>(null)

  const count = sponsors.length
  const showControls = count > VISIBLE_SPONSORS

  const clearTimer = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
  }, [])

  const startTimer = useCallback(() => {
    if (!showControls) return
    clearTimer()
    timerRef.current = setInterval(() => setStartIndex((s) => (s + 1) % count), AUTO_SCROLL_MS)
  }, [showControls, count, clearTimer])

  useEffect(() => {
    startTimer()
    return clearTimer
  }, [startTimer, clearTimer])

  const prev = useCallback(() => {
    setStartIndex((s) => (s - 1 + count) % count)
    startTimer()
  }, [count, startTimer])

  const next = useCallback(() => {
    setStartIndex((s) => (s + 1) % count)
    startTimer()
  }, [count, startTimer])

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!showControls || !e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return
    pointerIdRef.current = e.pointerId
    pointerStartXRef.current = e.clientX
    clearTimer()
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (pointerIdRef.current !== e.pointerId || pointerStartXRef.current === null) return
    const delta = e.clientX - pointerStartXRef.current
    if (Math.abs(delta) > SWIPE_THRESHOLD) {
      setStartIndex((s) => (s + (delta < 0 ? 1 : -1) + count) % count)
    }
    pointerIdRef.current = null
    pointerStartXRef.current = null
    startTimer()
  }

  function onPointerCancel() {
    pointerIdRef.current = null
    pointerStartXRef.current = null
    startTimer()
  }

  if (count === 0) return null

  const visibleSponsors = Array.from({ length: Math.min(VISIBLE_SPONSORS, count) }, (_, i) => {
    const idx = (startIndex + i + count) % count
    return { ...sponsors[idx], _slot: i }
  })

  return (
    <div className="w-full py-10 px-4">
      {(section.title || section.subtitle) && (
        <div className="mb-6 text-center">
          {section.title && <h2 className="mb-1 text-xl font-bold">{section.title}</h2>}
          {section.subtitle && <p className="text-sm opacity-60">{section.subtitle}</p>}
        </div>
      )}

      <div
        className="flex touch-pan-y select-none items-center justify-center gap-4"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onPointerLeave={onPointerCancel}
      >
        {showControls && (
          <button
            type="button"
            onClick={prev}
            aria-label="Sponsor anterior"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/20 bg-white/5 transition-colors hover:bg-white/15"
          >
            <ChevronLeft className="h-4 w-4 opacity-70" />
          </button>
        )}

        <div className="flex flex-1 items-center justify-center gap-4 sm:gap-8 md:gap-16 lg:gap-24">
          {visibleSponsors.map((sponsor) => {
            const inner = (
              <div className="flex flex-col items-center gap-3">
                {sponsor.logo_url && (
                  <img
                    src={sponsor.logo_url}
                    alt={sponsor.name}
                    className="h-20 w-auto max-w-[128px] object-contain opacity-75 transition-opacity hover:opacity-100"
                  />
                )}
                {sponsor.name && (
                  <span className="max-w-[128px] truncate text-center text-sm opacity-50">{sponsor.name}</span>
                )}
              </div>
            )
            return sponsor.href
              ? <a key={`${sponsor.id}-${sponsor._slot}`} href={sanitizeHref(sponsor.href)} target="_blank" rel="noopener noreferrer">{inner}</a>
              : <div key={`${sponsor.id}-${sponsor._slot}`}>{inner}</div>
          })}
        </div>

        {showControls && (
          <button
            type="button"
            onClick={next}
            aria-label="Sponsor siguiente"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/20 bg-white/5 transition-colors hover:bg-white/15"
          >
            <ChevronRight className="h-4 w-4 opacity-70" />
          </button>
        )}
      </div>

      {showControls && (
        <div className="mt-4 flex justify-center gap-1.5">
          {sponsors.map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Ir al sponsor ${i + 1}`}
              onClick={() => { setStartIndex(i); startTimer() }}
              className={`h-1.5 rounded-full transition-all ${i === startIndex ? "w-4 bg-primary/70" : "w-1.5 bg-primary/20"}`}
            />
          ))}
        </div>
      )}
    </div>
  )
}

