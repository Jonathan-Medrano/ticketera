"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Beer, CalendarDays, LifeBuoy, Tag } from "lucide-react"
import { useTenant } from "./tenant-provider"
import { buildTenantPath, tenantRoutes } from "@/lib/tenant-routes"
import { shouldHideTenantBottomNav } from "@/lib/tenant-bottom-nav"

export default function TenantBottomNav({ hasConsumibles }: { hasConsumibles: boolean }) {
  const tenant = useTenant()
  const pathname = usePathname()
  const hideNav = shouldHideTenantBottomNav(pathname)

  if (hideNav) {
    return null
  }

  const items = [
    { href: buildTenantPath(tenant.slug, tenantRoutes.home()), icon: CalendarDays, label: "Eventos" },
    ...(hasConsumibles ? [{ href: `/t/${tenant.slug}${tenantRoutes.consumibles()}`, icon: Beer, label: "Consumibles" }] : []),
    { href: buildTenantPath(tenant.slug, tenantRoutes.misTickets()), icon: Tag, label: "Mis tickets" },
    { href: buildTenantPath(tenant.slug, tenantRoutes.soporte()), icon: LifeBuoy, label: "Soporte" },
  ]

  const activePath = pathname.startsWith(`/t/${tenant.slug}/consumibles`) ? `/t/${tenant.slug}${tenantRoutes.consumibles()}` : pathname

  return (
    <div
      className="fixed bottom-0 left-0 right-0 backdrop-blur-md border-t z-40 md:hidden"
      style={{ background: `${tenant.color_fondo}e8`, borderColor: `${tenant.color_texto}1f` }}
    >
      <div
        className="max-w-6xl mx-auto flex"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {items.map(({ href, icon: Icon, label }) => {
          const active = href === activePath
          return (
            <Link
              key={href}
              href={href}
              className="flex-1 flex flex-col items-center pt-2 pb-3 gap-0.5 transition-all"
              style={{ color: active ? tenant.color_primario : `${tenant.color_texto}55` }}
            >
              <div
                className="rounded-xl px-3.5 py-1.5 transition-all"
                style={{ background: active ? `${tenant.color_primario}22` : "transparent" }}
              >
                <Icon className="h-5 w-5" />
              </div>
              <span className={`text-xs font-medium transition-colors ${active ? "font-semibold" : ""}`}>{label}</span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
