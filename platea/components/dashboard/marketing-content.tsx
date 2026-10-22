"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { ChevronLeft, Megaphone } from "lucide-react"
import { cn } from "@/lib/utils"
import { marketingSecciones } from "@/lib/marketing-secciones"

const navItems = marketingSecciones.map(({ href, label }) => ({ href, label }))

export default function MarketingContent() {
  const pathname = usePathname()
  const isIndex = pathname === "/dashboard/marketing"

  return (
    <div className="flex flex-col gap-6 pb-6">
      <div className="flex items-center gap-3">
        {!isIndex && (
          <Link
            href="/dashboard/marketing"
            aria-label="Volver a Marketing"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground"
          >
            <ChevronLeft className="h-5 w-5" />
          </Link>
        )}
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
          <Megaphone className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-foreground">Marketing</h1>
          <p className="text-sm text-muted-foreground">Promociones, segmentos, email y analítica</p>
        </div>
      </div>

      <nav aria-label="Secciones de marketing" className="flex gap-1 overflow-x-auto border-b border-border pb-0">
        {navItems.map(({ href, label }) => {
          const active = pathname === href || pathname.startsWith(href + "/")
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative shrink-0 whitespace-nowrap px-3 pb-3 pt-1 text-[13px] font-medium transition-colors",
                active
                  ? "text-primary after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:rounded-full after:bg-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {label}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
