import type { Metadata } from "next"
import { AlertTriangle, Clock, Mail, MessageCircle } from "lucide-react"

import TenantSoportePage from "@/app/t/[tenant]/soporte/page"
import FaqList from "@/components/marketing/faq-list"
import StaticMarketingPageShell from "@/components/marketing/static-marketing-page-shell"
import StaticPageSection from "@/components/marketing/static-page-section"
import { resolveTenantFromHost } from "@/lib/tenant-host"

export const metadata: Metadata = {
  title: "Soporte · Ticketera",
}

const supportCards = [
  {
    icon: Mail,
    title: "Un mail, un email",
    desc: "Para empresas, problemas técnicos o solicitudes con datos personales. Sin formulario raro: escribís y respondemos.",
    href: "mailto:soporte@ticketera.com",
    action: "soporte@ticketera.com",
  },
  {
    icon: Clock,
    title: "Respondemos en 48hs hábiles",
    desc: "Si el problema afecta un evento en curso, marcá la urgencia en el asunto. Cuando hay show esa misma noche, lo agarramos primero.",
  },
  {
    icon: MessageCircle,
    title: "Sos comprador con un problema",
    desc: "Tu primera vía es la empresa organizadora del evento. Ticketera puede mediar si no recibís respuesta en un plazo razonable.",
  },
] as const

const faqItems = [
  {
    question: "¿Cómo cancelo mi cuenta de empresa?",
    answer:
      "Mandanos un mail desde la dirección registrada pidiendo la baja. La procesamos en hasta 5 días hábiles, y antes de cerrar te avisamos si hay algún evento abierto que conviene cerrar primero.",
  },
  {
    question: "¿Qué pasa si cancelo un evento?",
    answer:
      "La empresa organizadora avisa a los compradores y gestiona los reembolsos. Desde el panel exportás el listado completo y desde Ticketera podemos pasarte la información que necesites para acompañar.",
  },
  {
    question: "¿Cómo cambio mi subdominio?",
    answer:
      "Desde Configuración en tu dashboard. Importante: los links anteriores con el subdominio viejo dejan de funcionar el mismo momento del cambio, así que coordiná si ya hay algo publicado.",
  },
  {
    question: "¿Puedo tener más de una empresa en la misma cuenta?",
    answer:
      "Hoy no. Cada cuenta es una empresa. Si manejás varias, te recomendamos una cuenta por cada una — y si te queda raro, contanos el caso y vemos.",
  },
  {
    question: "¿Cómo solicito la eliminación de mis datos?",
    answer:
      "Escribinos a soporte@ticketera.com indicando tu solicitud. Respondemos bajo el marco de la Ley 25.326 de Protección de Datos Personales y te confirmamos cuando está procesado.",
  },
] as const

export default async function SoportePage() {
  const tenant = await resolveTenantFromHost()

  if (tenant) {
    return <TenantSoportePage params={Promise.resolve({ tenant })} />
  }

  return (
    <StaticMarketingPageShell
      eyebrow="Soporte"
      title="Soporte claro, sin dar vueltas."
      description="Esta página te orienta según el tipo de problema. La idea es que llegues al canal correcto rápido y sin pasar por tres formularios."
      toc={[
        { id: "canales-de-soporte", label: "Canales de soporte" },
        { id: "antes-de-escribir", label: "Antes de escribir" },
        { id: "evento-en-curso", label: "Si hay un evento en curso" },
        { id: "preguntas-frecuentes", label: "Preguntas frecuentes" },
      ]}
    >
      <StaticPageSection
        id="canales-de-soporte"
        title="Canales de soporte"
        description="Tres formas de llegar a alguien que pueda destrabarte."
      >
        <div className="grid gap-4 lg:grid-cols-3">
          {supportCards.map((card) => (
            <article
              key={card.title}
              className="marketing-panel group flex flex-col rounded-card px-6 py-6 transition-all duration-300 hover:-translate-y-0.5 hover:border-[color:var(--marketing-border-strong)]"
            >
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-[color:var(--marketing-accent-soft)] text-[color:var(--marketing-accent)]">
                <card.icon className="h-4 w-4" />
              </span>
              <h2 className="mt-4 text-base font-semibold text-[color:var(--marketing-ink-strong)] dark:text-white">{card.title}</h2>
              <p className="marketing-card-body mt-2.5 flex-1 text-[color:var(--marketing-ink)]/82">{card.desc}</p>
              {"href" in card && "action" in card ? (
                <a
                  href={card.href}
                  className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-[color:var(--marketing-accent)]"
                >
                  {card.action}
                  <span aria-hidden="true" className="text-xs">→</span>
                </a>
              ) : null}
            </article>
          ))}
        </div>
      </StaticPageSection>

      <StaticPageSection
        id="antes-de-escribir"
        title="Antes de escribir"
        description="Si sos comprador, primero hablá con la empresa organizadora. Si no aparecen o necesita mediación, ahí escribinos con el contexto."
      >
        <ul className="space-y-2.5 text-[color:var(--marketing-ink)]/88">
          <li className="flex gap-2.5">
            <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-[color:var(--marketing-accent)]" />
            <span>Indicá el evento, la fecha y el organizador si ya compraste.</span>
          </li>
          <li className="flex gap-2.5">
            <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-[color:var(--marketing-accent)]" />
            <span>Si sos empresa, contanos en qué parte del flujo apareció el problema.</span>
          </li>
          <li className="flex gap-2.5">
            <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-[color:var(--marketing-accent)]" />
            <span>Capturas, links, IDs — todo lo que sea concreto nos ayuda a ir al grano.</span>
          </li>
        </ul>
      </StaticPageSection>

      <StaticPageSection
        id="evento-en-curso"
        title="Si hay un evento en curso"
        description="Cuando el show está pasando, las urgencias son otras. Acá la ruta corta."
      >
        <div className="rounded-card border border-[color:var(--marketing-accent)]/20 bg-[color:var(--marketing-accent)]/5 p-5">
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[color:var(--marketing-accent)]/12 text-[color:var(--marketing-accent)]">
              <AlertTriangle className="h-4 w-4" />
            </span>
            <div>
              <p className="text-sm font-semibold text-[color:var(--marketing-ink-strong)] dark:text-white">
                Marcá la urgencia en el asunto
              </p>
              <p className="mt-1 text-[13px] leading-relaxed text-[color:var(--marketing-ink)]/85">
                Algo como <span className="font-mono text-[12px]">URGENTE — Festival Cumbre — 22:30</span> nos
                permite priorizarlo arriba del resto. Si la puerta no escanea o el checkout cayó, lo agarramos primero.
              </p>
            </div>
          </div>
        </div>
      </StaticPageSection>

      <StaticPageSection id="preguntas-frecuentes" title="Preguntas frecuentes">
        <FaqList items={faqItems} />
      </StaticPageSection>
    </StaticMarketingPageShell>
  )
}
