"use client"

import { useEffect, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { signOut } from "next-auth/react"
import { Activity, AlertOctagon, Building2, Crown, FileText, LineChart, LogOut, Megaphone, MessageSquare, Menu, Percent, Settings2, Shield, TrendingDown, Users, X } from "lucide-react"
import { getPlatformRoleLabel, isSingletonOnlyRole } from "@/components/super-admin/utils"
import type { PlatformCapabilityKey, PlatformDirectPermissions, PlatformViewerPolicy } from "@/components/super-admin/types"
import { hasPlatformCapability } from "@/lib/internal-actor-routing"
import ThemeToggle from "@/components/theme-toggle"
import { cn } from "@/lib/utils"

type SuperAdminNavItem = {
  href: string
  label: string
  description: string
  icon: typeof Crown
  capability: PlatformCapabilityKey
}

export const superAdminNavItems: SuperAdminNavItem[] = [
  { href: "/super-admin/dashboard", label: "Dashboard", description: "Métricas owner y breakdown por flow", icon: Crown, capability: "platform.revenue.view.own" },
  { href: "/super-admin/analitica", label: "Analítica", description: "Evolución temporal de ingresos y comparativa", icon: LineChart, capability: "platform.revenue.view.own" },
  { href: "/super-admin/empresas", label: "Empresas", description: "Readiness, fees y gestión por empresa", icon: Building2, capability: "platform.companies.read" },
  { href: "/super-admin/mensajes", label: "Mensajes", description: "Avisos y comunicados a empresas", icon: MessageSquare, capability: "platform.companies.read" },
  { href: "/super-admin/landing-announcement", label: "Anuncio landing", description: "Barra superior pública editable de la home", icon: Megaphone, capability: "platform.settings.read" },
  { href: "/super-admin/configuracion", label: "Configuración", description: "Defaults globales, payout owner y configuración platform", icon: Settings2, capability: "platform.settings.read" },
  { href: "/super-admin/usuarios", label: "Usuarios", description: "Jerarquía, capacidades y grants platform", icon: Users, capability: "platform.users.read" },
  { href: "/super-admin/comisiones", label: "Comisiones", description: "Overrides de comisiones del equipo por empresa", icon: Percent, capability: "platform.companies.read" },
  { href: "/super-admin/fee-tiers", label: "Comisión por volumen", description: "Escalera de tiers y subas de comisión pendientes", icon: TrendingDown, capability: "platform.settings.read" },
  { href: "/super-admin/auditoria", label: "Auditoría", description: "Registro de acciones críticas del super-admin", icon: FileText, capability: "platform.settings.read" },
  { href: "/super-admin/logs", label: "Logs de errores", description: "Errores backend + frontend agrupados, con filtros y resolución", icon: AlertOctagon, capability: "platform.settings.read" },
  { href: "/super-admin/rendimiento", label: "Rendimiento", description: "Salud del sistema, alertas predictivas y tests sintéticos", icon: Activity, capability: "platform.companies.read" },
]

const navGroups = [
  {
    label: "Resumen",
    items: ["/super-admin/dashboard", "/super-admin/analitica"],
  },
  {
    label: "Operación",
    items: ["/super-admin/empresas", "/super-admin/usuarios", "/super-admin/comisiones", "/super-admin/fee-tiers", "/super-admin/mensajes"],
  },
  {
    label: "Sistema",
    items: ["/super-admin/landing-announcement", "/super-admin/configuracion", "/super-admin/auditoria", "/super-admin/logs", "/super-admin/rendimiento"],
  },
] as const

export default function SuperAdminSidebar({
  ownerName,
  roleSlug,
  singletonKey,
  permisos,
  platformCapabilities,
  viewerPolicy,
}: {
  ownerName: string
  roleSlug?: "superadmin" | "staff"
  singletonKey?: string | null
  permisos?: PlatformDirectPermissions
  platformCapabilities?: PlatformCapabilityKey[]
  viewerPolicy?: PlatformViewerPolicy
}) {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [pendingEmpresasCount, setPendingEmpresasCount] = useState(0)
  const singleton = isSingletonOnlyRole(roleSlug, singletonKey)
  const actor = { userType: singleton ? "super_admin" as const : "platform_staff" as const, singletonKey, permisos, platformCapabilities, platformViewerPolicy: viewerPolicy }
  const visibleNavItems = superAdminNavItems.filter((item) => singleton || hasPlatformCapability(actor, item.capability))
  const visibleItemMap = new Map(visibleNavItems.map((item) => [item.href, item]))

  useEffect(() => {
    if (!hasPlatformCapability(actor, "platform.companies.read")) return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch("/api/platform/empresas")
        if (!res.ok || cancelled) return
        const data = await res.json() as { data?: { empresas?: Array<{ aprobada: boolean }> } }
        if (cancelled) return
        const count = (data.data?.empresas ?? []).filter((e) => e.aprobada === false).length
        setPendingEmpresasCount(count)
      } catch {
        // silencioso — badge no crítico
      }
    })()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // El drawer se cierra al navegar (onClick en cada Link) y con la tecla Escape.
  useEffect(() => {
    if (!mobileOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [mobileOpen])

  const sidebarContent = (isMobile: boolean) => (
    <>
      {/* Header */}
      <div className="flex items-start justify-between border-b border-[var(--superadmin-sidebar-border)] px-5 py-6">
        <div>
          <div className="flex items-center gap-2.5">
            <Image src="/ticketera_logo_app.svg" alt="" width={30} height={30} priority className="shrink-0" />
            <span className="font-[family-name:var(--font-sans)] text-[19px] font-semibold tracking-tight text-[var(--superadmin-sidebar-muted)]">
              TICKET<span className="font-normal text-primary">ERA</span>
            </span>
          </div>
          <p className="mt-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--superadmin-sidebar-muted)]/35">Platform Console</p>
        </div>
        {isMobile ? (
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label="Cerrar menú"
            className="-mr-1 flex h-8 w-8 items-center justify-center rounded-lg text-[var(--superadmin-sidebar-muted)]/40 transition-colors hover:bg-[var(--superadmin-sidebar-panel)] hover:text-[var(--superadmin-sidebar-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4">
        <div className="space-y-4">
          {navGroups.map((group) => {
            const items = group.items
              .map((href) => visibleItemMap.get(href))
              .filter((item): item is SuperAdminNavItem => Boolean(item))
            if (items.length === 0) return null

            return (
              <div key={group.label}>
                <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.28em] text-[var(--superadmin-sidebar-muted)]/30">{group.label}</p>
                <div className="space-y-0.5">
                  {items.map(({ href, label, icon: Icon, description }) => {
                    const active = pathname === href || pathname.startsWith(`${href}/`)

                    const showPendingBadge = href === "/super-admin/empresas" && pendingEmpresasCount > 0

                    return (
                      <Link
                        key={href}
                        href={href}
                        title={description}
                        onClick={() => setMobileOpen(false)}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex items-center gap-3 rounded-lg px-3 py-2.5 text-[14px] font-medium transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
                          active
                            ? "bg-primary/10 text-primary"
                            : "text-[var(--superadmin-sidebar-muted)]/50 hover:bg-[var(--superadmin-sidebar-panel)] hover:text-[var(--superadmin-sidebar-muted)]/80"
                        )}
                      >
                        <Icon className={cn("h-[15px] w-[15px] shrink-0", active ? "text-primary" : "text-[var(--superadmin-sidebar-muted)]/35")} />
                        <span className="flex-1">{label}</span>
                        {showPendingBadge && (
                          <span className="ml-auto flex h-5 min-w-[20px] items-center justify-center rounded-full bg-warning px-1.5 text-[10px] font-bold leading-none text-white">
                            {pendingEmpresasCount}
                          </span>
                        )}
                      </Link>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </nav>

      {/* Bottom: user + actions */}
      <div className="mt-auto border-t border-[var(--superadmin-sidebar-border)] px-3 py-3">
        <div className="mb-2.5 flex items-center gap-3 rounded-xl border border-[var(--superadmin-sidebar-border)] bg-[var(--superadmin-sidebar-panel)] px-3 py-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
            {(ownerName || "OW")
              .split(" ")
              .map((part) => part[0])
              .join("")
              .slice(0, 2)
              .toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold text-[var(--superadmin-sidebar-muted)]">{ownerName}</p>
            <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[var(--superadmin-sidebar-muted)]/40">
              <Shield className="h-3 w-3 text-primary" />
              <span>{getPlatformRoleLabel(roleSlug)}</span>
            </div>
          </div>
        </div>

        <div className="space-y-1">
          <ThemeToggle compact />
          <button
            type="button"
            className="flex h-10 w-full items-center justify-start gap-2.5 rounded-lg border border-[var(--superadmin-sidebar-border)] bg-[var(--superadmin-sidebar-bg)] px-3 text-sm font-medium text-[var(--superadmin-sidebar-muted)]/70 shadow-none transition-colors hover:bg-[var(--superadmin-sidebar-panel)] hover:text-[var(--superadmin-sidebar-muted)]"
            onClick={() => signOut({ callbackUrl: "/login" })}
          >
            <LogOut className="h-4 w-4 shrink-0" />
            <span>Cerrar sesión</span>
          </button>
        </div>
      </div>
    </>
  )

  return (
    <>
      {/* Sidebar fijo (desktop) */}
      <aside className="hidden h-screen w-[248px] shrink-0 flex-col border-r border-[var(--superadmin-sidebar-border)] bg-[var(--superadmin-sidebar-bg)] lg:flex lg:overflow-y-auto">
        {sidebarContent(false)}
      </aside>

      {/* Botón hamburguesa (mobile/tablet) */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        aria-label="Abrir menú"
        aria-expanded={mobileOpen}
        aria-controls="superadmin-mobile-nav"
        className="fixed left-4 top-4 z-40 flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-card text-foreground shadow-lg transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Backdrop (mobile/tablet) */}
      <div
        onClick={() => setMobileOpen(false)}
        aria-hidden="true"
        className={cn(
          "fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px] transition-opacity duration-200 motion-reduce:transition-none lg:hidden",
          mobileOpen ? "opacity-100" : "pointer-events-none opacity-0"
        )}
      />

      {/* Drawer (mobile/tablet) */}
      <div
        id="superadmin-mobile-nav"
        role="dialog"
        aria-modal="true"
        aria-label="Navegación del panel"
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-[280px] max-w-[85vw] flex-col overflow-y-auto border-r border-[var(--superadmin-sidebar-border)] bg-[var(--superadmin-sidebar-bg)] shadow-2xl transition-transform duration-200 ease-out motion-reduce:transition-none lg:hidden",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {sidebarContent(true)}
      </div>
    </>
  )
}
