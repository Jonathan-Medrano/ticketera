import { cn } from "@/lib/utils"
import type { ReactNode } from "react"

export type SAKpiTone = "neutral" | "success" | "warning" | "danger" | "info" | "primary"

const toneClasses: Record<SAKpiTone, string> = {
  neutral: "border-border bg-card",
  success: "border-success/30 bg-success/8",
  warning: "border-warning/30 bg-warning/8",
  danger: "border-destructive/30 bg-destructive/8",
  info: "border-primary/30 bg-primary/8",
  primary: "border-primary/30 bg-primary/8",
}

export const saKpiLabelCn = "text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground"
export const saKpiValueCn = "mt-1.5 text-[26px] font-semibold leading-none tabular-nums text-foreground"

export function SAKpiCard({
  tone = "neutral",
  onClick,
  active,
  className,
  children,
}: {
  tone?: SAKpiTone
  onClick?: () => void
  active?: boolean
  className?: string
  children: ReactNode
}) {
  const base = cn(
    "rounded-2xl border px-4 py-4 shadow-[var(--superadmin-soft-shadow)] transition-colors",
    toneClasses[tone],
    onClick && "cursor-pointer select-none hover:opacity-90 active:opacity-80",
    active && "ring-2 ring-inset ring-primary/30",
    className,
  )

  if (onClick) {
    return (
      <button type="button" className={base} onClick={onClick}>
        {children}
      </button>
    )
  }

  return <div className={base}>{children}</div>
}
