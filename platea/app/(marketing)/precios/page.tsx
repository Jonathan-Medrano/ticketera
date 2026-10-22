import type { Metadata } from "next"
import { ArrowRight, Check, ShieldCheck, Zap } from "lucide-react"

import StaticMarketingPageShell from "@/components/marketing/static-marketing-page-shell"
import StaticPageSection from "@/components/marketing/static-page-section"

export const metadata: Metadata = {
  title: "Precios · Ticketera — Ticketera sin costo fijo para eventos en Argentina",
  description:
    "Ticketera cobra 4% sobre entradas vendidas online y 3% sobre consumibles vendidos online. Lo que cobrás en puerta o en la barra no paga comisión. Sin abono mensual, sin setup.",
}

const features = [
  "Sitio de venta público con tu subdominio y tu marca",
  "Venta de entradas por tandas con control de stock",
  "Sistema de barra / POS — venta y canje de consumibles",
  "Check-in QR en cualquier celular del equipo",
  "Panel de revendedores con comisión configurable",
  "Dashboard de analytics: ventas, accesos, barra, ingresos",
  "Email marketing integrado — carrito abandonado y recordatorios",
  "Roles granulares de equipo (puerta, vendedor, barra, admin)",
  "Múltiples eventos y categorías de entrada",
  "Subdominio propio (tuempresa.ticketera.com)",
]

const comparisons = [
  {
    feature: "Costo fijo mensual",
    ticketera: "Sin costo fijo",
    others: "Planes desde $20 USD/mes",
    highlight: true,
  },
  {
    feature: "Comisión sobre lo que cobrás en puerta o en la barra",
    ticketera: "0% — son 100% tuyas",
    others: "Cobran sobre toda venta (online y presencial)",
    highlight: true,
  },
  {
    feature: "Cuándo recibís el dinero",
    ticketera: "Instantáneo — al Mercado Pago del organizador",
    others: "5 a 10 días hábiles de liquidación",
    highlight: true,
  },
  {
    feature: "Barra / POS incluida",
    ticketera: "Sí — 3% si el consumible se vende online, 0% si lo cobra la barra",
    others: "No (requiere otra herramienta)",
    highlight: false,
  },
  {
    feature: "Marca del organizador",
    ticketera: "White-label completo, subdominio propio",
    others: "Con logo de la plataforma visible",
    highlight: false,
  },
  {
    feature: "Revendedores",
    ticketera: "Panel propio, cupo y comisión por revendedor",
    others: "No disponible o con costo extra",
    highlight: false,
  },
]

const faqs = [
  {
    q: "¿Quién paga la comisión — yo como organizador o el comprador?",
    a: "Lo definís vos. Podés absorberla en el precio, o sumarla como costo de servicio al comprador. En la mayoría de los casos se traslada al comprador.",
  },
  {
    q: "¿Pago algo si no vendo nada?",
    a: "No. Ticketera no tiene abono mensual ni costo de setup. La comisión se cobra solo sobre lo que se vende online; si no vendés, no pagás.",
  },
  {
    q: "¿Por qué la barra tiene 3% y no 4%?",
    a: "Porque el ticket promedio de un consumible es mucho más bajo que el de una entrada. Cobrarte lo mismo en un trago que en una entrada no tendría sentido, así que la comisión de consumibles online es 3%.",
  },
  {
    q: "¿Y si el consumible lo cobra la barra en el evento?",
    a: "Esa venta no paga comisión. El 3% aplica solo cuando el consumible se vende online desde tu sitio y el cobro pasa por Mercado Pago. Lo que tu equipo cobra en la barra durante el evento es 100% tuyo.",
  },
  {
    q: "¿Hay un costo diferente para el check-in o los revendedores?",
    a: "No. Check-in QR, revendedores, roles de equipo y analytics están incluidos sin costo adicional. No hay módulos de pago separados.",
  },
  {
    q: "¿Cuándo recibo el dinero de las ventas?",
    a: "Al instante. Cada transacción va directamente a tu cuenta de Mercado Pago — Ticketera no toca ni retiene el dinero. No hay liquidaciones semanales ni quincenales.",
  },
  {
    q: "¿Cómo comienzo?",
    a: "Creás tu cuenta, mandamos aprobación en el día (revisión manual anti-fraude), y ya podés cargar tu primer evento. El setup no tiene costo.",
  },
]

