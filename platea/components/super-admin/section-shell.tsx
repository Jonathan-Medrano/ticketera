import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export function SuperAdminPanel({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("rounded-2xl border border-border bg-card p-4 shadow-[var(--superadmin-soft-shadow)]", className)}>{children}</div>
}
