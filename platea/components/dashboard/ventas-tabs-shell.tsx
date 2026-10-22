"use client"

import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"

import { buildVentasTabHref, type DashboardVentasTab } from "@/lib/dashboard-query-scope"
import { cn } from "@/lib/utils"

type VentasTabItem = {
  id: DashboardVentasTab
  label: string
}

export default function VentasTabsShell({
  tabs,
  activeTab,
  headerAction,
  children,
}: {
  tabs: VentasTabItem[]
  activeTab: DashboardVentasTab
  headerAction?: React.ReactNode
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Ventas</h1>
            <p className="text-sm text-muted-foreground mt-1">Entradas y consumibles de todos tus eventos.</p>
          </div>
          {headerAction ? <div className="shrink-0">{headerAction}</div> : null}
        </div>

        <nav className="inline-flex rounded-xl border border-border bg-card p-1" aria-label="Secciones de ventas">
          {tabs.map((tab) => {
            const active = tab.id === activeTab
            return (
              <Link
                key={tab.id}
                href={buildVentasTabHref(pathname, searchParams, tab.id)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-lg px-4 py-2 text-sm font-medium transition-colors",
                  active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {tab.label}
              </Link>
            )
          })}
        </nav>
      </div>

      {children}
    </div>
  )
}
