"use client"

import { useEffect, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { signOut } from "next-auth/react"
import {
  AlertTriangle,
  BadgeDollarSign,
  BadgePercent,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  CupSoda,
  Globe,
  LayoutDashboard,
  LogOut,
  Menu,
  Receipt,
  ScanLine,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Store,
  Tag,
  Ticket,
  UserCog,
  Users,
  Wallet,
  X,
} from "lucide-react"

import { canAccessVentasNav } from "@/lib/dashboard-ventas"
import { cn } from "@/lib/utils"
import ThemeToggle from "@/components/theme-toggle"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { type Permisos } from "@/lib/permisos"

interface NavItem {
  label: string
  href: string
  icon: React.ElementType
  exact?: boolean
  permiso?: keyof Permisos
  visible?: (context: { permisos?: Permisos; userType?: string }) => boolean
  // Sitio de venta editor: opens in its own tab (own navbar/shell, live preview) —
  // it isn't a page you navigate the dashboard away to.
  openInNewTab?: boolean
}

interface NavSection {
  title: string
  items: NavItem[]
}

export const dashboardNavSections: NavSection[] = [
  {
    title: "Vista general",
    items: [
      { label: "Inicio", href: "/dashboard", icon: LayoutDashboard, exact: true, permiso: "ver_dashboard" },
    ],
  },
  {
    title: "Venta y público",
    items: [
      { label: "Eventos", href: "/dashboard/eventos", icon: CalendarDays, permiso: "ver_eventos" },
      {
        label: "Ventas",
        href: "/dashboard/ventas",
        icon: Ticket,
        visible: ({ permisos, userType }) => canAccessVentasNav({ permisos, userType }),
      },
      { label: "Compradores", href: "/dashboard/compradores", icon: Users, permiso: "ver_compradores" },
      { label: "Revendedores", href: "/dashboard/revendedores", icon: Store, permiso: "gestionar_revendedores" },
      // El módulo Marketing completo (Segmentos/Email/Analítica) está oculto de
      // momento -- solo Promociones queda expuesta acá, en el mismo lugar donde
      // vivía "Marketing". Cuando el módulo se deploye entero, restaurar:
      // { label: "Marketing", href: "/dashboard/marketing", icon: Megaphone, permiso: "ver_marketing" }
      { label: "Promociones", href: "/dashboard/marketing/promociones", icon: Tag, permiso: "ver_marketing" },
    ],
  },
  {
    title: "Punto de venta",
    items: [
      { label: "Vender entradas", href: "/dashboard/pos", icon: Receipt, permiso: "ver_eventos" },
      { label: "Escanear", href: "/dashboard/escanear", icon: ScanLine, permiso: "escanear" },
    ],
  },
  {
    // Antes fragmentado en 3 secciones distintas (Punto de venta / Operación del
    // evento) pese a ser el mismo dominio de negocio — ver plan de rediseño de
    // consumibles, Fase 0.4.
    title: "Barra y consumibles",
    items: [
      { label: "Consumibles", href: "/dashboard/consumibles", icon: ShoppingCart, permiso: "ver_consumibles" as keyof Permisos },
      { label: "Barras", href: "/dashboard/barras", icon: Store, permiso: "ver_consumibles" as keyof Permisos },
      { label: "Vender en barra", href: "/dashboard/consumibles/vender", icon: CupSoda, permiso: "vender_consumibles" as keyof Permisos },
      { label: "Promociones", href: "/dashboard/consumibles/promociones", icon: BadgePercent, permiso: "ver_consumibles" as keyof Permisos },
    ],
  },
  {
    title: "Equipo y control",
    items: [
      { label: "Cobros", href: "/dashboard/cobros", icon: CreditCard, permiso: "ver_recaudacion" },
      { label: "Reembolsos", href: "/dashboard/reembolsos", icon: BadgeDollarSign, permiso: "gestionar_reembolsos" },
      { label: "Comisiones", href: "/dashboard/comisiones", icon: Wallet, permiso: "ver_recaudacion" },
      { label: "Reconciliación", href: "/dashboard/reconciliacion", icon: AlertTriangle, permiso: "ver_recaudacion" },
      { label: "Equipo", href: "/dashboard/equipo", icon: UserCog, permiso: "ver_equipo" },
      { label: "Roles", href: "/dashboard/roles", icon: ShieldCheck, permiso: "ver_roles" },
      // rel: solo "noreferrer" (sin "noopener") — es un link same-origin, sin riesgo de
      // tabnabbing hacia un origen externo. El editor necesita window.opener disponible
      // para poder cerrar su propia pestaña con el botón "Volver" (ver sitio-venta-editor-navbar.tsx).
      { label: "Sitio de venta", href: "/sitio-venta/editor", icon: Globe, permiso: "editar_configuracion", openInNewTab: true },
    ],
  },
  {
    title: "Demo",
    items: [
      { label: "Datos demo", href: "/dashboard/demo-data", icon: Sparkles, permiso: "ver_dashboard" },
    ],
  },
]

const preferenceItems: NavItem[] = [
  { label: "Configuración", href: "/dashboard/configuracion", icon: Settings, permiso: "ver_configuracion" },
]

interface SidebarProps {
  empresaNombre: string
  permisos?: Permisos
  userType?: string
  featureFlags?: { revendedorHabilitado: boolean; consumiblesHabilitado: boolean; posMovilHabilitado?: boolean; esPrueba?: boolean }
}

const SIDEBAR_SECTIONS_LS_KEY = "dashboard-sidebar-sections-v1"

export default function Sidebar({ empresaNombre: _empresaNombre, permisos, userType, featureFlags }: SidebarProps) {
  // empresaNombre se preserva en el prop por compatibilidad, pero ya no se renderiza
  // (decisión UX: el header con el nombre era ruido — la empresa se ve en el dashboard)
  void _empresaNombre
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  // Estado de grupos colapsables: { [section.title]: boolean }. Solo registra
  // toggles EXPLÍCITOS del usuario. Si no está en el map, se calcula auto
  // (abre si tiene un item activo).
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({})
  const pathname = usePathname()

  // Cargar preferencias del usuario al mount (client-only, SSR safe)
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SIDEBAR_SECTIONS_LS_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === "object") {
          // Hidratación client-only desde localStorage en el mount (SSR-safe).
          // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time mount sync from localStorage
          setExpandedSections(parsed as Record<string, boolean>)
        }
      }
    } catch {
      // localStorage no disponible o JSON corrupto — ignorar
    }
  }, [])

  // Persistir cambios
  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_SECTIONS_LS_KEY, JSON.stringify(expandedSections))
    } catch {
      // ignorar
    }
  }, [expandedSections])

  // Auto-expand: cuando navegás dentro de una sección que CERRASTE manualmente antes,
  // limpiamos esa entrada para que el default (basado en active item) la vuelva a abrir.
  // Si nunca tocaste el toggle de esa sección, no hace nada (el default ya la mantiene abierta).
  // Si tu manual era "cerrar otras secciones donde NO estás", lo respetamos.
  useEffect(() => {
    // Sincroniza el auto-expand con la navegación; functional update no-op si nada cambió.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs collapsible state to route changes
    setExpandedSections((prev) => {
      let changed = false
      const next = { ...prev }
      for (const section of dashboardNavSections) {
        const sectionHasActiveItem = section.items.some((item) => {
          if (item.exact) return pathname === item.href
          return pathname.startsWith(item.href)
        })
        // Solo borramos overrides "false" para secciones donde sí estamos parados
        if (sectionHasActiveItem && next[section.title] === false) {
          delete next[section.title]
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [pathname])

  function tieneAcceso(permiso?: keyof Permisos): boolean {
    if (!permiso) return true
    if (userType === "empresa" || !permisos) return true
    return permisos[permiso] === true
  }

  function isFeatureEnabled(href: string): boolean {
    if (featureFlags?.revendedorHabilitado === false && href === "/dashboard/revendedores") return false
    if (featureFlags?.consumiblesHabilitado === false &&
      (href === "/dashboard/consumibles" || href === "/dashboard/consumibles/vender" || href === "/dashboard/barras" || href === "/dashboard/consumibles/promociones")) return false
    // POS móvil: el flag "posMovilHabilitado" está OFF por default y solo lo activa
    // la plataforma. El ítem se muestra siempre (descubrible) — cuando está apagado,
    // /dashboard/pos explica cómo activarlo en vez de desaparecer del sidebar.
    // Datos demo: solo cuentas marcadas es_prueba=true
    if (href === "/dashboard/demo-data" && featureFlags?.esPrueba !== true) return false
    return true
  }

  function isVisible(item: NavItem) {
    if (!isFeatureEnabled(item.href)) return false
    if (item.visible) return item.visible({ permisos, userType })
    return tieneAcceso(item.permiso)
  }

  // Longest-prefix-wins: el item activo es el de href más específico que matchea
  // la ruta actual. Evita que un padre (/dashboard/consumibles) quede resaltado
  // cuando estás en un hijo más específico (/dashboard/consumibles/vender).
  const navMatchHref = (() => {
    const allHrefs = [
      ...dashboardNavSections.flatMap((s) => s.items.map((i) => i.href)),
      ...preferenceItems.map((i) => i.href),
    ]
    const matches = allHrefs.filter((h) => pathname === h || pathname.startsWith(h + "/"))
    return matches.sort((a, b) => b.length - a.length)[0] ?? ""
  })()

  function isActive(href: string, exact?: boolean) {
    if (exact) return pathname === href
    return href === navMatchHref
  }

  const visibleSections = dashboardNavSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => isVisible(item)),
    }))
    .filter((section) => section.items.length > 0)

  const visiblePreferenceItems = preferenceItems.filter((item) => tieneAcceso(item.permiso))

  function isSectionExpanded(section: NavSection): boolean {
    // Si el usuario lo toggleó explícitamente, respetar
    if (section.title in expandedSections) return expandedSections[section.title]
    // Default: abrir si tiene un item activo (el grupo donde estás parado)
    return section.items.some((item) => isActive(item.href, item.exact))
  }

  function toggleSection(title: string) {
    setExpandedSections((prev) => {
      const current = title in prev
        ? prev[title]
        // Si no estaba registrado, calcular el valor default actual e invertirlo
        : visibleSections.find((s) => s.title === title)?.items.some((item) => isActive(item.href, item.exact)) ?? false
      return { ...prev, [title]: !current }
    })
  }

  function renderNavLink(item: NavItem, options: { isMobile: boolean; showCollapsedTooltip: boolean }) {
    const { isMobile, showCollapsedTooltip } = options
    const { label, href, icon: Icon, exact, openInNewTab } = item
    const active = isActive(href, exact)

    const link = (
      <Link
        key={href}
        href={href}
        {...(openInNewTab ? { target: "_blank", rel: "noreferrer" } : {})}
        onClick={() => isMobile && setMobileOpen(false)}
        aria-label={label}
        className={cn(
          "group flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-all duration-200",
          active
            ? "bg-primary/10 text-primary"
            : "text-slate-300/80 hover:bg-slate-800 hover:text-white"
        )}
      >
        <div
          className={cn(
            "flex h-6.5 w-6.5 shrink-0 items-center justify-center rounded-md border transition-all",
            active
              ? "border-primary/20 bg-primary/15 text-primary"
              : "border-transparent bg-transparent text-slate-500 group-hover:border-slate-700 group-hover:bg-slate-900 group-hover:text-sky-300"
          )}
        >
          <Icon className="h-4 w-4" />
        </div>
        {(isMobile || !collapsed) ? <span className="truncate leading-none">{label}</span> : null}
      </Link>
    )

    if (!showCollapsedTooltip) return link

    return (
      <TooltipProvider key={href}>
        <Tooltip>
          <TooltipTrigger asChild>{link}</TooltipTrigger>
          <TooltipContent side="right">{label}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  function renderSection(section: NavSection, options: { isMobile: boolean; showCollapsedTooltip: boolean }) {
    const { isMobile, showCollapsedTooltip } = options
    // En modo collapsed mini (solo iconos), no aplica el collapse de grupos —
    // todos los items se renderizan directo (UX de hoy preservada).
    const isCollapsedMini = !isMobile && collapsed
    if (isCollapsedMini) {
      return (
        <section key={section.title} className="space-y-1">
          <div className="space-y-1">
            {section.items.map((item) => renderNavLink(item, { isMobile, showCollapsedTooltip }))}
          </div>
        </section>
      )
    }

    const expanded = isSectionExpanded(section)
    return (
      <section key={section.title} className="space-y-1">
        <button
          type="button"
          onClick={() => toggleSection(section.title)}
          className="group flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left transition-colors hover:bg-slate-800/60"
          aria-expanded={expanded}
        >
          <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400/70 group-hover:text-slate-200">
            {section.title}
          </span>
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-slate-500 transition-transform duration-200 group-hover:text-slate-300",
              expanded ? "rotate-0" : "-rotate-90",
            )}
          />
        </button>

        <div
          className={cn(
            "grid transition-[grid-template-rows] duration-200 ease-out",
            expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
          )}
        >
          <div className="overflow-hidden">
            <div className="space-y-1 pt-0.5">
              {section.items.map((item) => renderNavLink(item, { isMobile, showCollapsedTooltip }))}
            </div>
          </div>
        </div>
      </section>
    )
  }

  const sidebarContent = (isMobile = false) => {
    const showCollapsedTooltip = !isMobile && collapsed

    return (
        <aside
        className={cn(
          "dark relative flex h-screen shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-all duration-300",
          isMobile ? "w-72 shadow-[0_30px_70px_rgba(2,6,23,0.55)]" : collapsed ? "w-[88px]" : "w-72"
        )}
      >
        <div className="flex h-14 items-center justify-between border-b border-sidebar-border px-4">
          {(isMobile || !collapsed) ? (
            <Link
              href="/dashboard"
              onClick={() => isMobile && setMobileOpen(false)}
              className="flex items-center gap-2 text-base font-bold leading-none tracking-tight text-sidebar-foreground transition-opacity hover:opacity-90"
            >
              <Image src="/ticketera_logo_app.svg" alt="" width={28} height={28} priority className="shrink-0" />
              <span className="font-[family-name:var(--font-sans)] text-lg font-semibold tracking-tight">
                Ticket<span className="font-normal opacity-75">era</span>
              </span>
            </Link>
          ) : (
            <Link
              href="/dashboard"
              className="mx-auto flex h-8 w-8 items-center justify-center rounded-lg transition-opacity hover:opacity-90"
              aria-label="Inicio"
            >
              <Image src="/ticketera_logo_app.svg" alt="" width={32} height={32} priority className="" />
            </Link>
          )}

          {isMobile ? (
            <button
              onClick={() => setMobileOpen(false)}
              className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
              aria-label="Cerrar menú"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>

        <nav className="flex-1 overflow-y-auto px-2.5 py-2">
          <div className="space-y-2.5">
            {visibleSections.map((section) => renderSection(section, { isMobile, showCollapsedTooltip }))}
          </div>
        </nav>

        <div className="border-t border-sidebar-border px-2.5 py-2">
          {(isMobile || !collapsed) ? (
            <div className="px-2.5 pb-0.5 pt-1">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-sidebar-foreground/40">
                Preferencias
              </p>
            </div>
          ) : null}

          <div className="space-y-1">
            {visiblePreferenceItems.map((item) => renderNavLink(item, { isMobile, showCollapsedTooltip }))}

            {showCollapsedTooltip ? (
              <div className="w-full">
                <ThemeToggle
                  collapsed
                  tooltipWhenCollapsed
                  navItemLike
                />
              </div>
            ) : (
              <div className="w-full">
                <ThemeToggle
                  collapsed={!isMobile && collapsed}
                  tooltipWhenCollapsed
                  navItemLike
                />
              </div>
            )}

            {(() => {
              const logoutButton = (
                <button
                  onClick={() => signOut({ callbackUrl: "/" })}
                  className="group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-rose-500 dark:text-rose-300 transition-all hover:bg-rose-500/10 hover:text-rose-600 dark:hover:text-rose-200"
                  aria-label="Cerrar sesión"
                >
                  <div className="flex h-6.5 w-6.5 shrink-0 items-center justify-center rounded-md border border-rose-500/20 bg-rose-500/10 text-rose-500 dark:text-rose-300 transition-colors group-hover:bg-rose-500/16">
                    <LogOut className="h-4 w-4" />
                  </div>
                  {(isMobile || !collapsed) ? <span>Cerrar sesión</span> : null}
                </button>
              )

              if (!showCollapsedTooltip) return logoutButton

              return (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>{logoutButton}</TooltipTrigger>
                    <TooltipContent side="right">Cerrar sesión</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )
            })()}
          </div>
        </div>

        {!isMobile ? (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setCollapsed(!collapsed)}
                  className="absolute -right-3 top-24 flex h-8 w-8 items-center justify-center rounded-xl border border-sidebar-border bg-sidebar text-sidebar-foreground/50 shadow-sm transition-colors hover:text-sidebar-foreground"
                  aria-label={collapsed ? "Expandir sidebar" : "Colapsar sidebar"}
                >
                  {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">{collapsed ? "Expandir sidebar" : "Colapsar sidebar"}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : null}
      </aside>
    )
  }

  return (
    <>
      <div className="hidden md:flex">{sidebarContent(false)}</div>

      <button
        onClick={() => setMobileOpen(true)}
        className="dark fixed left-4 top-4 z-40 flex h-11 w-11 items-center justify-center rounded-2xl border border-sidebar-border bg-sidebar text-sidebar-foreground/70 shadow-md transition-colors hover:text-sidebar-foreground md:hidden"
        aria-label="Abrir menú"
      >
        <Menu className="h-4 w-4" />
      </button>

      {mobileOpen ? (
        <>
          <div className="fixed inset-0 z-40 bg-foreground/30 backdrop-blur-[2px] md:hidden" onClick={() => setMobileOpen(false)} />
          <div className="fixed inset-y-0 left-0 z-50 flex md:hidden">{sidebarContent(true)}</div>
        </>
      ) : null}
    </>
  )
}
