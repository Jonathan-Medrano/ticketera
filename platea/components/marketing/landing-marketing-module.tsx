import Link from "next/link"
import { Filter, LineChart, Mail, RotateCcw } from "lucide-react"

import { MockupMarketing } from "@/components/marketing/feature-mockups"
import { RevealOnScroll, StaggerGroup, StaggerItem } from "@/components/marketing/reveal-on-scroll"

const levers = [
  {
    icon: Mail,
    title: "Email a tu base",
    desc: "Mandá campañas a tus compradores, segmentadas por tipo, con baja automática incluida.",
  },
  {
    icon: RotateCcw,
    title: "Recuperá carritos",
    desc: "Quien deja el checkout a medias recibe un recordatorio automático por email. Sin que muevas un dedo.",
  },
  {
    icon: Filter,
    title: "Segmentos automáticos",
    desc: "VIPs, recurrentes, nuevos, inactivos. Tu audiencia se agrupa sola, sin armar listas a mano.",
  },
  {
    icon: LineChart,
    title: "Analítica con Google",
    desc: "Conectá Google Analytics 4 y Tag Manager desde el panel y arrancá a medir, sin tocar código.",
  },
] as const

export default function LandingMarketingModule() {
  return (
    <section
      className="relative px-6 py-20 lg:px-10 lg:py-28"
      style={{ background: "var(--marketing-surface-strong)" }}
    >
      <div
        className="absolute inset-x-0 top-0 h-px opacity-50"
        style={{
          background:
            "linear-gradient(90deg, transparent, var(--marketing-accent), transparent)",
        }}
        aria-hidden="true"
      />

      <div className="relative mx-auto w-full max-w-[1600px]">
        <div className="grid items-center gap-12 lg:grid-cols-[0.95fr_1.05fr] lg:gap-16 xl:gap-20">
          <RevealOnScroll direction="left">
            <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-[color:var(--marketing-accent)]">
              Después del primer evento
            </p>
            <h2 className="marketing-title marketing-section-title mt-4 text-balance text-[color:var(--marketing-ink-strong)]">
              Crecé con los compradores que <span className="text-[color:var(--marketing-accent)]">ya tenés</span>.
            </h2>
            <p className="marketing-section-lead mt-5 text-pretty text-[color:var(--marketing-ink)]/85">
              Saber quién vino, cuánto gastó y darle un motivo concreto para volver. Las palancas básicas para no depender solo del próximo evento estrella.
            </p>

            <StaggerGroup as="ul" className="mt-8 space-y-4" staggerDelay={0.09} initialDelay={0.25}>
              {levers.map(({ icon: Icon, title, desc }) => (
                <StaggerItem key={title} as="li" className="flex items-start gap-3.5">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[color:var(--marketing-accent-soft)] text-[color:var(--marketing-accent)] transition-transform duration-300 hover:scale-110">
                    <Icon className="h-4 w-4" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-[color:var(--marketing-ink-strong)] dark:text-white">{title}</p>
                    <p className="mt-0.5 text-[13px] leading-relaxed text-[color:var(--marketing-ink)]/82">{desc}</p>
                  </div>
                </StaggerItem>
              ))}
            </StaggerGroup>

            <div className="mt-9 flex flex-wrap items-center gap-4">
              <Link
                href="/login?tab=registro"
                className="inline-flex items-center gap-1.5 rounded-full bg-[color:var(--marketing-accent)] px-6 py-2.5 text-sm font-semibold text-white transition-all duration-300 hover:-translate-y-0.5 hover:bg-[color:var(--marketing-accent-strong)] hover:shadow-[0_10px_24px_rgba(0,82,204,0.32)]"
              >
                Probar el panel
              </Link>
              <Link
                href="/contacto"
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-[color:var(--marketing-accent)] underline-offset-4 hover:underline"
              >
                Hablar con el equipo →
              </Link>
            </div>
          </RevealOnScroll>

          <RevealOnScroll direction="right" delay={0.1}>
            <div className="mx-auto max-w-md lg:max-w-none">
              <MockupMarketing />
            </div>
          </RevealOnScroll>
        </div>
      </div>
    </section>
  )
}
