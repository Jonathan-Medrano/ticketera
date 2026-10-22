import Link from "next/link"
import { BarChart3, Tag, Users } from "lucide-react"
import { formatInt } from "@/lib/format"
import { marketingSecciones } from "@/lib/marketing-secciones"

export interface MarketingKpis {
  codigosActivos: number
  segmentos: number
  trackingConfigurado: number
}

interface Props {
  kpis: MarketingKpis
}

export default function MarketingOverview({ kpis }: Props) {
  return (
    <div className="flex flex-col gap-6 pb-6">
      {/* KPI strip */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {/* Códigos activos */}
        <div className="rounded-card border border-border bg-card p-4 shadow-sm">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-xs text-muted-foreground">Códigos activos</p>
              <p className="mt-1 text-2xl font-bold text-foreground tabular-nums">
                {formatInt(kpis.codigosActivos)}
              </p>
              {kpis.codigosActivos === 0 && (
                <p className="mt-1 text-xs text-muted-foreground">Creá un código de descuento o promoción.</p>
              )}
            </div>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Tag className="h-4 w-4" />
            </div>
          </div>
        </div>

        {/* Segmentos */}
        <div className="rounded-card border border-border bg-card p-4 shadow-sm">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-xs text-muted-foreground">Segmentos</p>
              <p className="mt-1 text-2xl font-bold text-foreground tabular-nums">
                {formatInt(kpis.segmentos)}
              </p>
              {kpis.segmentos === 0 && (
                <p className="mt-1 text-xs text-muted-foreground">Segmentá tu audiencia para campañas más efectivas.</p>
              )}
            </div>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Users className="h-4 w-4" />
            </div>
          </div>
        </div>

        {/* Tracking */}
        <div className="rounded-card border border-border bg-card p-4 shadow-sm">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-xs text-muted-foreground">Tracking</p>
              <p className="mt-1 text-2xl font-bold text-foreground tabular-nums">
                {formatInt(kpis.trackingConfigurado)}/3
              </p>
              {kpis.trackingConfigurado === 0 && (
                <p className="mt-1 text-xs text-muted-foreground">Conectá GA4, Meta Pixel o GTM para medir conversiones.</p>
              )}
            </div>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <BarChart3 className="h-4 w-4" />
            </div>
          </div>
        </div>
      </div>

      {/* Nav cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {marketingSecciones.map(({ href, label, icon: Icon, descripcion }) => (
          <Link
            key={href}
            href={href}
            className="group flex flex-col gap-3 rounded-xl border border-border bg-card p-5 transition-all hover:border-primary/30 hover:bg-accent"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary transition-colors group-hover:border-primary/30 group-hover:bg-primary/15">
              <Icon className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">{label}</p>
              <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">{descripcion}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
