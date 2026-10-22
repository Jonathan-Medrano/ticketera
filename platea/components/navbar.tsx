"use client"

import { useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { signOut, useSession } from "next-auth/react"
import { ChevronDown, Globe, LayoutDashboard, LogOut, Menu, Settings, X } from "lucide-react"

import ThemeToggle from "@/components/theme-toggle"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { getPlatformConsoleHomePath, isPlatformConsoleActor } from "@/lib/internal-actor-routing"
import { buildTenantPublicUrl } from "@/lib/tenant-routes"

function isInternalSession(session: ReturnType<typeof useSession>["data"]) {
  const userType = session?.user?.userType
  return userType === "empresa" || userType === "empleado" || userType === "super_admin" || userType === "platform_staff"
}

type NavbarLink = {
  href: string
  label: string
  highlight?: boolean
}

const defaultMarketingLinks: NavbarLink[] = [
  { href: "/#funcionalidades", label: "Funcionalidades" },
  { href: "/#control", label: "Liquidaciones" },
  { href: "/precios", label: "Precios", highlight: true },
]

type NavbarProps = {
  links?: readonly NavbarLink[]
}

export default function Navbar({ links = defaultMarketingLinks }: NavbarProps) {
  const { data: session, status } = useSession()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const internalSession = isInternalSession(session)
  const internalUser = internalSession ? session?.user ?? null : null
  const internalHomeHref = isPlatformConsoleActor(session?.user ?? {})
    ? getPlatformConsoleHomePath(session?.user ?? {})
    : "/dashboard"
  const settingsHref = isPlatformConsoleActor(session?.user ?? {})
    ? "/super-admin/configuracion"
    : "/dashboard/configuracion"

  const nombreCorto = internalUser?.name?.split(" ")[0] ?? ""
  const tenantPublicUrl = internalUser?.slug ? buildTenantPublicUrl(internalUser.slug) : undefined

  if (status === "loading") {
    return (
      <header className="sticky top-0 z-50 border-b border-[color:var(--marketing-border)] bg-[color:var(--marketing-bg)]">
        <div className="mx-auto flex h-16 w-full max-w-[1600px] items-center justify-between gap-4 px-6 md:px-10">
          <Link className="shrink-0 inline-flex items-center gap-2" href="/" aria-label="Ticketera">
            <Image src="/ticketera_logo_app.svg" alt="" width={28} height={28} priority className="shrink-0" />
            <span className="marketing-brand-wordmark text-xl">Ticket<span>era</span></span>
          </Link>

          <div className="hidden items-center gap-5 lg:ml-8 lg:flex" aria-hidden="true">
            <div className="h-3 w-16 animate-pulse rounded bg-[color:var(--marketing-accent-soft)]" />
            <div className="h-3 w-20 animate-pulse rounded bg-[color:var(--marketing-accent-soft)]" />
          </div>

          <div className="ml-auto flex items-center gap-2" aria-hidden="true">
            <div className="h-9 w-9 animate-pulse rounded-xl bg-[color:var(--marketing-accent-soft)]" />
            <div className="hidden h-10 w-28 animate-pulse rounded-full bg-[color:var(--marketing-accent-soft)] lg:block" />
          </div>
        </div>
      </header>
    )
  }

  return (
    <header className="sticky top-0 z-50 border-b border-[color:var(--marketing-border)] bg-[color:var(--marketing-bg)]">
      <div className="mx-auto flex h-16 w-full max-w-[1600px] items-center justify-between gap-4 px-6 md:px-10">
        <Link className="shrink-0 inline-flex items-center gap-2" href="/" aria-label="Ticketera">
          <Image src="/ticketera_logo_app.svg" alt="" width={28} height={28} priority className="shrink-0" />
          <span className="marketing-brand-wordmark text-xl">Ticket<span>era</span></span>
        </Link>

        <nav className="hidden items-center gap-1 lg:ml-8 text-sm lg:flex">
          {links.map(({ href, label, highlight }) => (
            <Link
              key={href}
              href={href}
              className={
                highlight
                  ? "rounded-full border border-[color:var(--marketing-accent)]/30 bg-[color:var(--marketing-accent-soft)] px-3 py-1 text-sm font-semibold text-[color:var(--marketing-accent)] transition-colors hover:bg-[color:var(--marketing-accent-soft)]/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--marketing-accent)] focus-visible:ring-offset-2"
                  : "rounded-md px-2 py-1 text-[color:var(--marketing-muted)] transition-colors hover:text-[color:var(--marketing-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--marketing-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--marketing-bg-mid)]"
              }
            >
              {label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle collapsed />

          {internalSession ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-10 gap-2 rounded-2xl border-[color:var(--marketing-border-strong)] bg-[color:var(--marketing-surface)]/95 pl-2 pr-3 text-[color:var(--marketing-ink)] transition-colors duration-200 ease-out hover:border-[color:var(--marketing-accent)]/40 hover:bg-[color:var(--marketing-surface)]"
                >
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[color:var(--marketing-avatar-bg)] text-xs font-bold text-[color:var(--marketing-action-primary-text)]">
                    {nombreCorto[0]?.toUpperCase() ?? "?"}
                  </div>
                  <span className="hidden text-sm font-medium sm:inline">{nombreCorto}</span>
                  <ChevronDown aria-hidden="true" className="h-3 w-3 shrink-0 text-[color:var(--marketing-muted)]" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="w-64 rounded-2xl border border-[color:var(--marketing-border-strong)] bg-[linear-gradient(180deg,var(--marketing-panel-top),var(--marketing-panel-bottom))] p-2 text-[color:var(--marketing-ink)] shadow-[0_24px_80px_rgba(2,6,23,0.38)]"
              >
                <div className="rounded-xl border border-[color:var(--marketing-border)] bg-[color:var(--marketing-surface)]/80 px-3 py-3">
                  <p className="text-sm font-semibold text-[color:var(--marketing-ink-strong)]">{internalUser?.name}</p>
                  <p className="truncate text-xs text-[color:var(--marketing-muted)]">{internalUser?.email}</p>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  asChild
                  className="[--accent:#68a1ff26] [--accent-foreground:var(--marketing-ink-strong)]"
                >
                  <Link href={internalHomeHref} className="cursor-pointer gap-2 rounded-xl px-2 py-2 font-medium">
                    <LayoutDashboard aria-hidden="true" className="h-4 w-4" /> Ir al dashboard
                  </Link>
                </DropdownMenuItem>
                {tenantPublicUrl ? (
                  <DropdownMenuItem
                    asChild
                    className="[--accent:#68a1ff26] [--accent-foreground:var(--marketing-ink-strong)]"
                  >
                    <Link href={tenantPublicUrl} target="_blank" className="cursor-pointer gap-2 rounded-xl px-2 py-2 font-medium">
                      <Globe aria-hidden="true" className="h-4 w-4" /> Ver mi plataforma
                    </Link>
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem
                  asChild
                  className="[--accent:#68a1ff26] [--accent-foreground:var(--marketing-ink-strong)]"
                >
                  <Link href={settingsHref} className="cursor-pointer gap-2 rounded-xl px-2 py-2 font-medium">
                    <Settings aria-hidden="true" className="h-4 w-4" /> Configuración
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  className="cursor-pointer gap-2 rounded-xl px-2 py-2 font-medium"
                  onClick={() => signOut({ callbackUrl: "/" })}
                >
                  <LogOut aria-hidden="true" className="h-4 w-4" /> Cerrar sesión
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <>
              <Button variant="ghost" size="sm" asChild className="hidden h-9 lg:flex">
                <Link href="/login">Iniciar sesión</Link>
              </Button>
              <Button
                size="sm"
                asChild
                className="hidden h-10 rounded-full bg-[color:var(--marketing-action-primary-bg)] px-4 font-semibold text-[color:var(--marketing-action-primary-text)] shadow-[0_4px_12px_rgba(0,82,204,0.18)] transition-colors duration-200 hover:bg-[color:var(--marketing-action-primary-hover)] lg:flex"
              >
                <Link href="/login?tab=registro">Crear mi espacio</Link>
              </Button>
              <Button variant="ghost" size="sm" asChild className="h-9 lg:hidden">
                <Link href="/login">Ingresar</Link>
              </Button>
              <Button
                size="sm"
                asChild
                className="h-9 rounded-full bg-[color:var(--marketing-action-primary-bg)] px-3 text-sm font-semibold text-[color:var(--marketing-action-primary-text)] transition-colors duration-200 hover:bg-[color:var(--marketing-action-primary-hover)] lg:hidden"
              >
                <Link href="/login?tab=registro">Registrate</Link>
              </Button>
            </>
          )}

          <button
            className="flex h-11 w-11 items-center justify-center rounded-xl text-[color:var(--marketing-muted)] transition-colors duration-200 ease-out hover:bg-[color:var(--marketing-accent-soft)] hover:text-[color:var(--marketing-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--marketing-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--marketing-bg-mid)] lg:hidden"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label={mobileMenuOpen ? "Cerrar menú" : "Abrir menú"}
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-nav"
          >
            {mobileMenuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {mobileMenuOpen ? (
        <div id="mobile-nav" className="border-t border-[color:var(--marketing-border)] bg-[color:var(--marketing-surface)]/95 px-4 py-3 lg:hidden">
          <div className="flex flex-col gap-1">
            {links.map(({ href, label, highlight }) => (
              <Link
                key={href}
                href={href}
                className={
                  highlight
                    ? "rounded-xl border border-[color:var(--marketing-accent)]/25 bg-[color:var(--marketing-accent-soft)] px-3 py-2.5 text-sm font-semibold text-[color:var(--marketing-accent)] transition-colors duration-200 ease-out hover:bg-[color:var(--marketing-accent-soft)]/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--marketing-accent)]"
                    : "rounded-xl px-3 py-2.5 text-sm text-[color:var(--marketing-muted)] transition-colors duration-200 ease-out hover:bg-[color:var(--marketing-accent-soft)] hover:text-[color:var(--marketing-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--marketing-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--marketing-surface)]"
                }
                onClick={() => setMobileMenuOpen(false)}
              >
                {label}
              </Link>
            ))}
            <div className="mt-1 border-t border-[color:var(--marketing-border)] pt-3">
              {internalSession ? (
                <Button
                  size="sm"
                  asChild
                  className="h-10 w-full rounded-full bg-[color:var(--marketing-action-primary-bg)] font-semibold text-[color:var(--marketing-action-primary-text)] hover:bg-[color:var(--marketing-action-primary-hover)]"
                >
                  <Link href={internalHomeHref} onClick={() => setMobileMenuOpen(false)}>Ir al dashboard</Link>
                </Button>
              ) : (
                <Button
                  size="sm"
                  asChild
                  className="h-10 w-full rounded-full bg-[color:var(--marketing-action-primary-bg)] font-semibold text-[color:var(--marketing-action-primary-text)] hover:bg-[color:var(--marketing-action-primary-hover)]"
                >
                  <Link href="/login?tab=registro">Crear mi espacio</Link>
                </Button>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </header>
  )
}
