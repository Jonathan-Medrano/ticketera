"use client"

import { useEffect, useMemo, useRef, useState, useCallback } from "react"
import dynamic from "next/dynamic"
import Link from "next/link"
import { useTenant, useTenantPreviewEdit, useTenantTheme } from "./tenant-provider"
import { EditableText } from "./editable-text"
import { useCart } from "./cart-provider"
import { useTenantBuyerSession } from "./tenant-buyer-session-provider"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  CalendarDays,
  MapPin,
  ShoppingCart,
  Ticket,
  User,
  LogOut,
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react"
import { buildTenantApiPath, parseTenantBanners, parseTenantGaleria, type AnnouncementBar, type SocialLinks, type TenantEventoResumen } from "@/lib/tenant"
import {
  getRenderableSponsors,
  normalizeTenantHomeSections,
  type TenantHomeBannersGroupSection,
  type TenantHomeCountdownSection as TenantHomeCountdownSectionType,
  type TenantHomeMapaSection as TenantHomeMapaSectionType,
  type TenantHomeSection,
  type TenantHomeSponsorsCarouselSection as TenantHomeSponsorsCarouselSectionType,
  type TenantHomeTestimoniosSection as TenantHomeTestimoniosSectionType,
  type TenantHomeTextoLibreSection as TenantHomeTextoLibreSectionType,
  type TenantHomeVideoEmbedSection as TenantHomeVideoEmbedSectionType,
} from "@/lib/tenant-home-sections"
import { TenantHomeBannerSection, TenantHomeBannersGroupCarousel, TenantHomeSponsorsCarouselSection } from "./tenant-home-sections"
import { AgendaLayout, CarteleraLayout } from "./tenant-home-layouts"
import { TenantHomeTextoLibreSection } from "./tenant-home-texto-libre-section"
import { TenantHomeCountdownSection } from "./tenant-home-countdown-section"
import { TenantHomeVideoEmbedSection } from "./tenant-home-video-embed-section"
import { TenantHomeMapaSection } from "./tenant-home-mapa-section"
import { TenantHomeTestimoniosSection } from "./tenant-home-testimonios-section"
import { getContrastTextColor, tenantOverlayColor, withOpacity } from "@/lib/color-contrast"
import { resolveTenantLogoSize, tenantLogoBarMinClassName, tenantLogoClassName, tenantLogoImageHints } from "@/lib/tenant-logo"
import { normalizeTenantInfoPages } from "@/lib/tenant"
import { getTenantInfoPageSlug } from "@/lib/tenant-info"
import {
  getTenantHeroVisualTokens,
  normalizeTenantHeroVariant,
} from "@/lib/tenant-hero-preview"
import { buildTenantPath, buildTenantPublicUrl, tenantRoutes } from "@/lib/tenant-routes"
import { IconAction } from "@/components/ui/icon-action"
import TenantImage from "./tenant-image"
import TenantThemeToggle from "./tenant-theme-toggle"
import { formatDateShort, formatDateShortTime, formatDateShortWeekday, formatMoney } from "@/lib/format"
import type { SelectedAsiento } from "./seat-picker"

// Lazy-loaded — el InfoMenu solo se abre on-click, la Galería puede no estar visible
// hasta scroll. Ambos están en chunks separados y NO bloquean el LCP del home.
// SSR habilitado para mantener SEO + paint inicial correcto.
const TenantInfoMenu = dynamic(() => import("./tenant-info-menu"), {
  loading: () => null,
})
const TenantGaleriaSection = dynamic(() => import("./tenant-galeria-section"), {
  loading: () => null,
})
// El modal de compra rápida solo se activa on-click — no necesita estar en el bundle
// inicial del tenant. ssr: false porque el modal es 100% interactivo y no aporta
// nada al paint inicial ni al SEO.
const TenantHomeModal = dynamic(() => import("./tenant-home-modal"), {
  ssr: false,
})

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  )
}
function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
    </svg>
  )
}
function TikTokIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.28 8.28 0 004.84 1.54V6.78a4.84 4.84 0 01-1.07-.09z" />
    </svg>
  )
}
function FacebookIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  )
}
function XIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.261 5.633 5.903-5.633zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  )
}
function YouTubeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M23.495 6.205a3.007 3.007 0 00-2.088-2.088c-1.87-.501-9.396-.501-9.396-.501s-7.507-.01-9.396.501A3.007 3.007 0 00.527 6.205a31.247 31.247 0 00-.522 5.805 31.247 31.247 0 00.522 5.783 3.007 3.007 0 002.088 2.088c1.868.502 9.396.502 9.396.502s7.506 0 9.396-.502a3.007 3.007 0 002.088-2.088 31.247 31.247 0 00.5-5.783 31.247 31.247 0 00-.5-5.805zM9.609 15.601V8.408l6.264 3.602z" />
    </svg>
  )
}

type TenantEvento = TenantEventoResumen

type TenantCategoria = {
  id: string
  nombre: string
  descripcion?: string | null
  precio: number
  stock_disponible: number
  // Fee billing mode — el endpoint que llena esto (/evento/:id/categorias) enriquece
  // con precio_buyer/fee_buyer_amount cuando el tenant tiene fee compartido con el
  // comprador (backend/src/routes/tenant.ts, GET .../categorias).
  precio_buyer?: number
  fee_buyer_amount?: number
}

