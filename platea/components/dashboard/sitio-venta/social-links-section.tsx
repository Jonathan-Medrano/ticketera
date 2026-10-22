"use client"

import { useState } from "react"
import { Link2 } from "lucide-react"
import { Input } from "@/components/ui/input"
import { SectionCard } from "./shared-ui"
import type { SitioVentaForm } from "./types"

const PLATFORMS = [
  { key: "instagram" as const, label: "Instagram", placeholder: "https://instagram.com/tucuenta", monogram: "IG" },
  { key: "tiktok" as const, label: "TikTok", placeholder: "https://tiktok.com/@tucuenta", monogram: "TK" },
  { key: "facebook" as const, label: "Facebook", placeholder: "https://facebook.com/tupagina", monogram: "fb" },
  { key: "x" as const, label: "X", placeholder: "https://x.com/tucuenta", monogram: "X" },
  { key: "youtube" as const, label: "YouTube", placeholder: "https://youtube.com/@tucanal", monogram: "YT" },
]

export function SocialLinksSection({ form, setForm }: { form: SitioVentaForm; setForm: React.Dispatch<React.SetStateAction<SitioVentaForm>> }) {
  const [urlErrors, setUrlErrors] = useState<Partial<Record<keyof typeof form.social_links, string>>>({})

  function update(key: keyof typeof form.social_links, value: string) {
    setForm((prev) => ({ ...prev, social_links: { ...prev.social_links, [key]: value } }))
    if (urlErrors[key]) setUrlErrors((prev) => ({ ...prev, [key]: undefined }))
  }

  function handleBlur(key: keyof typeof form.social_links, value: string) {
    if (value.trim() && !value.startsWith("https://")) {
      setUrlErrors((prev) => ({ ...prev, [key]: "El enlace debe empezar con https://" }))
    }
  }

  return (
    <SectionCard icon={Link2} title="Redes sociales" subtitle="Los enlaces que configures van a aparecer en el pie de tu sitio de venta">
      <div className="space-y-1.5">
        {PLATFORMS.map(({ key, label, placeholder, monogram }) => {
          const error = urlErrors[key]
          return (
            <div key={key} className="space-y-0.5">
              <div className={`flex items-center gap-2.5 rounded-xl border bg-muted/10 px-3 py-2 transition-colors hover:bg-muted/20 ${error ? "border-destructive/50" : "border-border/60"}`}>
                <span className="h-6 w-6 shrink-0 flex items-center justify-center rounded-md bg-muted text-[9px] font-black text-muted-foreground tracking-tight">{monogram}</span>
                <span className="text-[13px] font-medium text-foreground/80 min-w-[80px] shrink-0">{label}</span>
                <Input
                  id={`social-${key}`}
                  type="url"
                  className="h-8 flex-1 border-0 bg-transparent p-0 text-sm focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:text-muted-foreground/50"
                  value={form.social_links[key] ?? ""}
                  onChange={(e) => update(key, e.target.value)}
                  onBlur={(e) => handleBlur(key, e.target.value)}
                  placeholder={placeholder}
                  aria-invalid={!!error}
                />
                <div className={`h-2 w-2 rounded-full shrink-0 transition-colors ${form.social_links[key]?.trim() && !error ? "bg-emerald-500" : error ? "bg-destructive/60" : "bg-muted-foreground/20"}`} />
              </div>
              {error && <p className="text-[11px] text-destructive pl-3">{error}</p>}
            </div>
          )
        })}
      </div>
    </SectionCard>
  )
}
