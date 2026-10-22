"use client"

import { useTenant, useTenantTheme } from "./tenant-provider"
import { useTenantBuyerSession } from "./tenant-buyer-session-provider"
import { usePathname } from "next/navigation"
import { useCart } from "./cart-provider"
import { useConsumiblesCart } from "./consumibles-cart-provider"
import Link from "next/link"
import { ShoppingBasket, ShoppingCart, User, LogOut, Ticket } from "lucide-react"
import { useState, useEffect, useMemo } from "react"
import { buildTenantPath, tenantRoutes } from "@/lib/tenant-routes"
import { isTenantConsumiblesPath } from "@/lib/tenant-bottom-nav"
import { getContrastTextColor, withOpacity } from "@/lib/color-contrast"
import { resolveTenantLogoSize, tenantLogoBarMinClassName, tenantLogoClassName, tenantLogoImageHints } from "@/lib/tenant-logo"
import { IconAction } from "@/components/ui/icon-action"
import TenantInfoMenu from "./tenant-info-menu"
import TenantImage from "./tenant-image"
import TenantThemeToggle from "./tenant-theme-toggle"

export default function TenantNavbar() {
  const empresa = useTenant()
  const { mode } = useTenantTheme()
  const { buyerSession, status, logout } = useTenantBuyerSession()
  const pathname = usePathname()
  const hasBuyerSession = status === "authenticated" && buyerSession?.userType === "comprador"
  const { items, totalItems } = useCart()
  const { totalItems: consumiblesTotalItems } = useConsumiblesCart()
  const [scrolled, setScrolled] = useState(false)
  const cartCount = useMemo(() => totalItems || items.reduce((acc, item) => acc + item.cantidad, 0), [items, totalItems])
  const isConsumiblesFlow = isTenantConsumiblesPath(pathname)
  const cartHref = isConsumiblesFlow
    ? buildTenantPath(empresa.slug, tenantRoutes.consumiblesCheckout())
    : buildTenantPath(empresa.slug, tenantRoutes.checkout())
  const cartLabel = isConsumiblesFlow ? "Ver carrito de consumibles" : "Ver carrito"
  const cartBadge = isConsumiblesFlow ? consumiblesTotalItems : cartCount
  const CartIcon = isConsumiblesFlow ? ShoppingBasket : ShoppingCart

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 10)
    window.addEventListener("scroll", handler)
    return () => window.removeEventListener("scroll", handler)
  }, [])

  const navbarSize = empresa.navbar_size === "small" ? "small" : empresa.navbar_size === "large" ? "large" : "medium"
  // When the empresa hasn't configured navbar_color or color_primario yet (fresh empresa),
  // fall back to a theme-aware base so the navbar surface and the page background contrast
  // correctly. Otherwise navForeground defaults to white and icons disappear on light mode.
  const navbarColor = empresa.navbar_color?.trim()
    || empresa.color_primario
    || (mode === "light" ? "#ffffff" : "#0f172a")
  const navForeground = getContrastTextColor(navbarColor)
  const navSurface = withOpacity(navForeground, 0.14)
  const navBorder = withOpacity(navForeground, 0.18)
  const navHeightClassName = navbarSize === "small" ? "h-14" : navbarSize === "large" ? "h-24" : "h-20"
  // El logo tiene su propio control (empresa.logo_size), independiente de la
  // altura de la barra. Ver lib/tenant-logo.ts.
  const logoSize = resolveTenantLogoSize(empresa.logo_size, navbarSize)
  const logoClassName = tenantLogoClassName(logoSize)
  const logoBarMinClassName = tenantLogoBarMinClassName(logoSize)
  const logoHints = tenantLogoImageHints(logoSize)
  const iconButtonClassName = navbarSize === "small" ? "h-11 w-11" : navbarSize === "large" ? "h-12 w-12" : "h-11 w-11"
  const iconGlyphClassName = navbarSize === "small" ? "h-3.5 w-3.5" : navbarSize === "large" ? "h-5 w-5" : "h-4 w-4"
  const ctaClassName = navbarSize === "small" ? "h-11 px-2.5 sm:px-3.5 text-xs" : navbarSize === "large" ? "h-12 px-4 sm:px-6 text-base" : "h-10 px-3 sm:px-5 text-sm"

  return (
    <header
      className="fixed top-0 left-0 right-0 z-50 transition-all duration-300"
      style={{
        background: navbarColor,
        backdropFilter: "none",
        borderBottom: `1px solid ${withOpacity(navForeground, 0.15)}`,
      }}
    >
      <div>
        {/* min-h del logo: la barra crece si el logo no entra, en vez de recortarlo */}
        <div className={`max-w-6xl mx-auto px-3 sm:px-4 ${navHeightClassName} ${logoBarMinClassName} flex items-center justify-between gap-2 min-w-0`}>
          <div className="min-w-0 flex-1">
            <Link href={buildTenantPath(empresa.slug, tenantRoutes.home())} className="inline-flex items-center gap-2 min-w-0 max-w-full">
              {empresa.logo_url ? (
                <TenantImage
                  src={empresa.logo_url}
                  alt={empresa.nombre}
                  className={logoClassName}
                  width={logoHints.width}
                  height={logoHints.height}
                  sizes={logoHints.sizes}
                  fallback={<span className="text-xl font-black tracking-tight" style={{ color: navForeground }}>{empresa.nombre}</span>}
                />
              ) : (
                <span className="text-lg sm:text-xl font-black tracking-tight truncate block max-w-full" style={{ color: navForeground }}>{empresa.nombre}</span>
              )}
            </Link>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
            <TenantThemeToggle className={`hidden sm:flex ${iconButtonClassName} rounded-full items-center justify-center border backdrop-blur transition-colors cursor-pointer`} iconClassName={iconGlyphClassName} foregroundColor={navForeground} surfaceColor={navSurface} borderColor={navBorder} />
            <IconAction
              href={cartHref}
              label={cartLabel}
              className={`relative ${iconButtonClassName} flex items-center justify-center rounded-full backdrop-blur`}
              style={{ background: navSurface }}
            >
              <CartIcon className={iconGlyphClassName} style={{ color: navForeground }} />
              {cartBadge > 0 && (
                <span
                  className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full text-[10px] leading-none font-bold inline-flex items-center justify-center text-white"
                  style={{ background: empresa.color_primario }}
                >
                  {cartBadge > 99 ? "99+" : cartBadge}
                </span>
              )}
            </IconAction>

            {hasBuyerSession ? (
              <div className="flex items-center gap-2">
                <IconAction
                  href={buildTenantPath(empresa.slug, tenantRoutes.misTickets())}
                  label="Mis tickets"
                  className={`hidden md:flex ${iconButtonClassName} items-center justify-center rounded-full backdrop-blur border transition-colors`}
                  style={{ background: navSurface, borderColor: navBorder }}
                >
                  <Ticket className={iconGlyphClassName} style={{ color: navForeground }} />
                </IconAction>
                <IconAction
                  label="Cerrar sesión"
                  onClick={async () => {
                    await logout()
                    window.location.assign(buildTenantPath(empresa.slug, tenantRoutes.home()))
                  }}
                  className={`${iconButtonClassName} flex items-center justify-center rounded-full backdrop-blur border transition-colors cursor-pointer`}
                  style={{ background: navSurface, borderColor: navBorder }}
                >
                  <LogOut className={iconGlyphClassName} style={{ color: navForeground }} />
                </IconAction>
              </div>
            ) : status === "loading" ? (
              <div className={`${ctaClassName} rounded-full border`} style={{ background: navSurface, borderColor: navBorder, width: "5.75rem" }} aria-hidden="true" />
            ) : (
              <Link
                href={buildTenantPath(empresa.slug, tenantRoutes.auth())}
                className={`${ctaClassName} flex items-center gap-1 sm:gap-1.5 rounded-full font-medium transition-colors overflow-hidden`}
                style={{ background: navSurface, border: `1px solid ${navBorder}`, color: navForeground }}
              >
                <User className={`${iconGlyphClassName} shrink-0`} /> <span className="hidden sm:inline">Ingresar</span>
              </Link>
            )}
            <TenantInfoMenu triggerClassName={iconButtonClassName} iconClassName={iconGlyphClassName} />
          </div>
        </div>
      </div>
    </header>
  )
}