export default function TenantHome({
  eventos,
}: {
  eventos: TenantEvento[]
}) {
  const tenant = useTenant()
  const { editable: previewEditable, editField } = useTenantPreviewEdit()
  const { mode: tenantMode } = useTenantTheme()
  const { agregar, items } = useCart()
  const { buyerSession, status, logout } = useTenantBuyerSession()
  const router = useRouter()

  const announcementBar = (tenant.announcement_bar as AnnouncementBar | null) ?? null
  const socialLinks = (tenant.social_links as SocialLinks | null) ?? null
  const hasSocialLinks = !!(socialLinks && Object.values(socialLinks).some((v) => v?.trim()))
  // Páginas de información para el footer. Mismo criterio que tenant-info-menu:
  // solo las que la empresa habilitó Y completó (una página vacía muestra "no
  // disponible", y mandar ahí es peor que no ofrecer el link).
  const infoPagesFooter = useMemo(
    () => normalizeTenantInfoPages(tenant.info_pages).filter((page) => page.enabled && page.content.trim().length > 0),
    [tenant.info_pages],
  )
  const [barDismissed, setBarDismissed] = useState(false)
  useEffect(() => {
    if (!announcementBar?.enabled || !announcementBar.text) return
    try {
      const stored = localStorage.getItem(`vk-bar:${tenant.slug}`)
      if (stored === announcementBar.text) setBarDismissed(true)
    } catch { /* ignore */ }
  }, [tenant.slug, announcementBar?.enabled, announcementBar?.text])
  const showBar = !!(announcementBar?.enabled && announcementBar.text && !barDismissed)
  const BAR_H = 40
  function dismissBar() {
    setBarDismissed(true)
    try { localStorage.setItem(`vk-bar:${tenant.slug}`, announcementBar?.text ?? "") } catch { /* ignore */ }
  }

  // Banner slider
  const banners = useMemo(() => parseTenantBanners(tenant.banners), [tenant.banners])
  const galeria = useMemo(() => parseTenantGaleria(tenant.galeria_fotos), [tenant.galeria_fotos])
  const orderedSections = useMemo(() => {
    const sections = normalizeTenantHomeSections(tenant.home_sections)
    return sections.filter((s) => (s as { visible?: boolean }).visible !== false)
  }, [tenant.home_sections])
  const bannerSlides = useMemo(() => {
    if (banners.length <= 1) return banners

    return [banners[banners.length - 1], ...banners, banners[0]]
  }, [banners])

  const [bannerIdx, setBannerIdx] = useState(0)
  const [bannerTrackIdx, setBannerTrackIdx] = useState(() => (banners.length > 1 ? 1 : 0))
  const [bannerDragOffset, setBannerDragOffset] = useState(0)
  const [bannerTrackTransitionEnabled, setBannerTrackTransitionEnabled] = useState(true)
  const bannerTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const bannerViewportRef = useRef<HTMLDivElement | null>(null)
  const bannerPointerIdRef = useRef<number | null>(null)
  const bannerPointerTypeRef = useRef<string | null>(null)
  const bannerDragStartXRef = useRef<number | null>(null)
  const bannerDragStartYRef = useRef<number | null>(null)
  const bannerDragDeltaXRef = useRef(0)
  const bannerDragIntentRef = useRef<"idle" | "horizontal">("idle")
  const bannerDragThresholdRef = useRef(56)
  const bannerPendingTrackResetRef = useRef<number | null>(null)

  const clearBannerTimer = useCallback(() => {
    if (bannerTimer.current) {
      clearInterval(bannerTimer.current)
      bannerTimer.current = null
    }
  }, [])

  const moveBannerTo = useCallback((nextIdx: number) => {
    if (banners.length <= 1) {
      setBannerIdx(0)
      setBannerTrackIdx(0)
      return
    }

    const normalizedIdx = ((nextIdx % banners.length) + banners.length) % banners.length
    let nextTrackIdx = normalizedIdx + 1

    if (bannerTrackIdx === banners.length && normalizedIdx === 0) {
      nextTrackIdx = banners.length + 1
    } else if (bannerTrackIdx === 1 && normalizedIdx === banners.length - 1) {
      nextTrackIdx = 0
    }

    setBannerTrackTransitionEnabled(true)
    setBannerIdx(normalizedIdx)
    setBannerTrackIdx(nextTrackIdx)
  }, [bannerTrackIdx, banners.length])

  const moveBannerByStep = useCallback((direction: 1 | -1) => {
    if (banners.length <= 1) {
      setBannerIdx(0)
      setBannerTrackIdx(0)
      return
    }

    const nextIdx = ((bannerIdx + direction) % banners.length + banners.length) % banners.length

    setBannerTrackTransitionEnabled(true)
    setBannerIdx(nextIdx)
    setBannerTrackIdx((currentTrackIdx) => currentTrackIdx + direction)
  }, [bannerIdx, banners.length])

  const startBannerAutoplay = useCallback(() => {
    if (banners.length <= 1) return
    clearBannerTimer()
    bannerTimer.current = setInterval(() => {
      moveBannerByStep(1)
    }, 4000)
  }, [banners.length, clearBannerTimer, moveBannerByStep])

  const restartBannerAutoplay = useCallback(() => {
    startBannerAutoplay()
  }, [startBannerAutoplay])

  const goToBanner = useCallback((idx: number) => {
    moveBannerTo(idx)
    restartBannerAutoplay()
  }, [moveBannerTo, restartBannerAutoplay])

  const moveBannerByDrag = useCallback((direction: 1 | -1) => {
    moveBannerByStep(direction)
    restartBannerAutoplay()
  }, [moveBannerByStep, restartBannerAutoplay])

  const releaseBannerPointerCapture = useCallback((element?: HTMLDivElement | null) => {
    const pointerId = bannerPointerIdRef.current
    const target = element ?? bannerViewportRef.current

    if (pointerId === null || !target?.hasPointerCapture(pointerId)) return

    target.releasePointerCapture(pointerId)
  }, [])

  const resetBannerInteraction = useCallback(() => {
    setBannerTrackTransitionEnabled(true)
    setBannerDragOffset(0)
    bannerPointerIdRef.current = null
    bannerPointerTypeRef.current = null
    bannerDragStartXRef.current = null
    bannerDragStartYRef.current = null
    bannerDragDeltaXRef.current = 0
    bannerDragIntentRef.current = "idle"
  }, [])

  useEffect(() => {
    startBannerAutoplay()
    return () => {
      clearBannerTimer()
    }
  }, [startBannerAutoplay, clearBannerTimer])

  useEffect(() => {
    if (typeof window === "undefined") return
    bannerDragThresholdRef.current = Math.max(48, Math.min(window.innerWidth * 0.08, 96))
  }, [])

  useEffect(() => {
    if (banners.length === 0) {
      setBannerIdx(0)
      setBannerTrackIdx(0)
      return
    }

    if (banners.length === 1) {
      setBannerIdx(0)
      setBannerTrackIdx(0)
      return
    }

    setBannerIdx((currentIdx) => Math.min(currentIdx, banners.length - 1))
    setBannerTrackIdx((currentTrackIdx) => {
      if (currentTrackIdx <= 0 || currentTrackIdx >= banners.length + 1) {
        return Math.min(bannerIdx, banners.length - 1) + 1
      }

      return currentTrackIdx
    })
  }, [bannerIdx, banners.length])

  useEffect(() => {
    if (!bannerPendingTrackResetRef.current || bannerTrackTransitionEnabled) return

    const frameId = window.requestAnimationFrame(() => {
      bannerPendingTrackResetRef.current = null
      setBannerTrackTransitionEnabled(true)
    })

    return () => window.cancelAnimationFrame(frameId)
  }, [bannerTrackIdx, bannerTrackTransitionEnabled])

  const handleBannerPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (banners.length <= 1 || !event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return

    bannerPointerIdRef.current = event.pointerId
    bannerPointerTypeRef.current = event.pointerType
    bannerDragStartXRef.current = event.clientX
    bannerDragStartYRef.current = event.clientY
    bannerDragDeltaXRef.current = 0
    bannerDragIntentRef.current = "idle"
    clearBannerTimer()

    if (event.pointerType === "mouse") {
      event.currentTarget.setPointerCapture(event.pointerId)
    }
  }, [banners.length, clearBannerTimer])

  const handleBannerPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (
      bannerPointerIdRef.current !== event.pointerId ||
      bannerDragStartXRef.current === null ||
      bannerDragStartYRef.current === null
    ) {
      return
    }

    const deltaX = event.clientX - bannerDragStartXRef.current
    const deltaY = event.clientY - bannerDragStartYRef.current
    const absDeltaX = Math.abs(deltaX)
    const absDeltaY = Math.abs(deltaY)

    if (bannerDragIntentRef.current === "idle") {
      if (absDeltaX < 8 && absDeltaY < 8) return

      if (absDeltaY > absDeltaX) {
        releaseBannerPointerCapture(event.currentTarget)
        resetBannerInteraction()
        restartBannerAutoplay()
        return
      }

      bannerDragIntentRef.current = "horizontal"
      setBannerTrackTransitionEnabled(false)

      if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.setPointerCapture(event.pointerId)
      }
    }

    if (bannerDragIntentRef.current !== "horizontal") return

    bannerDragDeltaXRef.current = deltaX
    setBannerDragOffset(deltaX)
  }, [releaseBannerPointerCapture, resetBannerInteraction, restartBannerAutoplay])

  const commitBannerGesture = useCallback(() => {
    const deltaX = bannerDragDeltaXRef.current
    const threshold = bannerDragThresholdRef.current
    const isHorizontalDrag = bannerDragIntentRef.current === "horizontal"

    setBannerTrackTransitionEnabled(true)
    setBannerDragOffset(0)

    if (!isHorizontalDrag) {
      resetBannerInteraction()
      restartBannerAutoplay()
      return
    }

    if (Math.abs(deltaX) >= threshold) {
      if (deltaX < 0) {
        moveBannerByDrag(1)
      } else {
        moveBannerByDrag(-1)
      }
      resetBannerInteraction()
      return
    }

    resetBannerInteraction()
    restartBannerAutoplay()
  }, [moveBannerByDrag, resetBannerInteraction, restartBannerAutoplay])

  const handleBannerPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (bannerPointerIdRef.current !== event.pointerId) return

    releaseBannerPointerCapture(event.currentTarget)
    commitBannerGesture()
  }, [commitBannerGesture, releaseBannerPointerCapture])

  const handleBannerPointerCancel = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (bannerPointerIdRef.current !== event.pointerId) return

    releaseBannerPointerCapture(event.currentTarget)
    resetBannerInteraction()
    restartBannerAutoplay()
  }, [releaseBannerPointerCapture, resetBannerInteraction, restartBannerAutoplay])

  const handleBannerPointerLeave = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (
      bannerPointerIdRef.current !== event.pointerId ||
      bannerPointerTypeRef.current !== "mouse" ||
      event.buttons !== 0 ||
      event.currentTarget.hasPointerCapture(event.pointerId)
    ) {
      return
    }

    resetBannerInteraction()
    restartBannerAutoplay()
  }, [resetBannerInteraction, restartBannerAutoplay])

  const handleBannerTrackTransitionEnd = useCallback(() => {
    if (banners.length <= 1) return

    if (bannerTrackIdx === 0) {
      bannerPendingTrackResetRef.current = banners.length
      setBannerTrackTransitionEnabled(false)
      setBannerTrackIdx(banners.length)
      return
    }

    if (bannerTrackIdx === banners.length + 1) {
      bannerPendingTrackResetRef.current = 1
      setBannerTrackTransitionEnabled(false)
      setBannerTrackIdx(1)
    }
  }, [bannerTrackIdx, banners.length])

  // Modal compra rápida
  const [modalEvento, setModalEvento] = useState<TenantEvento | null>(null)
  const [modalCategorias, setModalCategorias] = useState<TenantCategoria[]>([])
  const [loadingModal, setLoadingModal] = useState(false)
  const [errorModal, setErrorModal] = useState("")
  const [seleccion, setSeleccion] = useState<Record<string, number>>({})
  const [agregadoOk, setAgregadoOk] = useState(false)
  const [categoriasCache, setCategoriasCache] = useState<Record<string, TenantCategoria[]>>({})

  async function abrirModal(evento: TenantEvento) {
    if (!evento.is_checkout_open) return
    setModalEvento(evento)
    setSeleccion({})
    setAgregadoOk(false)
    setErrorModal("")

    const cachedCategorias = categoriasCache[evento.id]
    if (cachedCategorias) {
      setModalCategorias(cachedCategorias)
      setLoadingModal(false)
      return
    }

    setLoadingModal(true)
    try {
      const res = await fetch(buildTenantApiPath(tenant.slug, `/evento/${evento.id}/categorias`))
      const data = await res.json()
      const categorias = Array.isArray(data.categorias) ? data.categorias : []
      setModalCategorias(categorias)
      setCategoriasCache((prev) => ({ ...prev, [evento.id]: categorias }))
    } catch {
      setModalCategorias([])
      setErrorModal("No se pudieron cargar las entradas disponibles. Reintentá en unos segundos.")
    } finally {
      setLoadingModal(false)
    }
  }

  function cambiarCantidad(catId: string, delta: number, max: number) {
    setSeleccion((prev) => {
      const actual = prev[catId] ?? 0
      if (delta > 0 && actual >= max) {
        toast.error(`Solo quedan ${max} disponible${max === 1 ? "" : "s"}`)
        return prev
      }
      const nueva = Math.max(0, Math.min(max, actual + delta))
      if (nueva === 0) {
        const next = { ...prev }
        delete next[catId]
        return next
      }
      return { ...prev, [catId]: nueva }
    })
  }

  function handleAgregar() {
    if (!buyerSession) {
      router.push(buildTenantPath(tenant.slug, tenantRoutes.auth("checkout")))
      return
    }

    if (modalEvento?.modo_fecha === "multiple") {
      router.push(tenantRoutes.evento(modalEvento.id))
      return
    }

    Object.entries(seleccion).forEach(([catId, cantidad]) => {
      const cat = modalCategorias.find((c) => c.id === catId)
      if (!cat || cantidad === 0) return
      if (cantidad > Number(cat.stock_disponible)) {
        toast.error(`Solo quedan ${cat.stock_disponible} disponible${Number(cat.stock_disponible) === 1 ? "" : "s"} de ${cat.nombre}`)
        return
      }
      agregar({
        categoriaId: cat.id,
        eventoId: modalEvento!.id,
        eventoNombre: modalEvento!.nombre,
        categoriaNombre: cat.nombre,
        precio: Number(cat.precio),
        cantidad,
        stockDisponible: Number(cat.stock_disponible),
      })
    })
    setAgregadoOk(true)
    setTimeout(() => {
      setModalEvento(null)
    }, 1200)
  }

  function handleAgregarAsientos(asientos: SelectedAsiento[]) {
    if (!buyerSession) {
      router.push(buildTenantPath(tenant.slug, tenantRoutes.auth("checkout")))
      return
    }
    asientos.forEach((asiento) => {
      agregar({
        categoriaId: asiento.categoria_id ?? asiento.seccion_id,
        eventoId: modalEvento!.id,
        eventoNombre: modalEvento!.nombre,
        categoriaNombre: `Fila ${asiento.fila} — Asiento ${asiento.numero}`,
        precio: asiento.precio,
        cantidad: 1,
        stockDisponible: 1,
        asiento_id: asiento.asiento_id,
        asiento_fila: asiento.fila,
        asiento_numero: asiento.numero,
        asiento_seccion: asiento.seccion_nombre,
        precioBuyer: asiento.precioBuyer,
        feeBuyer: asiento.feeBuyer,
      })
    })
  }

  const totalSeleccionado = Object.values(seleccion).reduce((a, b) => a + b, 0)
  const totalPrecio = Object.entries(seleccion).reduce((acc, [catId, cant]) => {
    const cat = modalCategorias.find((c) => c.id === catId)
    return acc + (cat ? Number(cat.precio) * cant : 0)
  }, 0)

  const totalCarrito = items.reduce((a, b) => a + b.cantidad, 0)

  const getEventoImagen = (evento: TenantEvento) =>
    evento.tanda_activa?.imagen_url || evento.imagen_url || undefined
  const getEventoEstadoPublicoLabel = (evento: TenantEvento) => {
    if (evento.publication_status === "listed") return "Próximamente"
    if (evento.publication_status === "hidden") return "Oculto"
    return null
  }
  const getEventoCtaLabel = (evento: TenantEvento, stockTotal: number) => {
    if (stockTotal <= 0) return "Agotado"
    if (!evento.is_checkout_open) return "Disponible pronto"
    return ctaEventosHome
  }
  const getEventoPublicationCopy = (evento: TenantEvento) => {
    if (evento.publication_status !== "listed" || !evento.publication.publish_at_utc) return null
    return `Se publica el ${formatDateShortTime(evento.publication.publish_at_utc)}`
  }
  const mostrarDescripcionHome = Number(tenant.mostrar_descripcion_home ?? 1) === 1
  const mostrarTandaActivaHome = Number(tenant.mostrar_tanda_activa_home ?? 1) === 1
  const mostrarBadgeStockHome = Number(tenant.mostrar_badge_stock_home ?? 1) === 1
  const mostrarFechaHome = Number(tenant.mostrar_fecha_home ?? 1) === 1
  const mostrarLugarHome = Number(tenant.mostrar_lugar_home ?? 1) === 1
  const mostrarPrecioHome = Number(tenant.mostrar_precio_home ?? 1) === 1
  const desktopEventCardSize = tenant.desktop_event_card_size === "small" ? "small" : tenant.desktop_event_card_size === "medium" ? "medium" : "large"
  // "editorial" es opt-in — desktop-only (ver bloque de mobile más abajo, que siempre
  // renderiza el layout clásico independientemente de este valor).
  const eventCardStyle = tenant.event_card_style === "editorial" ? "editorial" : "clasico"
  const tituloEventosHome = tenant.titulo_eventos_home?.trim() || "Elegí tu próximo evento"
  const subtituloEventosHome = tenant.subtitulo_eventos_home?.trim() || ""
  const ctaEventosHome = tenant.cta_eventos_home?.trim() || "Comprar"
  const bannerVariant = normalizeTenantHeroVariant(tenant.banner_variant)
  const isFullBanner = bannerVariant === "full"
  const heroVisuals = getTenantHeroVisualTokens(bannerVariant)
  // "" / null / cualquier valor desconocido => "clasico" (default historico).
  const homeLayout = tenant.eventos_layout === "cartelera" || tenant.eventos_layout === "agenda"
    ? tenant.eventos_layout
    : "clasico"
  const configuredCardCols = tenant.card_columns === "1" ? 1 : tenant.card_columns === "2" ? 2 : 3
  // Con menos eventos que columnas, una grilla a todo el ancho deja las cards pegadas
  // a la izquierda y el resto de la fila vacío. Bajamos las columnas a la cantidad real
  // de eventos y centramos la grilla (ver desktopCardsGridMaxWidth).
  const effectiveCardCols = Math.min(configuredCardCols, Math.max(eventos.length, 1))
  const cardCols = effectiveCardCols === 1 ? "lg:grid-cols-1" : effectiveCardCols === 2 ? "lg:grid-cols-2" : "lg:grid-cols-3"
  const cardGap = tenant.section_spacing === "compact" ? "gap-3" : tenant.section_spacing === "spacious" ? "gap-7" : "gap-5"
  const sectionPb = tenant.section_spacing === "compact" ? "pb-16" : tenant.section_spacing === "spacious" ? "pb-36" : "pb-28"
  const mobileGap = tenant.section_spacing === "compact" ? "gap-2" : tenant.section_spacing === "spacious" ? "gap-4" : "gap-3"
  const mobileIsCuadricula = tenant.mobile_event_layout === "cuadricula"
  const desktopCardsGridClassName = `hidden lg:grid ${cardCols} ${cardGap} justify-items-center mx-auto w-full`
  const desktopCardMaxWidthPx = desktopEventCardSize === "small" ? 395 : desktopEventCardSize === "medium" ? 500 : 620
  const desktopCardGapPx = tenant.section_spacing === "compact" ? 12 : tenant.section_spacing === "spacious" ? 28 : 20
  // Techo de ancho = lo que realmente ocupan las columnas visibles. Junto con mx-auto,
  // mantiene la grilla centrada cuando hay menos eventos que columnas configuradas.
  const desktopCardsGridMaxWidth = effectiveCardCols * desktopCardMaxWidthPx + (effectiveCardCols - 1) * desktopCardGapPx
  const desktopCardContainerClassName =
    desktopEventCardSize === "small"
      ? "w-full max-w-[395px]"
      : desktopEventCardSize === "medium"
        ? "w-full max-w-[500px]"
        : "w-full max-w-[620px]"
  const desktopCardImageClassName = "relative aspect-[4/3] overflow-hidden"
  const desktopCardBodyClassName =
    desktopEventCardSize === "small"
      ? "p-4 flex flex-col flex-1"
      : desktopEventCardSize === "medium"
        ? "p-[18px] flex flex-col flex-1"
        : "p-5 flex flex-col flex-1"
  const desktopCardTitleClassName =
    desktopEventCardSize === "small"
      ? "font-bold text-sm leading-tight mb-2"
      : desktopEventCardSize === "medium"
        ? "font-bold text-[15px] leading-tight mb-2"
        : "font-bold text-base leading-tight mb-2"
  const eventsSectionMaxWidthClassName =
    desktopEventCardSize === "small"
      ? "max-w-[1260px]"
      : desktopEventCardSize === "medium"
        ? "max-w-[1580px]"
        : "max-w-[1940px]"
  const navbarSize = tenant.navbar_size === "small" ? "small" : tenant.navbar_size === "large" ? "large" : "medium"
  // Theme-aware fallback so icons stay visible when the empresa hasn't configured brand colors yet.
  const navbarColor = tenant.navbar_color?.trim()
    || tenant.color_primario
    || (tenantMode === "light" ? "#ffffff" : "#0f172a")
  const navForeground = getContrastTextColor(navbarColor)
  const navSurface = withOpacity(navForeground, 0.14)
  const navBorder = withOpacity(navForeground, 0.18)
  const homeNavHeightClassName = navbarSize === "small" ? "h-12" : navbarSize === "large" ? "h-24" : "h-20"
  // Mismo control que tenant-navbar: el logo tiene su propio tamaño (logo_size),
  // independiente de la altura de la barra. Ver lib/tenant-logo.ts.
  const homeLogoSize = resolveTenantLogoSize(tenant.logo_size, navbarSize)
  const homeNavLogoClassName = tenantLogoClassName(homeLogoSize)
  const homeNavLogoBarMinClassName = tenantLogoBarMinClassName(homeLogoSize)
  const homeLogoHints = tenantLogoImageHints(homeLogoSize)
  const homeNavIconClassName = navbarSize === "small" ? "h-11 w-11" : navbarSize === "large" ? "h-12 w-12" : "h-11 w-11"
  const homeNavIconGlyphClassName = navbarSize === "small" ? "h-3.5 w-3.5" : navbarSize === "large" ? "h-5 w-5" : "h-4 w-4"
  const homeNavCtaClassName = navbarSize === "small" ? "h-11 px-2.5 sm:px-3.5 text-xs" : navbarSize === "large" ? "h-12 px-4 sm:px-6 text-base" : "h-10 px-3 sm:px-5 text-sm"
  const navbarHeightPx = navbarSize === "small" ? 48 : navbarSize === "large" ? 96 : 80
  const homeBannerTopOffset = `${navbarHeightPx + (showBar ? BAR_H : 0)}px`

  function renderSection(section: TenantHomeSection) {
    if (section.type === "eventos") {
      // Layouts alternativos (ver openspec/changes/sitio-venta-v2/design.md). El default
      // es "clasico": los tenants ya publicados NO deben cambiar de layout solos.
      if (eventos.length > 0 && (homeLayout === "cartelera" || homeLayout === "agenda")) {
        const LayoutAlternativo = homeLayout === "cartelera" ? CarteleraLayout : AgendaLayout
        return (
          <div key={section.id} className={banners.length > 0 && isFullBanner ? "mt-10 md:mt-14" : ""}>
            <LayoutAlternativo
              tenant={tenant}
              eventos={eventos}
              ctaLabel={ctaEventosHome}
              titulo={tituloEventosHome}
              subtitulo={subtituloEventosHome || undefined}
            />
          </div>
        )
      }

      return (
        <div key={section.id} className={`${eventsSectionMaxWidthClassName} mx-auto px-4 ${sectionPb} ${banners.length > 0 && isFullBanner ? "mt-10 md:mt-14" : ""}`}>
          <div className="flex items-end justify-between gap-4 mb-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: `${tenant.color_texto}50` }}>
                Eventos disponibles
              </p>
              <EditableText
                as="h2"
                className="text-xl md:text-2xl font-bold"
                style={{ color: tenant.color_texto }}
                value={tituloEventosHome}
                editable={previewEditable}
                onCommit={(next) => editField("titulo_eventos_home", next)}
              />
              {subtituloEventosHome && (
                <p className="text-sm mt-2 max-w-xl" style={{ color: `${tenant.color_texto}65` }}>
                  {subtituloEventosHome}
                </p>
              )}
            </div>
            <p className="hidden md:block text-sm" style={{ color: `${tenant.color_texto}60` }}>
              {eventos.length} evento{eventos.length !== 1 ? "s" : ""} publicado{eventos.length !== 1 ? "s" : ""}
            </p>
          </div>

          {eventos.length === 0 ? (
            <div className="text-center py-20 rounded-3xl border" style={{ borderColor: `${tenant.color_texto}12`, background: `${tenant.color_texto}05` }}>
              <Ticket className="h-16 w-16 mx-auto mb-4" style={{ color: `${tenant.color_texto}25` }} />
              <h2 className="text-lg font-bold mb-1.5" style={{ color: tenant.color_texto }}>No hay eventos disponibles</h2>
              <p className="text-sm max-w-[280px] mx-auto" style={{ color: `${tenant.color_texto}55` }}>Volvé más tarde o seguinos en redes para estar al tanto de los próximos.</p>
            </div>
          ) : (
            <>
              <div className={desktopCardsGridClassName} style={{ maxWidth: desktopCardsGridMaxWidth }}>
                {eventos.map((evento) => {
                  const stockTotal = Number(evento.stock_total ?? 0)
                  const detailHref = buildTenantPath(tenant.slug, tenantRoutes.evento(evento.id))
                  const publicationBadge = getEventoEstadoPublicoLabel(evento)
                  const publicationCopy = getEventoPublicationCopy(evento)
                  return (
                    <div
                      key={evento.id}
                      className={`${desktopCardContainerClassName} overflow-hidden border flex flex-col shadow-sm transition-transform duration-300 hover:-translate-y-1`}
                      style={{ borderRadius: "var(--tenant-radius, 24px)", borderColor: `${tenant.color_texto}15`, background: `var(--tenant-superficie, ${tenant.color_texto}08)` }}
                    >
                      {eventCardStyle === "editorial" ? (
                        <div className="relative aspect-[4/5] overflow-hidden flex flex-col">
                          {getEventoImagen(evento) ? (
                            <TenantImage src={getEventoImagen(evento)} alt={evento.nombre} fill sizes="(max-width: 768px) 100vw, (max-width: 1200px) 33vw, 25vw" className="object-cover hover:scale-105 transition-transform duration-500" />
                          ) : (
                            <div className="absolute inset-0 flex items-center justify-center" style={{ background: `${tenant.color_primario}22` }}>
                              <Ticket className="h-14 w-14" style={{ color: tenant.color_primario }} />
                            </div>
                          )}
                          {/* Overlay editorial: gradiente de legibilidad teñido con color_primario del
                              tenant (mismo mecanismo que el hero de evento y los banners — tenantOverlayColor
                              mezcla con negro para garantizar contraste, nunca negro puro fijo). Casi opaco
                              donde vive el texto (abajo) y transparente arriba para que la imagen respire. */}
                          <div
                            className="absolute inset-0"
                            style={{ background: `linear-gradient(to top, ${tenantOverlayColor(tenant.color_primario, 0.94)} 0%, ${tenantOverlayColor(tenant.color_primario, 0.72)} 26%, ${tenantOverlayColor(tenant.color_primario, 0.2)} 54%, transparent 80%)` }}
                          />

                          {stockTotal <= 0 && (
                            <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                              <span className="text-white font-black text-lg bg-red-600 px-4 py-1.5 rounded-full">AGOTADO</span>
                            </div>
                          )}

                          <div className="relative flex items-start justify-between gap-2 p-3">
                            {mostrarTandaActivaHome && evento.tanda_activa && stockTotal > 0 ? (
                              <span className="max-w-[70%] rounded-full px-2.5 py-1 text-[11px] font-bold text-white backdrop-blur" style={{ background: `${tenant.color_primario}dd` }}>
                                {evento.tanda_activa.nombre}
                              </span>
                            ) : <span />}
                            {mostrarBadgeStockHome && stockTotal > 0 && stockTotal <= 20 && (
                              <span className="shrink-0 bg-amber-500 text-white text-xs font-bold px-2.5 py-1 rounded-full">¡Últimas {stockTotal}!</span>
                            )}
                          </div>

                          <div className="relative mt-auto flex flex-col gap-1.5 p-4 sm:p-5">
                            {publicationBadge && (
                              <span className="self-start rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur">{publicationBadge}</span>
                            )}
                            <h3 className={desktopCardTitleClassName} style={{ color: "#ffffff" }}>
                              <span>{evento.nombre}</span>
                              {evento.is_detail_visible && (
                                <a
                                  href={`https://wa.me/?text=${encodeURIComponent(`Mirá este evento: ${evento.nombre} → ${tenantPublicBase}/evento/${evento.id}`)}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  aria-label="Compartir por WhatsApp"
                                  onClick={(e) => e.stopPropagation()}
                                  className="ml-2 inline-flex h-5 w-5 shrink-0 translate-y-[1px] items-center justify-center rounded-full opacity-70 hover:opacity-100 transition-opacity"
                                  style={{ color: "#25d366" }}
                                >
                                  <WhatsAppIcon className="h-4 w-4" />
                                </a>
                              )}
                            </h3>
                            {mostrarDescripcionHome && evento.descripcion && (
                              <p className="text-xs line-clamp-1 text-white/70">{evento.descripcion}</p>
                            )}
                            {(mostrarFechaHome && evento.proxima_fecha) || (mostrarLugarHome && evento.lugar) ? (
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/80">
                                {mostrarFechaHome && evento.proxima_fecha && (
                                  <span className="flex items-center gap-1.5">
                                    <CalendarDays className="h-3.5 w-3.5" />
                                    {formatDateShortWeekday(evento.proxima_fecha)}
                                  </span>
                                )}
                                {mostrarLugarHome && evento.lugar && (
                                  <span className="flex items-center gap-1.5 truncate">
                                    <MapPin className="h-3.5 w-3.5 shrink-0" />
                                    {evento.lugar}
                                  </span>
                                )}
                              </div>
                            ) : null}
                            {mostrarPrecioHome && (
                              <p className="text-xs text-white/70">
                                Desde{" "}<span className="text-base font-black font-mono tabular-nums text-white">{formatMoney(evento.precio_desde)}</span>
                              </p>
                            )}
                            {publicationCopy ? <p className="text-xs font-medium text-white">{publicationCopy}</p> : null}
                            <div className="mt-1.5 flex items-center gap-2">
                              {evento.is_detail_visible ? (
                                <Link href={detailHref} onClick={(e) => e.stopPropagation()} className="flex-1 h-10 font-semibold text-sm inline-flex items-center justify-center border backdrop-blur text-white" style={{ borderRadius: "var(--tenant-radius, 12px)", borderColor: "rgba(255,255,255,0.35)" }}>
                                  Ver detalle
                                </Link>
                              ) : (
                                <div className="flex-1 h-10 font-semibold text-sm inline-flex items-center justify-center border backdrop-blur text-white opacity-50 cursor-not-allowed" style={{ borderRadius: "var(--tenant-radius, 12px)", borderColor: "rgba(255,255,255,0.35)" }}>Ver detalle</div>
                              )}
                              <button
                                onClick={(e) => { e.stopPropagation(); abrirModal(evento) }}
                                disabled={stockTotal <= 0 || !evento.is_checkout_open}
                                className="flex-1 h-10 font-bold text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-opacity hover:opacity-90"
                                style={{
                                  borderRadius: "var(--tenant-radius, 12px)",
                                  background: tenant.button_style === "outline" || tenant.button_style === "ghost" ? "transparent" : tenant.color_primario,
                                  border: tenant.button_style === "ghost" ? "none" : `2px solid ${tenant.color_primario}`,
                                  // Siempre blanco acá (a diferencia del layout clásico, que usa color_primario
                                  // para outline/ghost): el CTA vive sobre el overlay oscuro de la imagen, no
                                  // sobre la superficie de la card — blanco es lo único con contraste garantizado.
                                  color: "#ffffff",
                                }}
                              >
                                {getEventoCtaLabel(evento, stockTotal)}
                              </button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className={desktopCardImageClassName}>
                            {getEventoImagen(evento) ? (
                              <TenantImage src={getEventoImagen(evento)} alt={evento.nombre} fill sizes="(max-width: 768px) 100vw, (max-width: 1200px) 33vw, 25vw" className="object-cover hover:scale-105 transition-transform duration-500" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center" style={{ background: `${tenant.color_primario}22` }}>
                              <Ticket className="h-12 w-12" style={{ color: tenant.color_primario }} />
                            </div>
                            )}
                            {stockTotal <= 0 && (
                              <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                                <span className="text-white font-black text-lg bg-red-600 px-4 py-1.5 rounded-full">AGOTADO</span>
                              </div>
                            )}
                            {mostrarBadgeStockHome && stockTotal > 0 && stockTotal <= 20 && (
                              <div className="absolute top-3 right-3 bg-amber-500 text-white text-xs font-bold px-2.5 py-1 rounded-full">¡Últimas {stockTotal}!</div>
                            )}
                            {publicationBadge && (
                              <div className="absolute bottom-3 left-3 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur">{publicationBadge}</div>
                            )}
                            {mostrarTandaActivaHome && evento.tanda_activa && stockTotal > 0 && (
                              <div className="absolute top-3 left-3 max-w-[70%] rounded-full px-2.5 py-1 text-[11px] font-bold text-white backdrop-blur" style={{ background: `${tenant.color_primario}dd` }}>
                                {evento.tanda_activa.nombre}
                              </div>
                            )}
                          </div>
                          <div className={desktopCardBodyClassName}>
                            <h3 className={desktopCardTitleClassName} style={{ color: tenant.color_texto }}>
                              <span>{evento.nombre}</span>
                              {evento.is_detail_visible && (
                                <a
                                  href={`https://wa.me/?text=${encodeURIComponent(`Mirá este evento: ${evento.nombre} → ${tenantPublicBase}/evento/${evento.id}`)}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  aria-label="Compartir por WhatsApp"
                                  onClick={(e) => e.stopPropagation()}
                                  className="ml-2 inline-flex h-5 w-5 shrink-0 translate-y-[1px] items-center justify-center rounded-full opacity-40 hover:opacity-90 transition-opacity"
                                  style={{ color: "#25d366" }}
                                >
                                  <WhatsAppIcon className="h-4 w-4" />
                                </a>
                              )}
                            </h3>
                            {mostrarDescripcionHome && evento.descripcion && (
                              <p className="text-xs line-clamp-2 mb-2" style={{ color: `${tenant.color_texto}70` }}>{evento.descripcion}</p>
                            )}
                            {mostrarTandaActivaHome && evento.tanda_activa && (
                              <p className="text-xs font-semibold mb-2" style={{ color: tenant.color_primario }}>Tanda activa: {evento.tanda_activa.nombre}</p>
                            )}
                            <div className="space-y-1 mb-3">
                              {mostrarFechaHome && evento.proxima_fecha && (
                                <div className="flex items-center gap-1.5 text-xs" style={{ color: `${tenant.color_texto}60` }}>
                                  <CalendarDays className="h-3.5 w-3.5" />
                                  {formatDateShortWeekday(evento.proxima_fecha)}
                                </div>
                              )}
                              {mostrarLugarHome && evento.lugar && (
                                <div className="flex items-center gap-1.5 text-xs" style={{ color: `${tenant.color_texto}60` }}>
                                  <MapPin className="h-3.5 w-3.5" />
                                  {evento.lugar}
                                </div>
                              )}
                            </div>
                            <div className="mt-auto">
                              {mostrarPrecioHome && (
                                <p className="text-xs mb-2" style={{ color: `${tenant.color_texto}50` }}>
                                  Desde{" "}<span className="text-base font-black font-mono tabular-nums" style={{ color: tenant.color_primario }}>{formatMoney(evento.precio_desde)}</span>
                                </p>
                              )}
                              {publicationCopy ? <p className="mb-2 text-xs font-medium" style={{ color: tenant.color_primario }}>{publicationCopy}</p> : null}
                              <div className="flex items-center gap-2">
                                {evento.is_detail_visible ? (
                                  <Link href={detailHref} onClick={(e) => e.stopPropagation()} className="flex-1 h-10 font-semibold text-sm inline-flex items-center justify-center border backdrop-blur" style={{ borderRadius: "var(--tenant-radius, 12px)", borderColor: `${tenant.color_texto}20`, color: tenant.color_texto }}>
                                    Ver detalle
                                  </Link>
                                ) : (
                                  <div className="flex-1 h-10 font-semibold text-sm inline-flex items-center justify-center border opacity-50 cursor-not-allowed" style={{ borderRadius: "var(--tenant-radius, 12px)", borderColor: `${tenant.color_texto}20`, color: tenant.color_texto }}>Ver detalle</div>
                                )}
                                <button
                                  onClick={(e) => { e.stopPropagation(); abrirModal(evento) }}
                                  disabled={stockTotal <= 0 || !evento.is_checkout_open}
                                  className="flex-1 h-10 font-bold text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-opacity hover:opacity-90"
                                  style={{
                                    borderRadius: "var(--tenant-radius, 12px)",
                                    background: tenant.button_style === "outline" || tenant.button_style === "ghost" ? "transparent" : tenant.color_primario,
                                    border: tenant.button_style === "ghost" ? "none" : `2px solid ${tenant.color_primario}`,
                                    color: tenant.button_style === "outline" || tenant.button_style === "ghost" ? tenant.color_primario : "#ffffff",
                                  }}
                                >
                                  {getEventoCtaLabel(evento, stockTotal)}
                                </button>
                              </div>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
              {mobileIsCuadricula ? (
                <div className={`grid lg:hidden ${eventos.length === 1 ? "grid-cols-1" : "grid-cols-2"} ${mobileGap}`}>
                  {eventos.map((evento) => {
                    const stockTotal = Number(evento.stock_total ?? 0)
                    const detailHref = buildTenantPath(tenant.slug, tenantRoutes.evento(evento.id))
                    const publicationCopy = getEventoPublicationCopy(evento)
                    return (
                      <div
                        key={evento.id}
                        className="flex flex-col border shadow-sm overflow-hidden min-w-0"
                        style={{ borderRadius: "var(--tenant-radius, 16px)", borderColor: `${tenant.color_texto}15`, background: `var(--tenant-superficie, ${tenant.color_texto}08)` }}
                      >
                        <div className="relative aspect-[4/3] overflow-hidden">
                          {getEventoImagen(evento) ? (
                            <TenantImage src={getEventoImagen(evento)} alt={evento.nombre} fill sizes="50vw" className="object-cover" />
                          ) : (
                            <div className="h-full w-full flex items-center justify-center" style={{ background: `${tenant.color_primario}22` }}>
                              <Ticket className="h-8 w-8" style={{ color: tenant.color_primario }} />
                            </div>
                          )}
                          {stockTotal <= 0 && (
                            <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                              <span className="text-white font-black text-[10px] bg-red-600 px-2 py-0.5 rounded">AGOTADO</span>
                            </div>
                          )}
                          {mostrarBadgeStockHome && stockTotal > 0 && stockTotal <= 20 && (
                            <span className="absolute bottom-2 left-2 text-[10px] font-bold px-2 py-0.5 rounded text-white" style={{ background: "#f59e0b" }}>¡Últ. {stockTotal}!</span>
                          )}
                        </div>
                        <div className="flex flex-col flex-1 p-3 gap-1.5">
                          <h3 className="font-bold text-[13px] leading-tight line-clamp-2" style={{ color: tenant.color_texto }}>{evento.nombre}</h3>
                          {publicationCopy ? <p className="text-[11px] font-medium" style={{ color: tenant.color_primario }}>{publicationCopy}</p> : null}
                          {mostrarTandaActivaHome && evento.tanda_activa && (
                            <p className="text-[11px] font-semibold" style={{ color: tenant.color_primario }}>{evento.tanda_activa.nombre}</p>
                          )}
                          {mostrarFechaHome && evento.proxima_fecha && (
                            <div className="flex items-center gap-1 text-[11px]" style={{ color: `${tenant.color_texto}60` }}>
                              <CalendarDays className="h-3 w-3 shrink-0" />
                              {formatDateShort(evento.proxima_fecha)}
                            </div>
                          )}
                          {mostrarLugarHome && evento.lugar && (
                            <div className="flex items-center gap-1 text-[11px]" style={{ color: `${tenant.color_texto}60` }}>
                              <MapPin className="h-3 w-3 shrink-0" />
                              <span className="truncate">{evento.lugar}</span>
                            </div>
                          )}
                          {mostrarPrecioHome && (
                            <p className="font-black text-sm font-mono tabular-nums mt-auto" style={{ color: tenant.color_primario }}>{formatMoney(evento.precio_desde)}</p>
                          )}
                          {evento.is_detail_visible && stockTotal > 0 && evento.is_checkout_open ? (
                            <Link
                              href={detailHref}
                              className="w-full h-10 font-bold text-xs transition-opacity hover:opacity-90 flex items-center justify-center whitespace-nowrap overflow-hidden text-ellipsis"
                              style={{
                                borderRadius: "var(--tenant-radius, 10px)",
                                background: tenant.button_style === "outline" || tenant.button_style === "ghost" ? "transparent" : tenant.color_primario,
                                border: tenant.button_style === "ghost" ? "none" : `2px solid ${tenant.color_primario}`,
                                color: tenant.button_style === "outline" || tenant.button_style === "ghost" ? tenant.color_primario : "#ffffff",
                              }}
                            >
                              {getEventoCtaLabel(evento, stockTotal)}
                            </Link>
                          ) : (
                            <button
                              onClick={() => abrirModal(evento)}
                              disabled={stockTotal <= 0 || !evento.is_checkout_open}
                              className="w-full h-10 font-bold text-xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-opacity hover:opacity-90 whitespace-nowrap overflow-hidden text-ellipsis"
                              style={{
                                borderRadius: "var(--tenant-radius, 10px)",
                                background: tenant.button_style === "outline" || tenant.button_style === "ghost" ? "transparent" : tenant.color_primario,
                                border: tenant.button_style === "ghost" ? "none" : `2px solid ${tenant.color_primario}`,
                                color: tenant.button_style === "outline" || tenant.button_style === "ghost" ? tenant.color_primario : "#ffffff",
                              }}
                            >
                              {getEventoCtaLabel(evento, stockTotal)}
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className={`flex lg:hidden flex-col ${mobileGap}`}>
                  {eventos.map((evento) => {
                    const stockTotal = Number(evento.stock_total ?? 0)
                    const detailHref = buildTenantPath(tenant.slug, tenantRoutes.evento(evento.id))
                    const publicationCopy = getEventoPublicationCopy(evento)
                    return (
                      <div
                        key={evento.id}
                        className="flex gap-3.5 p-3.5 border shadow-sm min-w-0"
                        style={{ borderRadius: "var(--tenant-radius, 24px)", borderColor: `${tenant.color_texto}15`, background: `var(--tenant-superficie, ${tenant.color_texto}08)` }}
                      >
                        <div className="relative h-[88px] w-[88px] overflow-hidden shrink-0" style={{ borderRadius: "calc(var(--tenant-radius, 16px) * 0.65)" }}>
                          {getEventoImagen(evento) ? (
                            <TenantImage src={getEventoImagen(evento)} alt={evento.nombre} fill sizes="96px" className="object-cover" />
                          ) : (
                            <div className="h-full w-full flex items-center justify-center" style={{ background: `${tenant.color_primario}22` }}>
                              <Ticket className="h-8 w-8" style={{ color: tenant.color_primario }} />
                            </div>
                          )}
                          {stockTotal <= 0 && (
                            <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                              <span className="text-white font-black text-[10px] bg-red-600 px-1.5 py-0.5 rounded">AGOTADO</span>
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0 flex flex-col">
                          <h3 className="font-bold text-sm leading-tight mb-1 line-clamp-2" style={{ color: tenant.color_texto }}>{evento.nombre}</h3>
                          {mostrarDescripcionHome && evento.descripcion && (
                            <p className="text-xs line-clamp-1 mb-1" style={{ color: `${tenant.color_texto}70` }}>{evento.descripcion}</p>
                          )}
                          {mostrarTandaActivaHome && evento.tanda_activa && (
                            <p className="text-[11px] font-semibold mb-1" style={{ color: tenant.color_primario }}>{evento.tanda_activa.nombre}</p>
                          )}
                          {mostrarFechaHome && evento.proxima_fecha && (
                            <div className="flex items-center gap-1 text-xs mb-0.5" style={{ color: `${tenant.color_texto}60` }}>
                              <CalendarDays className="h-3 w-3" />
                              {formatDateShort(evento.proxima_fecha)}
                            </div>
                          )}
                          {mostrarLugarHome && evento.lugar && (
                            <div className="flex items-center gap-1 text-xs mb-1" style={{ color: `${tenant.color_texto}60` }}>
                              <MapPin className="h-3 w-3" />
                              <span className="truncate">{evento.lugar}</span>
                            </div>
                          )}
                          {mostrarBadgeStockHome && stockTotal > 0 && stockTotal <= 20 && (
                            <p className="text-xs text-amber-500 font-medium mb-1">¡Últimas {stockTotal}!</p>
                          )}
                          {publicationCopy ? <p className="text-[11px] font-medium mb-1" style={{ color: tenant.color_primario }}>{publicationCopy}</p> : null}
                          <div className="mt-auto flex flex-col gap-2">
                            {mostrarPrecioHome && (
                              <p className="font-black text-sm font-mono tabular-nums" style={{ color: tenant.color_primario }}>{formatMoney(evento.precio_desde)}</p>
                            )}
                            <div className="flex items-center gap-2">
                              {evento.is_detail_visible ? (
                                <Link href={detailHref} onClick={(e) => e.stopPropagation()} className="h-11 shrink-0 px-4 text-xs font-semibold inline-flex items-center justify-center border whitespace-nowrap" style={{ borderRadius: "var(--tenant-radius, 12px)", borderColor: `${tenant.color_texto}20`, color: tenant.color_texto }}>
                                  Ver
                                </Link>
                              ) : (
                                <div className="h-11 shrink-0 px-4 text-xs font-semibold inline-flex items-center justify-center border opacity-50 cursor-not-allowed whitespace-nowrap" style={{ borderRadius: "var(--tenant-radius, 12px)", borderColor: `${tenant.color_texto}20`, color: tenant.color_texto }}>Ver</div>
                              )}
                              <button
                                onClick={(e) => { e.stopPropagation(); abrirModal(evento) }}
                                disabled={stockTotal <= 0 || !evento.is_checkout_open}
                                className="flex-1 h-11 px-2 font-bold text-xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-opacity hover:opacity-90 whitespace-nowrap overflow-hidden text-ellipsis"
                                style={{
                                  borderRadius: "var(--tenant-radius, 12px)",
                                  background: tenant.button_style === "outline" || tenant.button_style === "ghost" ? "transparent" : tenant.color_primario,
                                  border: tenant.button_style === "ghost" ? "none" : `2px solid ${tenant.color_primario}`,
                                  color: tenant.button_style === "outline" || tenant.button_style === "ghost" ? tenant.color_primario : "#ffffff",
                                }}
                              >
                                {getEventoCtaLabel(evento, stockTotal)}
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )}
        </div>
      )
    }

    if (section.type === "galeria") {
      return galeria.length > 0 ? <TenantGaleriaSection key={section.id} galeria={galeria} /> : null
    }

    if (section.type === "banners_group") {
      return <TenantHomeBannersGroupCarousel key={section.id} section={section as TenantHomeBannersGroupSection} tenant={tenant} mode="public" />
    }

    if (section.type === "auspiciantes_carousel") {
      const sponsors = getRenderableSponsors(section as TenantHomeSponsorsCarouselSectionType)
      if (!sponsors.length) return null
      return <TenantHomeSponsorsCarouselSection key={section.id} section={section as TenantHomeSponsorsCarouselSectionType} />
    }

    if (section.type === "texto_libre") {
      return <TenantHomeTextoLibreSection key={section.id} section={section as TenantHomeTextoLibreSectionType} />
    }

    if (section.type === "countdown") {
      return <TenantHomeCountdownSection key={section.id} section={section as TenantHomeCountdownSectionType} eventos={eventos} />
    }

    if (section.type === "video_embed") {
      return <TenantHomeVideoEmbedSection key={section.id} section={section as TenantHomeVideoEmbedSectionType} />
    }

    if (section.type === "mapa") {
      return <TenantHomeMapaSection key={section.id} section={section as TenantHomeMapaSectionType} />
    }

    if (section.type === "testimonios") {
      return <TenantHomeTestimoniosSection key={section.id} section={section as TenantHomeTestimoniosSectionType} />
    }

    return null
  }

  const tenantPublicBase = buildTenantPublicUrl(tenant.slug)

  return (
    <>
      {/* Barra de anuncio — fixed encima del navbar */}
      {showBar && announcementBar && (
        <div
          className="fixed top-0 left-0 right-0 z-[60] flex items-center justify-center gap-2 pl-4 pr-16"
          style={{
            height: BAR_H,
            background: announcementBar.style === "warning" ? "#f59e0b" : tenant.color_primario,
            color: announcementBar.style === "warning" ? "#000" : getContrastTextColor(tenant.color_primario),
          }}
        >
          <span className="min-w-0 truncate text-sm font-medium">{announcementBar.text}</span>
          {announcementBar.link && announcementBar.link_label && (
            <a
              href={announcementBar.link}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 rounded border border-current px-2 py-0.5 text-[11px] font-semibold opacity-90 hover:opacity-100"
            >
              {announcementBar.link_label}
            </a>
          )}
          <button
            type="button"
            onClick={dismissBar}
            aria-label="Cerrar anuncio"
            className="absolute right-3 top-1/2 -translate-y-1/2 flex h-11 w-11 items-center justify-center rounded-full opacity-70 hover:opacity-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

    <div
      // flex-col + `mt-auto` en el footer = sticky footer. Con poco contenido
      // (un solo evento, por ejemplo) el footer se pega abajo en vez de quedar
      // colgado a media pantalla.
      className="min-h-screen flex flex-col"
      style={{ background: tenant.color_fondo, color: tenant.color_texto }}
    >
      {/* Navbar */}
      <header
        className="fixed left-0 right-0 z-50"
        style={{
          top: showBar ? BAR_H : 0,
          background: tenant.navbar_blur ? `${navbarColor}b3` : navbarColor,
          backdropFilter: tenant.navbar_blur ? "blur(12px) saturate(1.4)" : "none",
          borderBottom: `1px solid ${withOpacity(navForeground, 0.15)}`,
        }}
      >
        <div>
          {/* min-h del logo: la barra crece si el logo no entra, en vez de recortarlo */}
          <div className={`max-w-6xl mx-auto px-3 sm:px-4 ${homeNavHeightClassName} ${homeNavLogoBarMinClassName} flex items-center justify-between gap-2 min-w-0`}>
            <div className="min-w-0 flex-1">
              <Link href={buildTenantPath(tenant.slug, tenantRoutes.home())} className="inline-flex min-w-0 max-w-full">
                {tenant.logo_url ? (
                  <TenantImage
                    src={tenant.logo_url}
                    alt={tenant.nombre}
                    className={homeNavLogoClassName}
                    width={homeLogoHints.width}
                    height={homeLogoHints.height}
                    sizes={homeLogoHints.sizes}
                    fallback={<span className="text-base sm:text-lg font-black truncate block max-w-full" style={{ color: navForeground }}>{tenant.nombre}</span>}
                  />
                ) : (
                  <span className="text-base sm:text-lg font-black truncate block max-w-full" style={{ color: navForeground }}>
                    {tenant.nombre}
                  </span>
                )}
              </Link>
            </div>
            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              <TenantThemeToggle className={`${homeNavIconClassName} rounded-full flex items-center justify-center border backdrop-blur transition-colors cursor-pointer`} iconClassName={homeNavIconGlyphClassName} foregroundColor={navForeground} surfaceColor={navSurface} borderColor={navBorder} />
              <IconAction
                href={buildTenantPath(tenant.slug, tenantRoutes.checkout())}
                label="Ver carrito"
                className={`relative ${homeNavIconClassName} flex items-center justify-center rounded-full`}
                style={{ background: navSurface }}
              >
                <ShoppingCart className={homeNavIconGlyphClassName} style={{ color: navForeground }} />
                {totalCarrito > 0 && (
                  <span
                    className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full text-[10px] leading-none font-bold inline-flex items-center justify-center text-white"
                    style={{ background: tenant.color_primario }}
                  >
                    {totalCarrito > 99 ? "99+" : totalCarrito}
                  </span>
                )}
              </IconAction>
              {status === "authenticated" && buyerSession?.userType === "comprador" ? (
                <div className="flex items-center gap-1.5 sm:gap-2">
                  <IconAction
                    label="Mis tickets"
                    href={buildTenantPath(tenant.slug, tenantRoutes.misTickets())}
                    className={`${homeNavIconClassName} flex items-center justify-center rounded-full`}
                    style={{ background: navSurface }}
                  >
                    <Ticket className={homeNavIconGlyphClassName} style={{ color: navForeground }} />
                  </IconAction>
                  <IconAction
                    label="Cerrar sesión"
                    onClick={async () => {
                      await logout()
                      window.location.assign(buildTenantPath(tenant.slug, tenantRoutes.home()))
                    }}
                    className={`${homeNavIconClassName} flex items-center justify-center rounded-full cursor-pointer`}
                    style={{ background: navSurface }}
                  >
                    <LogOut className={homeNavIconGlyphClassName} style={{ color: navForeground }} />
                  </IconAction>
                </div>
              ) : status === "loading" ? (
                <div className={`${homeNavCtaClassName} rounded-full`} style={{ background: navSurface, width: "5.75rem" }} aria-hidden="true" />
              ) : (
                <Link
                  href={buildTenantPath(tenant.slug, tenantRoutes.auth())}
                  className={`${homeNavCtaClassName} flex items-center gap-1 sm:gap-1.5 rounded-full font-semibold overflow-hidden`}
                  style={{ background: navSurface, color: navForeground, border: `1px solid ${navBorder}` }}
                >
                  <User className={`${homeNavIconGlyphClassName} shrink-0`} /> <span className="hidden sm:inline">Ingresar</span>
                </Link>
              )}
              <TenantInfoMenu triggerClassName={homeNavIconClassName} iconClassName={homeNavIconGlyphClassName} />
            </div>
          </div>
        </div>
      </header>

      {/* Banner slider */}
      {banners.length > 0 && (
        <div className={isFullBanner ? "w-full" : "mb-10 w-full md:mx-auto md:mb-14 md:max-w-6xl md:px-6"}>
          <div
            ref={bannerViewportRef}
            className="relative w-full overflow-hidden select-none"
            onPointerDown={handleBannerPointerDown}
            onPointerMove={handleBannerPointerMove}
            onPointerUp={handleBannerPointerUp}
            onPointerCancel={handleBannerPointerCancel}
            onPointerLeave={handleBannerPointerLeave}
            onDragStart={(event) => event.preventDefault()}
            style={{
              height: heroVisuals.publicHeight,
              marginTop: homeBannerTopOffset,
              touchAction: banners.length > 1 ? "pan-y pinch-zoom" : "auto",
              cursor: banners.length > 1 ? (bannerTrackTransitionEnabled ? "grab" : "grabbing") : "auto",
            }}
          >
            <div
              className="flex h-full"
              onTransitionEnd={handleBannerTrackTransitionEnd}
              style={{
                width: `${bannerSlides.length * 100}%`,
                transform: `translate3d(calc(${bannerTrackIdx * (-100 / bannerSlides.length)}% + ${bannerDragOffset}px), 0, 0)`,
                transition: bannerTrackTransitionEnabled ? "transform 520ms cubic-bezier(0.22, 1, 0.36, 1)" : "none",
              }}
            >
              {bannerSlides.map((src, i) => (
                <div
                  key={i}
                  className="relative h-full shrink-0 overflow-hidden"
                  style={{ width: `${100 / bannerSlides.length}%` }}
                >
                    <TenantImage
                      src={src}
                      alt={`Banner ${i + 1}`}
                      className="w-full h-full object-cover"
                      style={{ objectPosition: heroVisuals.publicObjectPosition }}
                      priority={i === 0}
                      preload={i === 0}
                      loading={i === 0 ? "eager" : undefined}
                    />
                </div>
              ))}
            </div>
            {banners.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={() => moveBannerByDrag(-1)}
                  aria-label="Banner anterior"
                  className="absolute left-3 top-1/2 -translate-y-1/2 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-black/40 backdrop-blur-sm transition-colors hover:bg-black/60"
                >
                  <ChevronLeft className="h-5 w-5 text-white" />
                </button>
                <button
                  type="button"
                  onClick={() => moveBannerByDrag(1)}
                  aria-label="Banner siguiente"
                  className="absolute right-3 top-1/2 -translate-y-1/2 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-black/40 backdrop-blur-sm transition-colors hover:bg-black/60"
                >
                  <ChevronRight className="h-5 w-5 text-white" />
                </button>
                <div className={`absolute ${isFullBanner ? "bottom-8" : "bottom-4"} left-1/2 -translate-x-1/2 flex gap-1.5`}>
                  {banners.map((_, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => goToBanner(i)}
                      aria-label={`Ir al banner ${i + 1}`}
                      aria-current={i === bannerIdx ? "true" : undefined}
                      className="flex items-center justify-center cursor-pointer"
                      style={{ padding: "10px 4px" }}
                    >
                      <span
                        className="rounded-full transition-all"
                        style={{
                          display: "block",
                          width: i === bannerIdx ? "20px" : "6px",
                          height: "6px",
                          background: i === bannerIdx ? tenant.color_primario : `${tenant.color_texto}40`,
                        }}
                      />
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {(() => {
        // The navbar is `position: fixed`, so whichever section ends up first in the
        // visible flow (any type — eventos, galería, texto libre, etc., since sections
        // are reorderable) needs the navbar's height as top spacing, or it renders
        // flush against it. Only the actual first VISIBLE section gets it — a section
        // can return null (e.g. an empty galería), and sections after the first must
        // never get it too, or they end up with a bogus gap before them.
        let firstVisibleFound = false
        return orderedSections.map((section) => {
          const rendered = renderSection(section)
          if (rendered === null) return null
          if (banners.length > 0 || firstVisibleFound) return rendered
          firstVisibleFound = true
          // Cartelera es full-bleed: su fondo difuminado tiene que llegar hasta
          // arriba de todo. Con este wrapper quedaba una franja del color de
          // fondo entre el navbar y el hero (se veia como una linea negra).
          // El layout se encarga solo del clearance, por dentro.
          if (homeLayout === "cartelera") return rendered
          return (
            <div key={`offset-${section.id}`} style={{ paddingTop: `calc(${homeBannerTopOffset} + 2rem)` }}>
              {rendered}
            </div>
          )
        })
      })()}

      {/* Modal compra rápida — lazy loaded, solo se monta cuando el usuario hace click */}
      {modalEvento && (
        <TenantHomeModal
          modalEvento={modalEvento}
          modalCategorias={modalCategorias}
          loadingModal={loadingModal}
          errorModal={errorModal}
          seleccion={seleccion}
          agregadoOk={agregadoOk}
          totalSeleccionado={totalSeleccionado}
          totalPrecio={totalPrecio}
          buyerSession={buyerSession}
          tenant={tenant}
          onClose={() => setModalEvento(null)}
          onCambiarCantidad={cambiarCantidad}
          onAgregar={handleAgregar}
          onAgregarAsientos={handleAgregarAsientos}
        />
      )}

      {/* Footer.
          Antes estaba gateado por `hasSocialLinks`: un cliente sin redes se
          quedaba SIN footer, o sea sin nombre y sin ningún link legal.
          Ahora se renderiza siempre; lo que se oculta si no hay redes es solo
          la fila de íconos. */}
      <footer
        className="border-t py-5 px-4 mt-auto"
        style={{ borderColor: `${tenant.color_texto}10`, background: `${tenant.color_texto}04` }}
      >
        <div className="max-w-6xl mx-auto flex flex-col gap-4">
          {/* Páginas de información (términos, arrepentimiento, defensa del
              consumidor, etc.). Mismo criterio que el menú del navbar: solo las
              que la empresa habilitó Y completó. Antes NADA las linkeaba desde
              el sitio público: en ctrlzfiesta.ticketera.com había 0 links. */}
          {infoPagesFooter.length > 0 && (
            <nav aria-label="Información" className="flex flex-wrap items-center gap-x-4 gap-y-2">
              {infoPagesFooter.map((page) => (
                <Link
                  key={page.key}
                  href={buildTenantPath(tenant.slug, `/informacion/${getTenantInfoPageSlug(page.key)}`)}
                  className="text-xs underline-offset-4 hover:underline transition-opacity opacity-70 hover:opacity-100"
                  style={{ color: tenant.color_texto }}
                >
                  {page.title}
                </Link>
              ))}
            </nav>
          )}

          <div className="flex flex-wrap items-center justify-between gap-4">
            {/* Sin año dinámico a propósito: `new Date()` en el render se
                evalúa en servidor y cliente por separado y puede diferir en el
                cambio de año, que es una mecha de hydration mismatch. */}
            <p className="text-xs" style={{ color: `${tenant.color_texto}50` }}>{tenant.nombre}</p>
            <div className={`items-center gap-3 ${hasSocialLinks ? "flex" : "hidden"}`}>
              {socialLinks?.instagram && (
                <a href={socialLinks.instagram} target="_blank" rel="noopener noreferrer" aria-label="Instagram"
                  className="opacity-60 hover:opacity-100 transition-opacity" style={{ color: tenant.color_texto }}>
                  <InstagramIcon className="h-5 w-5" />
                </a>
              )}
              {socialLinks?.tiktok && (
                <a href={socialLinks.tiktok} target="_blank" rel="noopener noreferrer" aria-label="TikTok"
                  className="opacity-60 hover:opacity-100 transition-opacity" style={{ color: tenant.color_texto }}>
                  <TikTokIcon className="h-5 w-5" />
                </a>
              )}
              {socialLinks?.facebook && (
                <a href={socialLinks.facebook} target="_blank" rel="noopener noreferrer" aria-label="Facebook"
                  className="opacity-60 hover:opacity-100 transition-opacity" style={{ color: tenant.color_texto }}>
                  <FacebookIcon className="h-5 w-5" />
                </a>
              )}
              {socialLinks?.x && (
                <a href={socialLinks.x} target="_blank" rel="noopener noreferrer" aria-label="X"
                  className="opacity-60 hover:opacity-100 transition-opacity" style={{ color: tenant.color_texto }}>
                  <XIcon className="h-5 w-5" />
                </a>
              )}
              {socialLinks?.youtube && (
                <a href={socialLinks.youtube} target="_blank" rel="noopener noreferrer" aria-label="YouTube"
                  className="opacity-60 hover:opacity-100 transition-opacity" style={{ color: tenant.color_texto }}>
                  <YouTubeIcon className="h-5 w-5" />
                </a>
              )}
            </div>
          </div>
        </div>
      </footer>
    </div>
    </>
  )
}
