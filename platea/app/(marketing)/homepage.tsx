import Link from "next/link"
import { ArrowRight } from "lucide-react"

import Navbar from "@/components/navbar"
import MarketingFooter from "@/components/marketing/marketing-footer"
import LandingHero from "@/components/marketing/landing-hero"
import LandingFeatures from "@/components/marketing/landing-features"
import LandingMarketingModule from "@/components/marketing/landing-marketing-module"
import LandingReconciliation from "@/components/marketing/landing-reconciliation"
import AnnouncementBar from "@/components/marketing/announcement-bar"
import VidrieraEventos from "@/components/marketing/vidriera-eventos"
import VidrieraJsonLd from "@/components/marketing/vidriera-json-ld"
import { StaggerGroup, StaggerItem } from "@/components/marketing/reveal-on-scroll"
import { fetchPublicBackendFromServer } from "@/lib/server-backend"
import type { VidrieraEventoPublico } from "@/lib/vidriera"

type LandingAnnouncement = {
  contentHtml: string
  ctaLabel: string | null
  ctaHref: string | null
  active: boolean
  animationMode?: "static" | "marquee_infinite" | "marquee_finite"
  animationSpeed?: "slow" | "normal" | "fast"
  backgroundColor?: string | null
}

async function loadAnnouncement(): Promise<LandingAnnouncement | null> {
  try {
    const json = await fetchPublicBackendFromServer<{ data: LandingAnnouncement | null }>(
      "/api/landing-announcement",
      { cache: "no-store" }
    )
    return json.data ?? null
  } catch {
    return null
  }
}

async function loadVidrieraEventos(): Promise<VidrieraEventoPublico[]> {
  try {
    const json = await fetchPublicBackendFromServer<{ data: { eventos: VidrieraEventoPublico[] } }>(
      "/api/vidriera/eventos?limit=8",
      { revalidate: 600, tags: ["vidriera:eventos"] }
    )
    return json.data.eventos
  } catch {
    return []
  }
}

export default async function Home() {
  const [announcement, vidrieraEventos] = await Promise.all([loadAnnouncement(), loadVidrieraEventos()])

  return (
    <div className="marketing-shell flex min-h-screen flex-col">
      {announcement?.active && announcement.contentHtml ? (
        <AnnouncementBar
          contentHtml={announcement.contentHtml}
          ctaLabel={announcement.ctaLabel}
          ctaHref={announcement.ctaHref}
          animationMode={announcement.animationMode ?? "static"}
          animationSpeed={announcement.animationSpeed ?? "normal"}
          backgroundColor={announcement.backgroundColor ?? null}
        />
      ) : null}
      <Navbar />

      <main id="main-content" tabIndex={-1} className="flex-1 focus:outline-none">
        <LandingHero />

        {vidrieraEventos.length > 0 && (
          <section className="px-6 py-20 lg:px-10 lg:py-24">
            <div className="mx-auto max-w-6xl">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-[color:var(--marketing-accent)]">
                    Descubrí eventos
                  </p>
                  <h2 className="marketing-title marketing-section-title mt-3 text-[color:var(--marketing-ink-strong)]">
                    Boliches y productoras vendiendo ahora mismo.
                  </h2>
                </div>
                <Link
                  href="/eventos"
                  className="group inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold text-[color:var(--marketing-accent)]"
                >
                  Ver todos
                  <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5" />
                </Link>
              </div>

              <div className="mt-10">
                <VidrieraEventos eventos={vidrieraEventos} />
              </div>
              <VidrieraJsonLd eventos={vidrieraEventos} />
            </div>
          </section>
        )}

        <LandingFeatures />

        <LandingMarketingModule />

        <LandingReconciliation />

        <section className="relative overflow-hidden px-6 py-24 lg:px-10 lg:py-32">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
            <div className="absolute inset-x-0 top-0 h-full bg-gradient-to-br from-[color:var(--marketing-accent)]/10 via-transparent to-[#ffae84]/12 dark:from-[color:var(--marketing-accent)]/20 dark:to-[#ffae84]/8" />
            <div className="absolute -right-32 top-0 h-[500px] w-[500px] rounded-full bg-[color:var(--marketing-accent)]/10 blur-3xl" />
          </div>

          <StaggerGroup className="relative mx-auto max-w-3xl text-center" staggerDelay={0.12} initialDelay={0.05}>
            <StaggerItem>
              <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-[color:var(--marketing-accent)]">
                Empezar
              </p>
            </StaggerItem>
            <StaggerItem>
              <h2 className="marketing-title marketing-section-title mt-4 text-balance text-[color:var(--marketing-ink-strong)]">
                Creá tu cuenta y <span className="text-[color:var(--marketing-accent)]">revisamos tu acceso</span> en el día.
              </h2>
            </StaggerItem>
            <StaggerItem>
              <p className="marketing-section-lead mt-5 text-pretty text-[color:var(--marketing-ink)]/85">
                Revisión manual rápida — te avisamos por email. Configurar tu primer evento lleva menos de diez minutos.
              </p>
            </StaggerItem>

            <StaggerItem className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                href="/login?tab=registro"
                className="group inline-flex items-center gap-1.5 rounded-full bg-[color:var(--marketing-accent)] px-7 py-3 text-sm font-semibold text-[color:var(--marketing-action-primary-text)] shadow-[0_14px_36px_rgba(0,82,204,0.28)] transition-all duration-300 hover:-translate-y-0.5 hover:bg-[color:var(--marketing-accent-strong)] hover:shadow-[0_18px_44px_rgba(0,82,204,0.42)]"
              >
                Crear mi espacio gratis
                <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5" />
              </Link>
              <Link
                href="/contacto"
                className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--marketing-border-strong)] bg-[color:var(--marketing-bg)]/70 px-7 py-3 text-sm font-semibold text-[color:var(--marketing-ink)] backdrop-blur-sm transition-all duration-300 hover:-translate-y-0.5 hover:bg-[color:var(--marketing-bg)] hover:shadow-[0_10px_28px_rgba(15,33,77,0.12)] dark:text-white"
              >
                Hablar con alguien antes
              </Link>
            </StaggerItem>

            <StaggerItem>
              <p className="mt-7 text-xs text-[color:var(--marketing-muted)]">
                Sin tarjeta hasta tu primera venta · Comisión 4% por ticket vendido · La plata va a tu propio Mercado Pago
              </p>
            </StaggerItem>
          </StaggerGroup>
        </section>
      </main>

      <MarketingFooter />
    </div>
  )
}
