"use client"

import { useState, useSyncExternalStore } from "react"
import { Moon, Sun } from "lucide-react"
import { getEffectiveTheme } from "@/components/super-admin/theme"
import { useAppTheme, useOptionalSuperAdminTheme } from "@/components/theme-provider"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

interface Props {
  collapsed?: boolean
  compact?: boolean
  className?: string
  tooltipWhenCollapsed?: boolean
  navItemLike?: boolean
}

export default function ThemeToggle({ collapsed, compact = false, className, tooltipWhenCollapsed = false, navItemLike = false }: Props) {
  const { theme, resolvedTheme, setTheme } = useAppTheme()
  const superAdminTheme = useOptionalSuperAdminTheme()
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  )
  const [spinning, setSpinning] = useState(false)

  if (!mounted || (superAdminTheme && !superAdminTheme.mounted)) return <div className="h-9 w-full" />

  const isDark = (superAdminTheme ? superAdminTheme.theme : getEffectiveTheme(theme, resolvedTheme)) === "dark"

  const handleToggle = () => {
    setSpinning(true)
    setTimeout(() => setSpinning(false), 400)

    if (superAdminTheme) {
      superAdminTheme.setTheme(isDark ? "light" : "dark")
      return
    }

    setTheme(isDark ? "light" : "dark")
  }

  const label = isDark ? "Modo claro" : "Modo oscuro"
  const Icon = isDark ? Sun : Moon
  // Non-sidebar variant keeps warm amber / cool violet for decorative contrast.
  const standaloneIconClassName = isDark ? "text-amber-400" : "text-violet-400"

  const button = (
    <button
      onClick={handleToggle}
      aria-label={isDark ? "Activar modo claro" : "Activar modo oscuro"}
      title={tooltipWhenCollapsed && collapsed ? label : undefined}
      className={cn(
        navItemLike
          // Matches renderNavLink in components/dashboard/sidebar.tsx so the toggle
          // is visually indistinguishable from the regular sidebar nav buttons.
          ? "group flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-all duration-200 text-slate-300/80 hover:bg-slate-800 hover:text-white w-full"
          : collapsed
            ? "rounded-xl flex items-center justify-center h-9 w-9 text-sm font-medium transition-all duration-200"
            : compact
              // `compact` is used by the super-admin sidebar which has a hardcoded
              // dark blue surface and ignores theme tokens — so we mirror the logout
              // button styling next to it (same hex palette).
              ? "flex h-10 w-full items-center justify-start gap-2.5 rounded-lg border border-[#203243] bg-[#0b1724] px-3 text-sm font-medium text-[#e4eef5] shadow-none transition-colors hover:border-[#2a4458] hover:bg-[#102030] hover:text-white"
              : "rounded-xl w-full flex items-center px-3 py-2.5 gap-3 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-all duration-200"
        ,
        className
      )}
    >
      {navItemLike ? (
        <div className="flex h-6.5 w-6.5 shrink-0 items-center justify-center rounded-md border transition-all border-transparent bg-transparent text-slate-500 group-hover:border-slate-700 group-hover:bg-slate-900 group-hover:text-sky-300">
          <Icon className={cn("h-4 w-4", spinning && "animate-spin-once")} />
        </div>
      ) : compact ? (
        // The button itself sets text-[#e4eef5] -> hover:text-white; the icon
        // inherits via currentColor. No custom color on the SVG keeps the
        // hover transition continuous with the rest of the button (and with
        // the logout button right below in the super-admin sidebar).
        <Icon
          className={cn(
            "mr-2 h-4 w-4 shrink-0",
            spinning && "animate-spin-once"
          )}
        />
      ) : (
        <Icon
          className={cn(
            "h-4 w-4 shrink-0 transition-transform duration-400",
            standaloneIconClassName,
            spinning && "animate-spin-once"
          )}
        />
      )}

      {!collapsed && (
        <span className="truncate leading-none">{label}</span>
      )}
    </button>
  )

  if (!(tooltipWhenCollapsed && collapsed)) return button

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
