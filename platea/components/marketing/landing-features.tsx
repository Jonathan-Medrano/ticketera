import { BarChart3, Store, Users } from "lucide-react"

import { MockupBarra, MockupScanner, MockupSitio } from "@/components/marketing/feature-mockups"
import { RevealOnScroll, StaggerGroup, StaggerItem } from "@/components/marketing/reveal-on-scroll"

type Hero = {
  category: string
  headline: React.ReactNode
  microcopy: string
  bullets: string[]
  mockup: React.ReactNode
}

const heroes: Hero[] = [
  {
    category: "Vendé",
    headline: (
      <>
        Tu sitio público, sin que <span className="text-[color:var(--marketing-accent)]">parezca de otro</span>.
      </>
    ),
    microcopy:
      "Subdominio propio, tu branding, tus eventos. Nada de redirects raros ni links de plataformas con la marca puesta encima de la tuya.",
    bullets: [
      "tu-marca.ticketera.com con tu logo, paleta y galería",
      "Tandas con stock real y bloqueo durante el checkout",
      "Mercado Pago integrado, la plata cae directo a tu cuenta",
    ],
    mockup: <MockupSitio />,
  },
  {
    category: "Controlá",
    headline: (
      <>
        Equipo en la puerta, <span className="text-[color:var(--marketing-accent)]">sin filas</span> ni planillas.
      </>
    ),
    microcopy:
      "Cualquier celular del equipo es un scanner. Cada entrada es única, cada acceso queda registrado, y el cupo en vivo lo ve todo el mundo al mismo tiempo.",
    bullets: [
      "Web scanner que abre en cualquier teléfono moderno",
      "Detecta duplicados al instante, sin que pase nadie de más",
      "Modo manual por código cuando la cámara no abre",
    ],
    mockup: <MockupScanner />,
  },
  {
    category: "Operá",
    headline: (
      <>
        Tu barra cobra con QR, <span className="text-[color:var(--marketing-accent)]">sin caja ni pulseras</span>.
      </>
    ),
    microcopy:
      "Los consumibles se venden desde tu mismo sitio, con su propio QR por barra (aparte del de la entrada). El comprador lo muestra, tu equipo lo escanea y entrega el pedido. Stock en tiempo real.",
    bullets: [
      "Stock por barra y por producto, en tiempo real",
      "Múltiples barras operando en paralelo sin pisarse",
      "Cierre de caja al instante con detalle por sector",
    ],
    mockup: <MockupBarra />,
  },
]

const utilities = [
  {
    icon: BarChart3,
    title: "Dashboard analítica",
    desc: "Vista única de ingresos, velocidad de venta y comparativa entre eventos. Exportable a Excel y CSV.",
  },
  {
    icon: Users,
    title: "Equipo + roles",
    desc: "Puerta, vendedor, barra, admin. Cada uno ve solo lo que necesita para hacer su trabajo.",
  },
  {
    icon: Store,
    title: "Revendedores",
    desc: "Portal propio con comisión configurable y liquidaciones para exportar al cierre.",
  },
] as const

function HeroBlock({ hero, reverse }: { hero: Hero; reverse: boolean }) {
  const textDirection = reverse ? "right" : "left"
  const mockupDirection = reverse ? "left" : "right"

  return (
    <article className="grid items-center gap-10 md:grid-cols-[1.05fr_0.95fr] md:gap-12 lg:gap-16 xl:gap-20">
      <RevealOnScroll direction={textDirection} className={reverse ? "md:order-2" : ""}>
        <p className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.32em] text-[color:var(--marketing-muted)]">
          <span aria-hidden="true" className="h-px w-8 bg-[color:var(--marketing-accent)]" />
          {hero.category}
        </p>
        <h3 className="marketing-title mt-5 text-balance text-[1.85rem] font-semibold leading-[1.12] tracking-tight text-[color:var(--marketing-ink-strong)] sm:text-[2.2rem] lg:text-[2.4rem]">
          {hero.headline}
        </h3>
        <p className="marketing-card-body mt-5 max-w-xl text-pretty text-[color:var(--marketing-ink)]/85">
          {hero.microcopy}
        </p>

        <StaggerGroup as="ul" className="mt-7 space-y-3" staggerDelay={0.08} initialDelay={0.25}>
          {hero.bullets.map((b) => (
            <StaggerItem key={b} as="li" className="flex items-start gap-3.5 text-sm text-[color:var(--marketing-ink)]/90">
              <span aria-hidden="true" className="mt-[0.6rem] h-px w-4 shrink-0 bg-[color:var(--marketing-accent)]" />
              <span>{b}</span>
            </StaggerItem>
          ))}
        </StaggerGroup>
      </RevealOnScroll>

      <RevealOnScroll direction={mockupDirection} delay={0.1} className={reverse ? "md:order-1" : ""}>
        <div className="mx-auto max-w-md transition-transform duration-500 hover:-translate-y-2 lg:max-w-none">{hero.mockup}</div>
      </RevealOnScroll>
    </article>
  )
}

export default function LandingFeatures() {
  return (
    <section id="funcionalidades" className="relative scroll-mt-24 px-6 py-20 lg:px-10 lg:py-28">
      <div className="mx-auto w-full max-w-[1600px]">
        <RevealOnScroll className="max-w-3xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-[color:var(--marketing-accent)]">
            Tres momentos, una herramienta
          </p>
          <h2 className="marketing-title marketing-section-title mt-4 text-balance text-[color:var(--marketing-ink-strong)]">
            Cómo se ve Ticketera cuando lo estás usando.
          </h2>
          <p className="marketing-section-lead mt-5 text-pretty text-[color:var(--marketing-ink)]/85">
            No es una grilla de features. Es lo que pasa cuando arrancás a vender, cuando abrís la puerta y cuando se prende la barra.
          </p>
        </RevealOnScroll>

        <div className="mt-20 space-y-24 lg:space-y-32">
          {heroes.map((hero, i) => (
            <HeroBlock key={hero.category} hero={hero} reverse={i % 2 === 1} />
          ))}
        </div>

        <div className="mt-24 lg:mt-32">
          <RevealOnScroll>
            <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-[color:var(--marketing-muted)]">
              Y todo lo demás que un evento necesita
            </p>
          </RevealOnScroll>
          <StaggerGroup
            className="mt-6 grid gap-px overflow-hidden rounded-card border border-[color:var(--marketing-border)] bg-[color:var(--marketing-border)] sm:grid-cols-3"
            staggerDelay={0.1}
            initialDelay={0.1}
          >
            {utilities.map(({ icon: Icon, title, desc }) => (
              <StaggerItem
                key={title}
                as="article"
                className="group relative cursor-default overflow-hidden bg-[color:var(--marketing-bg)] p-6 transition-all duration-500 hover:bg-[color:var(--marketing-surface)]"
              >
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full bg-[color:var(--marketing-accent)]/8 opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-100"
                />
                <span className="relative inline-grid h-9 w-9 place-items-center rounded-lg bg-[color:var(--marketing-accent-soft)] text-[color:var(--marketing-accent)] transition-transform duration-500 group-hover:scale-110">
                  <Icon className="h-4 w-4" />
                </span>
                <h4 className="relative mt-4 text-base font-semibold text-[color:var(--marketing-ink-strong)] dark:text-white">{title}</h4>
                <p className="relative mt-2 text-sm text-[color:var(--marketing-ink)]/82">{desc}</p>
              </StaggerItem>
            ))}
          </StaggerGroup>
        </div>
      </div>
    </section>
  )
}