export default function PreciosPage() {
  return (
    <StaticMarketingPageShell
      eyebrow="Precios"
      title="4% en entradas, 3% en consumibles. Lo que cobrás en el evento: 0%."
      description="Sin abono mensual, sin setup. La comisión se cobra solo sobre lo que se vende online — lo que tu equipo cobra en la puerta o en la barra es 100% tuyo. La plata cae al instante en tu Mercado Pago."
      toc={[
        { id: "modelo", label: "El modelo de precios" },
        { id: "que-incluye", label: "Qué incluye" },
        { id: "comparativa", label: "Comparativa" },
        { id: "preguntas", label: "Preguntas frecuentes" },
      ]}
    >
      <StaticPageSection title="El modelo de precios" description="" id="modelo">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-card border-2 border-[color:var(--marketing-accent)] bg-[color:var(--marketing-accent-soft)] p-6">
            <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[color:var(--marketing-accent)]">
              Entradas online
            </p>
            <p className="mt-3 text-5xl font-semibold tabular-nums tracking-tight text-[color:var(--marketing-ink-strong)] dark:text-white">
              4<span className="text-2xl">%</span>
            </p>
            <p className="mt-2 text-sm font-medium text-[color:var(--marketing-ink)]/85">
              por entrada vendida desde tu sitio
            </p>
            <ul className="mt-5 space-y-2">
              <li className="flex items-center gap-2 text-sm text-[color:var(--marketing-ink)]/85">
                <Check className="h-3.5 w-3.5 shrink-0 text-[color:var(--marketing-accent)]" />
                Sin costo fijo mensual
              </li>
              <li className="flex items-center gap-2 text-sm text-[color:var(--marketing-ink)]/85">
                <Check className="h-3.5 w-3.5 shrink-0 text-[color:var(--marketing-accent)]" />
                Sin cargo por QR emitido
              </li>
              <li className="flex items-center gap-2 text-sm text-[color:var(--marketing-ink)]/85">
                <Check className="h-3.5 w-3.5 shrink-0 text-[color:var(--marketing-accent)]" />
                Pago instantáneo a tu MP
              </li>
            </ul>
          </div>

          <div className="rounded-card border border-[color:var(--marketing-border)] bg-[color:var(--marketing-bg)] p-6">
            <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[color:var(--marketing-muted)]">
              Consumibles online
            </p>
            <p className="mt-3 text-5xl font-semibold tabular-nums tracking-tight text-[color:var(--marketing-ink-strong)] dark:text-white">
              3<span className="text-2xl">%</span>
            </p>
            <p className="mt-2 text-sm font-medium text-[color:var(--marketing-ink)]/85">
              por consumible vendido desde tu sitio
            </p>
            <ul className="mt-5 space-y-2">
              <li className="flex items-center gap-2 text-sm text-[color:var(--marketing-ink)]/85">
                <Check className="h-3.5 w-3.5 shrink-0 text-[color:var(--marketing-accent)]" />
                Más baja que la de entradas
              </li>
              <li className="flex items-center gap-2 text-sm text-[color:var(--marketing-ink)]/85">
                <Check className="h-3.5 w-3.5 shrink-0 text-[color:var(--marketing-accent)]" />
                Tragos y combos en preventa
              </li>
              <li className="flex items-center gap-2 text-sm text-[color:var(--marketing-ink)]/85">
                <Check className="h-3.5 w-3.5 shrink-0 text-[color:var(--marketing-accent)]" />
                QR por barra, canje sin caja
              </li>
            </ul>
          </div>

          <div className="rounded-card border border-[color:var(--marketing-border)] bg-[color:var(--marketing-bg)] p-6">
            <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[color:var(--marketing-muted)]">
              Puerta y barra en el evento
            </p>
            <p className="mt-3 text-5xl font-semibold tabular-nums tracking-tight text-[color:var(--marketing-ink-strong)] dark:text-white">
              0<span className="text-2xl">%</span>
            </p>
            <p className="mt-2 text-sm font-medium text-[color:var(--marketing-ink)]/85">
              sobre lo que cobra tu equipo
            </p>
            <ul className="mt-5 space-y-2">
              <li className="flex items-center gap-2 text-sm text-[color:var(--marketing-ink)]/85">
                <Check className="h-3.5 w-3.5 shrink-0 text-[color:var(--marketing-accent)]" />
                Entradas vendidas en puerta
              </li>
              <li className="flex items-center gap-2 text-sm text-[color:var(--marketing-ink)]/85">
                <Check className="h-3.5 w-3.5 shrink-0 text-[color:var(--marketing-accent)]" />
                Consumibles cobrados en la barra
              </li>
              <li className="flex items-center gap-2 text-sm text-[color:var(--marketing-ink)]/85">
                <Check className="h-3.5 w-3.5 shrink-0 text-[color:var(--marketing-accent)]" />
                Esa plata es 100% tuya
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="rounded-card border border-[color:var(--marketing-border)] bg-[color:var(--marketing-surface)] p-6">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-[color:var(--marketing-accent)]" />
              <p className="text-sm font-semibold text-[color:var(--marketing-ink-strong)] dark:text-white">Pago instantáneo</p>
            </div>
            <p className="mt-3 text-sm text-[color:var(--marketing-ink)]/82">
              El dinero de cada venta cae directamente en tu cuenta de Mercado Pago. Nada de liquidaciones semanales ni fondos retenidos.
            </p>
          </div>
          <div className="rounded-card border border-[color:var(--marketing-border)] bg-[color:var(--marketing-surface)] p-6">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-[color:var(--marketing-accent)]" />
              <p className="text-sm font-semibold text-[color:var(--marketing-ink-strong)] dark:text-white">Sin riesgo de inicio</p>
            </div>
            <p className="mt-3 text-sm text-[color:var(--marketing-ink)]/82">
              No pagás nada hasta vender. Si el evento no se hace o no vendés, el costo es cero.
            </p>
          </div>
        </div>
      </StaticPageSection>

      <StaticPageSection
        title="Todo incluido, sin cargos adicionales"
        description="No hay módulos de pago separados, ni planes avanzados. La comisión es el único costo."
        id="que-incluye"
      >
        <ul className="grid gap-2.5 sm:grid-cols-2">
          {features.map((f) => (
            <li key={f} className="flex items-start gap-3 text-sm text-[color:var(--marketing-ink)]/88">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--marketing-accent)]" />
              <span>{f}</span>
            </li>
          ))}
        </ul>
      </StaticPageSection>

      <StaticPageSection
        title="Cómo compara con otras ticketeras"
        description="Los tres puntos donde Ticketera es diferente."
        id="comparativa"
      >
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div className="min-w-[520px] overflow-hidden rounded-card border border-[color:var(--marketing-border)]">
          <div className="grid grid-cols-[1fr_1fr_1fr] border-b border-[color:var(--marketing-border)] bg-[color:var(--marketing-surface)] px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-[color:var(--marketing-muted)]">
            <span>Funcionalidad</span>
            <span>Ticketera</span>
            <span>Otras ticketeras</span>
          </div>
          {comparisons.map((c, i) => (
            <div
              key={c.feature}
              className={`grid grid-cols-[1fr_1fr_1fr] gap-2 px-4 py-3.5 text-sm ${
                i !== comparisons.length - 1 ? "border-b border-[color:var(--marketing-border)]" : ""
              } ${c.highlight ? "bg-[color:var(--marketing-accent-soft)]/30" : "bg-[color:var(--marketing-bg)]"}`}
            >
              <span className="font-medium text-[color:var(--marketing-ink-strong)] dark:text-white">{c.feature}</span>
              <span className="font-semibold text-[color:var(--marketing-accent)]">{c.ticketera}</span>
              <span className="text-[color:var(--marketing-ink)]/65">{c.others}</span>
            </div>
          ))}
        </div>
        </div>
      </StaticPageSection>

      <StaticPageSection title="Preguntas frecuentes" description="" id="preguntas">
        <div className="divide-y divide-[color:var(--marketing-border)]">
          {faqs.map(({ q, a }) => (
            <details key={q} className="group py-5">
              <summary className="flex cursor-pointer list-none items-start justify-between gap-4 text-sm font-semibold text-[color:var(--marketing-ink-strong)] dark:text-white">
                {q}
                <span
                  aria-hidden="true"
                  className="ml-4 shrink-0 text-[color:var(--marketing-muted)] transition-transform duration-200 group-open:rotate-180"
                >
                  ↓
                </span>
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-[color:var(--marketing-ink)]/82">{a}</p>
            </details>
          ))}
        </div>
      </StaticPageSection>

      <StaticPageSection title="" description="">
        <div className="rounded-card border border-[color:var(--marketing-accent)]/30 bg-[color:var(--marketing-accent-soft)] p-8 text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[color:var(--marketing-accent)]">
            Hecho en Argentina · Para Argentina
          </p>
          <h2 className="marketing-title mt-4 text-balance text-2xl text-[color:var(--marketing-ink-strong)] dark:text-white sm:text-3xl">
            Empezá gratis hoy.
          </h2>
          <p className="mt-3 text-sm text-[color:var(--marketing-ink)]/82">
            Aprobación manual en el día. Sin tarjeta de crédito. Sin costo hasta que vendás tu primer ticket.
          </p>
          <div className="mt-6 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <a
              href="/login?mode=register"
              className="inline-flex items-center gap-2 rounded-lg bg-[color:var(--marketing-accent)] px-6 py-3 text-sm font-semibold text-white transition-all duration-200 hover:-translate-y-0.5 hover:opacity-90"
            >
              Crear cuenta gratis
              <ArrowRight className="h-4 w-4" />
            </a>
            <a
              href="mailto:soporte@ticketera.com?subject=Consulta%20sobre%20precios"
              className="inline-flex items-center gap-2 text-sm font-semibold text-[color:var(--marketing-accent)] hover:underline"
            >
              Hablar con el equipo
            </a>
          </div>
        </div>
      </StaticPageSection>
    </StaticMarketingPageShell>
  )
}
