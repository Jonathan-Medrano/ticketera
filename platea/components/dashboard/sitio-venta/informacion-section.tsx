"use client"

import Link from "next/link"
import { Info } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { getTenantInfoPageLabel, getTenantInfoPageSlug } from "@/lib/tenant-info"
import { SectionCard } from "./shared-ui"
import type { SitioVentaForm } from "./types"

export function InformacionSection({ form, onNavigateAway }: { form: SitioVentaForm; onNavigateAway?: (href: string) => void }) {
  return (
    <SectionCard icon={Info} title="Información" subtitle="Definí qué páginas legales e informativas mostrar en el menú del sitio" fullWidth>
      <div className="grid gap-4 @lg:grid-cols-2">
        {form.info_pages.map((page) => {
          const href = `/sitio-venta/editor/informacion/${getTenantInfoPageSlug(page.key)}`
          const hasContent = page.content.trim().length > 0
          const badge = hasContent && page.enabled
            ? { label: "Activa", variant: "default" as const }
            : hasContent && !page.enabled
            ? { label: "Oculta", variant: "secondary" as const }
            : { label: "Sin contenido", variant: "outline" as const }
          return (
            <div key={page.key} className="rounded-xl border border-border/60 bg-muted/30 p-4 @sm:p-5 space-y-4">
              <div className="flex flex-col gap-3 @sm:flex-row @sm:items-start @sm:justify-between">
                <div className="space-y-2 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[15px] font-semibold tracking-tight text-foreground">{getTenantInfoPageLabel(page.key)}</p>
                    <Badge variant={badge.variant} className="rounded-md">
                      {badge.label}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground max-w-2xl">
                    Editala en una página dedicada con activación, vista previa y contenido completo.
                  </p>
                </div>

                {onNavigateAway ? (
                  <Button type="button" variant="outline" className="w-full @sm:w-auto" onClick={() => onNavigateAway(href)}>
                    Editar
                  </Button>
                ) : (
                  <Button asChild type="button" variant="outline" className="w-full @sm:w-auto">
                    <Link href={href}>Editar</Link>
                  </Button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </SectionCard>
  )
}
