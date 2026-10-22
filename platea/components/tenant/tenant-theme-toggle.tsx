"use client"

import { Moon, Sun } from "lucide-react"
import { IconAction } from "@/components/ui/icon-action"
import { useTenant, useTenantTheme } from "./tenant-provider"

export default function TenantThemeToggle({
  className = "h-9 w-9 rounded-full flex items-center justify-center border backdrop-blur transition-colors cursor-pointer",
  iconClassName = "h-4 w-4",
  foregroundColor,
  surfaceColor,
  borderColor,
}: {
  className?: string
  iconClassName?: string
  foregroundColor?: string
  surfaceColor?: string
  borderColor?: string
}) {
  const tenant = useTenant()
  const { mode, setMode } = useTenantTheme()

  return (
    <IconAction
      label={mode === "dark" ? "Activar modo claro" : "Activar modo oscuro"}
      tooltip={mode === "dark" ? "Modo claro" : "Modo oscuro"}
      onClick={() => setMode(mode === "dark" ? "light" : "dark")}
      className={className}
      style={{
        background: surfaceColor ?? `${tenant.color_texto}12`,
        borderColor: borderColor ?? `${tenant.color_texto}10`,
        color: foregroundColor ?? tenant.color_texto,
      }}
    >
      {mode === "dark" ? <Sun className={iconClassName} /> : <Moon className={iconClassName} />}
    </IconAction>
  )
}
