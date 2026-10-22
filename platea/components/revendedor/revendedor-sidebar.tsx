"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { signOut } from "next-auth/react"
import { BarChart2, LogOut, Menu, Ticket, X, ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import ThemeToggle from "@/components/theme-toggle"

interface Props {
  nombre: string
  empresaId: string
}

export default function RevendedorSidebar({ nombre, empresaId }: Props) {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const pathname = usePathname()

  const navItems = [
    { label: "Mi panel", href: "/revendedor", icon: BarChart2, exact: true },
    { label: "Tickets físicos", href: "/revendedor/tickets-fisicos", icon: Ticket, exact: false },
  ]

  function isActive(href: string, exact?: boolean) {
    if (exact) return pathname === href
    return pathname.startsWith(href)
  }

  const sidebarContent = (isMobile = false) => (
    <aside
      className={cn(
        "relative flex flex-col h-screen bg-card border-r border-border transition-all duration-300 shrink-0",
        isMobile ? "w-60" : collapsed ? "w-16" : "w-60"
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-4 h-16 border-b border-border overflow-hidden">
        <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center text-primary-foreground font-bold text-sm shrink-0">
          {nombre[0]?.toUpperCase() ?? "R"}
        </div>
        {(isMobile || !collapsed) && (
          <div className="overflow-hidden">
            <p className="text-sm font-semibold text-foreground truncate">{nombre}</p>
            <p className="text-xs text-muted-foreground">Revendedor</p>
          </div>
        )}
        {isMobile && (
          <button
            onClick={() => setMobileOpen(false)}
            className="ml-auto text-muted-foreground hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-4 space-y-1 overflow-y-auto">
        {navItems.map(({ label, href, icon: Icon, exact }) => (
          <Link
            key={href}
            href={href}
            onClick={() => isMobile && setMobileOpen(false)}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all",
              isActive(href, exact)
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {(isMobile || !collapsed) && <span className="truncate">{label}</span>}
          </Link>
        ))}
      </nav>

      {/* Bottom */}
      <div className="px-2 py-4 border-t border-border space-y-1">
        <ThemeToggle collapsed={!isMobile && collapsed} />
        <button
          onClick={() => signOut({ callbackUrl: "/" })}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-destructive hover:bg-destructive/10 transition-all"
        >
          <LogOut className="h-4 w-4 shrink-0" />
          {(isMobile || !collapsed) && <span>Cerrar sesión</span>}
        </button>
      </div>

      {!isMobile && (
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="absolute -right-3 top-20 h-6 w-6 rounded-full bg-card border border-border flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors shadow-sm"
        >
          {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronLeft className="h-3 w-3" />}
        </button>
      )}
    </aside>
  )

  return (
    <>
      <div className="hidden md:flex">{sidebarContent(false)}</div>
      <button
        onClick={() => setMobileOpen(true)}
        className="md:hidden fixed top-4 left-4 z-40 h-9 w-9 rounded-xl bg-card border border-border flex items-center justify-center text-muted-foreground hover:text-foreground shadow-sm"
      >
        <Menu className="h-4 w-4" />
      </button>
      {mobileOpen && (
        <>
          <div
            className="md:hidden fixed inset-0 z-40 bg-black/50"
            onClick={() => setMobileOpen(false)}
          />
          <div className="md:hidden fixed inset-y-0 left-0 z-50 flex">{sidebarContent(true)}</div>
        </>
      )}
    </>
  )
}
