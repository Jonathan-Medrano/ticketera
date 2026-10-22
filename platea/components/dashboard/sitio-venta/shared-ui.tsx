"use client"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export function SectionCard({
  icon: Icon,
  title,
  subtitle,
  children,
  fullWidth,
}: {
  icon: React.ElementType
  title: string
  subtitle: string
  children: React.ReactNode
  fullWidth?: boolean
}) {
  return (
    <div className={`min-w-0 overflow-hidden bg-card rounded-2xl border border-border/60 p-5 ${fullWidth ? "@lg:col-span-2" : ""}`}>
      <div className="flex items-start gap-2.5 mb-5">
        <Icon className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
        <div>
          <p className="text-[15px] font-semibold tracking-tight text-foreground">{title}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
        </div>
      </div>
      {children}
    </div>
  )
}

export function SubSection({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="pt-4 border-t border-border/40 space-y-3">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/60">{title}</p>
      {children}
    </div>
  )
}

const HEX_RE = /^#[0-9a-f]{3,8}$/i

export function ColorInput({ label, value, onChange, compact }: { label: string; value: string; onChange: (v: string) => void; compact?: boolean }) {
  const isInvalid = value.length > 0 && !HEX_RE.test(value)
  return (
    <div className="space-y-1.5">
      <Label className={`font-medium text-foreground/70 ${compact ? "text-[12px]" : "text-[13px]"}`}>{label}</Label>
      <div className="flex gap-2 items-center">
        <input type="color" value={HEX_RE.test(value) ? value : "#000000"} onChange={(e) => onChange(e.target.value)} className="h-9 w-10 shrink-0 rounded-lg border border-border cursor-pointer bg-card p-1" />
        <Input
          className={`font-mono tabular-nums min-w-0 ${compact ? "h-9 text-[13px]" : "h-10"} ${isInvalid ? "border-destructive focus-visible:ring-destructive/30" : ""}`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#000000"
          maxLength={9}
          aria-invalid={isInvalid}
        />
      </div>
      {isInvalid && <p className="text-[11px] text-destructive">Formato inválido. Usá #RGB o #RRGGBB.</p>}
    </div>
  )
}
