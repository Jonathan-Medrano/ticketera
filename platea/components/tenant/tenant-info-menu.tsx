"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { ChevronRight, Menu } from "lucide-react"
import { useTenant } from "./tenant-provider"
import { buildTenantPath, tenantRoutes } from "@/lib/tenant-routes"
import { normalizeTenantInfoPages } from "@/lib/tenant"
import { getContrastTextColor, withOpacity } from "@/lib/color-contrast"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { getTenantInfoPageSlug, type TenantInfoPageKey } from "@/lib/tenant-info"
import { useTenantBuyerSession } from "./tenant-buyer-session-provider"

export type TenantInfoMenuSection = {
  id: "cuenta" | "informacion" | "ayuda"
  title: string
  items: Array<{
    href: string
    label: string
  }>
}

export function buildTenantInfoMenuSections(options: {
  tenantSlug: string
  enabledPages: Array<{ key: string; title: string }>
  isBuyerAuthenticated: boolean
}): TenantInfoMenuSection[] {
  const sections: TenantInfoMenuSection[] = []

  if (options.isBuyerAuthenticated) {
    sections.push({
      id: "cuenta",
      title: "Cuenta",
      items: [
        {
          href: buildTenantPath(options.tenantSlug, tenantRoutes.misTickets()),
          label: "Mis tickets",
        },
        {
          href: buildTenantPath(options.tenantSlug, tenantRoutes.configuracion()),
          label: "Configuraciones",
        },
      ],
    })
  }

  if (options.enabledPages.length > 0) {
    sections.push({
      id: "informacion",
      title: "Información",
      items: options.enabledPages.map((page) => ({
        href: buildTenantPath(options.tenantSlug, tenantRoutes.informacionPage(getTenantInfoPageSlug(page.key as TenantInfoPageKey))),
        label: page.title,
      })),
    })
  }

  sections.push({
    id: "ayuda",
    title: "Ayuda",
    items: [
      {
        href: buildTenantPath(options.tenantSlug, tenantRoutes.soporte()),
        label: "Soporte",
      },
    ],
  })

  return sections
}

export default function TenantInfoMenu({
  triggerClassName,
  iconClassName,
}: {
  triggerClassName: string
  iconClassName: string
}) {
  const tenant = useTenant()
  const { buyerSession, status } = useTenantBuyerSession()
  const [open, setOpen] = useState(false)
  const navbarColor = tenant.navbar_color?.trim() || tenant.color_primario
  const navForeground = getContrastTextColor(navbarColor)
  const navSurface = withOpacity(navForeground, 0.14)
  const navBorder = withOpacity(navForeground, 0.18)

  const enabledPages = useMemo(
    () => normalizeTenantInfoPages(tenant.info_pages).filter((page) => page.enabled && page.content.trim().length > 0),
    [tenant.info_pages]
  )

  const sections = useMemo(
    () => buildTenantInfoMenuSections({
      tenantSlug: tenant.slug,
      enabledPages,
      isBuyerAuthenticated: status === "authenticated" && buyerSession?.userType === "comprador",
    }),
    [buyerSession?.userType, enabledPages, status, tenant.slug]
  )

  if (sections.length === 0) return null

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`${triggerClassName} inline-flex items-center justify-center rounded-full transition-colors md:hidden`}
        style={{ background: navSurface, color: navForeground, border: `1px solid ${navBorder}` }}
        aria-label="Abrir menú"
      >
        <Menu className={`${iconClassName} shrink-0`} />
      </button>

      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={`${triggerClassName} rounded-full transition-colors hidden md:inline-flex md:items-center md:justify-center`}
            style={{ background: navSurface, color: navForeground, border: `1px solid ${navBorder}` }}
            aria-label="Abrir menú"
          >
            <Menu className={`${iconClassName} shrink-0`} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="hidden min-w-56 rounded-2xl border p-1.5 md:block"
          style={{
            background: tenant.color_fondo,
            borderColor: `${tenant.color_texto}15`,
            color: tenant.color_texto,
            // Override del accent-foreground del sistema. Sin esto, shadcn's DropdownMenuItem
            // aplica focus:text-accent-foreground que en light mode es un azul saturado
            // que no matchea el theme del tenant. Inline gana sobre la cascada porque
            // ningún rule del sistema setea --accent-foreground con !important.
            ['--accent-foreground' as string]: tenant.color_texto,
          }}
        >
          {sections.map((section, sectionIndex) => (
            <div key={section.id} className={sectionIndex > 0 ? "mt-2 border-t pt-2" : ""} style={sectionIndex > 0 ? { borderColor: `${tenant.color_texto}10` } : undefined}>
              <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: `${tenant.color_texto}66` }}>{section.title}</p>
              {section.items.map((item) => (
                <DropdownMenuItem key={item.href} asChild className="rounded-xl px-3 py-2.5 focus:bg-[color:var(--tenant-menu-hover)]">
                  <Link
                    href={item.href}
                    className="flex items-center justify-between gap-3"
                    style={{ color: tenant.color_texto, ['--tenant-menu-hover' as string]: `${tenant.color_texto}1f` }}
                  >
                    <span className="font-medium">{item.label}</span>
                    <ChevronRight className="h-4 w-4 opacity-60" />
                  </Link>
                </DropdownMenuItem>
              ))}
            </div>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="ml-auto flex h-screen max-h-screen w-full max-w-md flex-col gap-0 rounded-none border-0 p-0 overflow-hidden sm:rounded-none">
          <DialogHeader className="px-5 py-4 border-b" style={{ background: navbarColor, borderColor: navBorder }}>
            <DialogTitle style={{ color: navForeground }}>Menú</DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-3" style={{ background: tenant.color_fondo }}>
            {sections.map((section) => (
              <div key={section.id} className="space-y-3">
                <p className="px-1 text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: `${tenant.color_texto}66` }}>{section.title}</p>
                {section.items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className="flex items-center justify-between rounded-2xl border px-4 py-4"
                    style={{ borderColor: `${tenant.color_texto}15`, background: `${tenant.color_texto}05`, color: tenant.color_texto }}
                  >
                    <span className="font-medium">{item.label}</span>
                    <ChevronRight className="h-4 w-4 opacity-60" />
                  </Link>
                ))}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
