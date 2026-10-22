import type { Metadata } from "next"
import Link from "next/link"

import StaticMarketingPageShell from "@/components/marketing/static-marketing-page-shell"
import VidrieraEventos from "@/components/marketing/vidriera-eventos"
import VidrieraJsonLd from "@/components/marketing/vidriera-json-ld"
import { fetchPublicBackendFromServer } from "@/lib/server-backend"
import type { VidrieraEventoPublico } from "@/lib/vidriera"

export const metadata: Metadata = {
  title: "Eventos · Ticketera — Descubrí boliches y productoras con entradas online",
  description:
    "Todos los eventos activos en Ticketera: boliches, productoras y fiestas en Argentina. Comprá tu entrada directo en el sitio de cada organizador.",
}

async function loadEventos(): Promise<VidrieraEventoPublico[]> {
  try {
    const json = await fetchPublicBackendFromServer<{ data: { eventos: VidrieraEventoPublico[] } }>(
      "/api/vidriera/eventos",
      { revalidate: 600, tags: ["vidriera:eventos"] }
    )
    return json.data.eventos
  } catch {
    return []
  }
}

function pillClassName(active: boolean) {
  return active
    ? "rounded-full bg-[color:var(--marketing-accent)] px-4 py-1.5 text-sm font-semibold text-[color:var(--marketing-action-primary-text)]"
    : "rounded-full border border-[color:var(--marketing-border-strong)] px-4 py-1.5 text-sm font-medium text-[color:var(--marketing-ink)] transition-colors hover:border-[color:var(--marketing-accent)] hover:text-[color:var(--marketing-accent)]"
}

export default async function EventosPage({
  searchParams,
}: {
  searchParams: Promise<{ ciudad?: string }>
}) {
  const [eventos, { ciudad: ciudadParam }] = await Promise.all([loadEventos(), searchParams])

  const ciudades = Array.from(
    new Set(
      eventos
        .map((evento) => evento.ciudad?.trim())
        .filter((ciudad): ciudad is string => Boolean(ciudad))
    )
  ).sort((a, b) => a.localeCompare(b, "es"))

  const eventosFiltrados = ciudadParam
    ? eventos.filter((evento) => evento.ciudad?.trim().toLowerCase() === ciudadParam.trim().toLowerCase())
    : eventos

  return (
    <StaticMarketingPageShell
      eyebrow="Vidriera Ticketera"
      title="Todos los eventos, un solo lugar."
      description="Comprá directo en el sitio de cada organizador — cada evento vive en el sitio propio de su boliche o productora."
    >
      <VidrieraJsonLd eventos={eventosFiltrados} />

      {ciudades.length > 0 && (
        <div className="mb-8 flex flex-wrap gap-2">
          <Link href="/eventos" className={pillClassName(!ciudadParam)}>
            Todas las ciudades
          </Link>
          {ciudades.map((ciudad) => (
            <Link
              key={ciudad}
              href={`/eventos?ciudad=${encodeURIComponent(ciudad)}`}
              className={pillClassName(ciudadParam?.trim().toLowerCase() === ciudad.toLowerCase())}
            >
              {ciudad}
            </Link>
          ))}
        </div>
      )}

      {eventosFiltrados.length > 0 ? (
        <VidrieraEventos eventos={eventosFiltrados} />
      ) : ciudadParam ? (
        <p className="text-sm text-[color:var(--marketing-ink)]/60">
          Todavía no hay eventos publicados en {ciudadParam}.{" "}
          <Link href="/eventos" className="font-semibold text-[color:var(--marketing-accent)]">
            Ver todas las ciudades
          </Link>
          .
        </p>
      ) : (
        <p className="text-sm text-[color:var(--marketing-ink)]/60">Todavía no hay eventos publicados. Volvé pronto.</p>
      )}
    </StaticMarketingPageShell>
  )
}
