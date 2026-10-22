import type { Metadata } from "next"
import { ArrowRight, FileText, LifeBuoy, Mail, Ticket } from "lucide-react"

import StaticMarketingPageShell from "@/components/marketing/static-marketing-page-shell"
import StaticPageSection from "@/components/marketing/static-page-section"

export const metadata: Metadata = {
  title: "Contacto · Ticketera",
}

type Route = {
  icon: typeof Mail
  audience: string
  title: string
  body: string
  href: string
  action: string
  external?: boolean
}

const routes: Route[] = [
  {
    icon: Mail,
    audience: "Querés evaluar Ticketera",
    title: "Hablemos antes de improvisar",
    body: "Contanos qué tipo de evento manejás, qué herramientas usás hoy y qué te gustaría que sea distinto. Respondemos como personas, no como bot.",
    href: "mailto:hola@ticketera.com?subject=Quiero%20probar%20Ticketera",
    action: "hola@ticketera.com",
    external: true,
  },
  {
    icon: LifeBuoy,
    title: "Ya uso Ticketera y necesito ayuda",
    audience: "Sos empresa y tenés un problema",
    body: "El soporte está pensado para resolverte rápido: contás qué pasó, dónde, y el equipo se mete sin vueltas. Mejor por ahí que por contacto.",
    href: "/soporte",
    action: "Ir a soporte",
  },
  {
    icon: Ticket,
    title: "Compré una entrada y algo salió mal",
    audience: "Sos comprador con un problema",
    body: "Tu primera vía es la empresa organizadora del evento. Si no responden o no destraban, podemos mediar — la ruta está en soporte.",
    href: "/soporte",
    action: "Ver cómo escribir",
  },
  {
    icon: FileText,
    title: "Es algo legal, privacidad o datos",
    audience: "Una consulta jurídica",
    body: "Están en Términos y Privacidad. Si necesitás algo puntual que no está, escribinos al mail y derivamos.",
    href: "/terminos",
    action: "Leer términos",
  },
]

export default function ContactoPage() {
  return (
    <StaticMarketingPageShell
      eyebrow="Contacto"
      title="Hablemos por mail, pero antes mirá si tu caso ya tiene casa."
      description="Hay un solo email para escribir y, abajo, una guía corta para que vayas directo al lugar correcto sin perder mañanas."
    >
      <StaticPageSection
        title="Por dónde según tu caso"
        description="Cuatro situaciones, cuatro caminos. La idea es no perder ida y vuelta innecesario."
      >
        <div className="grid gap-4 md:grid-cols-2">
          {routes.map(({ icon: Icon, audience, title, body, href, action, external }) => (
            <article
              key={title}
              className="marketing-panel group flex flex-col rounded-card px-6 py-6 transition-all duration-300 hover:-translate-y-0.5 hover:border-[color:var(--marketing-border-strong)]"
            >
              <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[color:var(--marketing-muted)]">
                {audience}
              </p>
              <div className="mt-3 flex items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[color:var(--marketing-accent-soft)] text-[color:var(--marketing-accent)]">
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="text-base font-semibold text-[color:var(--marketing-ink-strong)] dark:text-white">{title}</h2>
                </div>
              </div>
              <p className="marketing-card-body mt-3 flex-1 text-[color:var(--marketing-ink)]/82">{body}</p>
              <a
                href={href}
                {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
                className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-[color:var(--marketing-accent)] transition-all duration-150 group-hover:gap-2.5"
              >
                {action}
                <ArrowRight className="h-3.5 w-3.5" />
              </a>
            </article>
          ))}
        </div>
      </StaticPageSection>

      <StaticPageSection
        title="Antes de mandarnos el mail"
        description="Cuanto más claro sea el contexto, más rápido podemos darte una respuesta útil (en lugar de cuatro preguntas para entender)."
      >
        <ul className="space-y-2.5 text-[color:var(--marketing-ink)]/88">
          <li className="flex gap-2.5">
            <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-[color:var(--marketing-accent)]" />
            <span>Si sos empresa, contanos en qué parte del flujo te trabaste (venta, check-in, cierre).</span>
          </li>
          <li className="flex gap-2.5">
            <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-[color:var(--marketing-accent)]" />
            <span>Si sos comprador, indicá el evento, el organizador y qué pasó con tu compra o entrada.</span>
          </li>
          <li className="flex gap-2.5">
            <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-[color:var(--marketing-accent)]" />
            <span>Si es comercial, mencioná qué tipo de operación manejás y qué te gustaría ordenar.</span>
          </li>
          <li className="flex gap-2.5">
            <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-[color:var(--marketing-accent)]" />
            <span>Capturas de pantalla, links a tu evento o IDs nos ahorran una vuelta entera.</span>
          </li>
        </ul>
      </StaticPageSection>

      <StaticPageSection title="Lo que no hacemos" description="Para evitar expectativas raras, también es honesto decirlo.">
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { title: "Chat en vivo 24/7", body: "Respondemos por mail en horario hábil de Argentina. Si algo es urgente, lo marcás en el asunto." },
            { title: "Soporte telefónico", body: "No tenemos call center. El canal es escrito, que también es trazable para ambos." },
            { title: "Mediación instantánea", body: "Si sos comprador, primero hablás con la empresa. Si no aparecen, ahí nos metemos." },
          ].map((it) => (
            <div key={it.title} className="rounded-card border border-[color:var(--marketing-border)] bg-[color:var(--marketing-bg)] p-5">
              <p className="text-sm font-semibold text-[color:var(--marketing-ink-strong)] dark:text-white">{it.title}</p>
              <p className="mt-2 text-[13px] leading-relaxed text-[color:var(--marketing-ink)]/82">{it.body}</p>
            </div>
          ))}
        </div>
      </StaticPageSection>
    </StaticMarketingPageShell>
  )
}
