import { MockupCierre } from "@/components/marketing/feature-mockups"
import { RevealOnScroll, StaggerGroup, StaggerItem } from "@/components/marketing/reveal-on-scroll"

const items = [
  "Liquidación lista para exportar, sin armar planillas a mano",
  "Reembolsos por Mercado Pago iniciados desde el mismo panel",
  "Comisión Ticketera y Mercado Pago detalladas por línea",
  "Exportá CSV o Excel para tu contador en dos clicks",
] as const

export default function LandingReconciliation() {
  return (
    <section id="control" className="relative scroll-mt-24 px-6 py-20 lg:px-10 lg:py-28">
      <div className="mx-auto w-full max-w-[1600px]">
        <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16 xl:gap-20">
          <RevealOnScroll direction="right" className="lg:order-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-[color:var(--marketing-accent)]">
              Después del último QR escaneado
            </p>
            <h2 className="marketing-title marketing-section-title mt-4 text-balance text-[color:var(--marketing-ink-strong)]">
              El día siguiente no debería <span className="text-[color:var(--marketing-accent)]">empezar en Excel</span>.
            </h2>
            <p className="marketing-section-lead mt-5 text-pretty text-[color:var(--marketing-ink)]/85">
              Tu evento cerró, las cuentas no. Para que el lunes a las 9 ya esté todo listo: liquidaciones, refunds y exports en el mismo panel donde vendiste.
            </p>

            <StaggerGroup as="ul" className="mt-8 space-y-3" staggerDelay={0.08} initialDelay={0.25}>
              {items.map((text) => (
                <StaggerItem key={text} as="li" className="flex items-start gap-3.5 text-[color:var(--marketing-ink)]/90">
                  <span aria-hidden="true" className="mt-[0.55rem] h-px w-4 shrink-0 bg-[color:var(--marketing-accent)]" />
                  <span className="text-sm leading-relaxed">{text}</span>
                </StaggerItem>
              ))}
            </StaggerGroup>
          </RevealOnScroll>

          <RevealOnScroll direction="left" delay={0.1} className="lg:order-1">
            <div className="mx-auto max-w-md lg:max-w-none">
              <MockupCierre />
            </div>
          </RevealOnScroll>
        </div>
      </div>
    </section>
  )
}
