"use client"

import Link from "next/link"
import { useSession } from "next-auth/react"
import { ArrowRight, Globe, LayoutDashboard } from "lucide-react"

import { Button } from "@/components/ui/button"
import { getPlatformConsoleHomePath, isPlatformConsoleActor } from "@/lib/internal-actor-routing"
import { buildTenantPublicUrl } from "@/lib/tenant-routes"

type MarketingActionsProps = {
  className?: string
  primaryClassName?: string
  secondaryClassName?: string
  secondaryHref?: string
  secondaryLabel?: string
  showSecondary?: boolean
}

export default function MarketingActions({
  className,
  primaryClassName,
  secondaryClassName,
  secondaryHref = "#funcionalidades",
  secondaryLabel = "Ver cómo funciona",
  showSecondary = true,
}: MarketingActionsProps) {
  const { data: session } = useSession()
  const esSesionInterna = session?.user?.userType === "empresa" || session?.user?.userType === "empleado" || session?.user?.userType === "super_admin" || session?.user?.userType === "platform_staff"
  const internalHomeHref = isPlatformConsoleActor(session?.user ?? {})
    ? getPlatformConsoleHomePath(session?.user ?? {})
    : "/dashboard"

  const primary = esSesionInterna
    ? {
        href: internalHomeHref,
        label: "Ir a mi dashboard",
        icon: <LayoutDashboard aria-hidden="true" className="h-4 w-4" />,
      }
    : {
        href: "/login?tab=registro",
        label: "Crear mi espacio",
        icon: <ArrowRight aria-hidden="true" className="h-4 w-4" />,
      }

  const secondary = esSesionInterna && session?.user?.slug
    ? {
        href: buildTenantPublicUrl(session.user.slug),
        label: "Ver mi sitio",
        icon: <Globe aria-hidden="true" className="h-4 w-4" />,
        target: "_blank",
      }
    : {
        href: secondaryHref,
        label: secondaryLabel,
        icon: <ArrowRight aria-hidden="true" className="h-4 w-4" />,
        target: undefined,
      }

  return (
    <div className={className ?? "flex flex-col sm:flex-row gap-3"}>
      <Button
        size="lg"
        asChild
        className={
          primaryClassName ??
          "h-12 w-full rounded-full bg-[color:var(--marketing-action-primary-bg)] px-6 text-sm font-semibold text-[color:var(--marketing-action-primary-text)] shadow-[0_8px_20px_rgba(6,26,61,0.12)] transition-colors duration-200 ease-out hover:bg-[color:var(--marketing-action-primary-hover)] hover:text-[color:var(--marketing-action-primary-text)] sm:w-auto"
        }
      >
        <Link href={primary.href}>
          {primary.label}
          {primary.icon}
        </Link>
      </Button>

      {showSecondary ? (
        <Button
          size="lg"
          variant="ghost"
          asChild
          className={
            secondaryClassName ??
            "h-12 w-full rounded-full border-2 border-[color:var(--marketing-accent)] bg-white px-6 text-sm font-semibold text-[color:var(--marketing-accent)] shadow-[0_4px_12px_rgba(6,26,61,0.04)] transition-colors duration-200 ease-out hover:bg-[color:var(--marketing-accent)] hover:text-white dark:bg-transparent dark:hover:bg-[color:var(--marketing-accent)] dark:hover:text-[color:var(--marketing-action-primary-text)] sm:w-auto"
          }
        >
          <Link href={secondary.href} target={secondary.target}>
            {secondary.label}
            {secondary.icon}
          </Link>
        </Button>
      ) : null}
    </div>
  )
}
