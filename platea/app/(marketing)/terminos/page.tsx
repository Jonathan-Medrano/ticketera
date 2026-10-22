import type { Metadata } from "next"

import StaticMarketingPageShell from "@/components/marketing/static-marketing-page-shell"
import StaticPageSection from "@/components/marketing/static-page-section"

export const metadata: Metadata = {
  title: "Términos de uso · Ticketera",
}

const fecha = "12 de agosto de 2026"

const toc = [
  { id: "sobre-ticketera", label: "Sobre Ticketera" },
  { id: "registro-y-cuenta", label: "Registro y cuenta" },
  { id: "comision-por-venta", label: "Comisión por venta" },
  { id: "comision-por-volumen", label: "Comisión por volumen" },
  { id: "responsabilidades-empresa", label: "Responsabilidades de la empresa" },
  { id: "responsabilidades-compradores", label: "Responsabilidades de compradores" },
  { id: "reembolsos-y-cancelaciones", label: "Reembolsos y cancelaciones" },
  { id: "suspension-del-servicio", label: "Suspensión del servicio" },
  { id: "modificaciones", label: "Modificaciones" },
  { id: "jurisdiccion", label: "Jurisdicción" },
] as const

export default function TerminosPage() {
  return (
    <StaticMarketingPageShell
      eyebrow="Legal"
      title="Términos de uso"
      description={`Última actualización: ${fecha}. Lo escribimos lo más claro que se puede para algo legal: qué hace cada parte, cuánto cobramos y qué pasa si algo se rompe.`}
      toc={[...toc]}
    >
      <StaticPageSection index={1} id="sobre-ticketera" title="Sobre Ticketera">
        <p>
          Ticketera es una plataforma de venta de entradas operada por una persona física registrada en Argentina. Permite a empresas y organizadores crear su propio espacio de venta bajo un subdominio exclusivo{" "}
          <strong style={{ color: "var(--marketing-ink-strong)" }}>tuempresa.ticketera.com</strong>{" "}
          y gestionar la venta de entradas a sus eventos.
        </p>
      </StaticPageSection>

      <StaticPageSection index={2} id="registro-y-cuenta" title="Registro y cuenta">
        <p>
          Para usar Ticketera como empresa, debés registrarte con información verídica. Sos responsable de mantener la confidencialidad de tus credenciales de acceso. Ticketera se reserva el derecho de suspender cuentas que incumplan estos términos o que contengan información falsa.
        </p>
      </StaticPageSection>

      <StaticPageSection index={3} id="comision-por-venta" title="Comisión por venta">
        <p>
          Ticketera cobra comisión <strong style={{ color: "var(--marketing-ink-strong)" }}>únicamente sobre las ventas
          realizadas online</strong> a través de la plataforma, según el siguiente esquema:
        </p>
        <ul className="list-disc space-y-2 pl-6">
          <li>
            <strong style={{ color: "var(--marketing-ink-strong)" }}>4% sobre el valor de cada entrada</strong> vendida
            online.
          </li>
          <li>
            <strong style={{ color: "var(--marketing-ink-strong)" }}>3% sobre el valor de cada consumible</strong>{" "}
            vendido online.
          </li>
          <li>
            <strong style={{ color: "var(--marketing-ink-strong)" }}>0% sobre las ventas presenciales</strong>: las
            entradas cobradas en puerta y los consumibles cobrados en la barra durante el evento no generan comisión.
          </li>
        </ul>
        <p>
          La comisión se descuenta automáticamente al momento del procesamiento del pago. El monto restante es
          transferido a la empresa según los plazos del procesador de pagos utilizado.
        </p>
        <p>
          Los precios de las entradas y de los consumibles son definidos exclusivamente por cada empresa. Ticketera no
          interviene en la política de precios ni se responsabiliza por errores de carga.
        </p>
      </StaticPageSection>

      <StaticPageSection index={4} id="comision-por-volumen" title="Comisión por volumen">
        <p>
          Ticketera puede aplicar comisiones reducidas a las empresas que superen determinados volúmenes de venta. El
          volumen se mide en <strong style={{ color: "var(--marketing-ink-strong)" }}>cantidad de entradas vendidas
          online</strong> durante los últimos 90 días, excluyendo las ventas presenciales y las entradas reembolsadas.
        </p>
        <p>
          Las reducciones de comisión se aplican de forma automática cuando la empresa alcanza el volumen
          correspondiente, y rigen para las ventas posteriores a la fecha de aplicación.
        </p>
        <p>
          <strong style={{ color: "var(--marketing-ink-strong)" }}>
            Si el volumen de una empresa disminuye y le correspondiera una comisión mayor, el ajuste no se aplica de
            forma automática: Ticketera lo notificará previamente a la empresa antes de modificar su comisión.
          </strong>{" "}
          Ningún ajuste de comisión, en ninguna dirección, se aplica retroactivamente sobre ventas ya procesadas.
        </p>
        <p>
          Los umbrales y porcentajes vigentes pueden consultarse en la página de precios o solicitarse a{" "}
          <a
            href="mailto:soporte@ticketera.com"
            className="font-semibold text-[color:var(--marketing-accent)] underline-offset-4 hover:underline"
          >
            soporte@ticketera.com
          </a>
          . Ticketera podrá modificarlos notificando a las empresas alcanzadas.
        </p>
      </StaticPageSection>

      <StaticPageSection index={5} id="responsabilidades-empresa" title="Responsabilidades de la empresa">
        <p>Al registrarte como empresa en Ticketera, aceptás que:</p>
        <ul className="list-disc space-y-2 pl-6">
          <li>Sos el único responsable de la realización del evento publicado.</li>
          <li>La información del evento debe ser exacta y mantenerse actualizada.</li>
          <li>En caso de cancelación o modificación del evento, te corresponde notificar a compradores y gestionar reembolsos.</li>
          <li>No podés usar la plataforma para vender entradas a eventos ilegales o que violen derechos de terceros.</li>
          <li>Sos responsable del cumplimiento de la normativa vigente en Argentina respecto a la venta de entradas y habilitaciones del evento.</li>
        </ul>
      </StaticPageSection>

      <StaticPageSection index={6} id="responsabilidades-compradores" title="Responsabilidades de los compradores">
        <p>
          Los compradores de entradas aceptan que la transacción se realiza directamente con la empresa organizadora del evento. Ticketera actúa como intermediario tecnológico y no es responsable por la realización, cancelación o modificación del evento.
        </p>
        <p>
          Cada entrada genera un código QR único e intransferible. El uso del QR implica el ingreso al evento y no puede ser reutilizado.
        </p>
      </StaticPageSection>

      <StaticPageSection index={7} id="reembolsos-y-cancelaciones" title="Reembolsos y cancelaciones">
        <p>
          Ticketera no procesa reembolsos de forma directa. En caso de cancelación de un evento, la empresa organizadora es responsable de gestionar las devoluciones a los compradores. Ticketera puede colaborar facilitando información de contacto entre las partes, pero no garantiza ni ejecuta reembolsos.
        </p>
      </StaticPageSection>

      <StaticPageSection index={8} id="suspension-del-servicio" title="Suspensión del servicio">
        <p>Ticketera se reserva el derecho de suspender o eliminar cuentas de empresas que:</p>
        <ul className="list-disc space-y-2 pl-6">
          <li>Publiquen eventos fraudulentos o inexistentes.</li>
          <li>Incumplan reiteradamente con sus compradores.</li>
          <li>Violen estos términos de uso.</li>
        </ul>
      </StaticPageSection>

      <StaticPageSection index={9} id="modificaciones" title="Modificaciones">
        <p>
          Ticketera puede modificar estos términos en cualquier momento. Los cambios serán notificados por email con al menos 15 días de anticipación. El uso continuado de la plataforma implica la aceptación de los nuevos términos.
        </p>
      </StaticPageSection>

      <StaticPageSection index={10} id="jurisdiccion" title="Jurisdicción">
        <p>
          Estos términos se rigen por las leyes de la República Argentina. Ante cualquier conflicto, las partes se someten a la jurisdicción de los tribunales ordinarios de la Ciudad Autónoma de Buenos Aires.
        </p>
      </StaticPageSection>

      <div className="mt-12 rounded-card border border-[color:var(--marketing-border)] bg-[color:var(--marketing-surface)] px-6 py-5">
        <p className="text-sm text-[color:var(--marketing-ink)]/85">
          <span className="font-semibold text-[color:var(--marketing-ink-strong)] dark:text-white">¿Algo no se entiende?</span>{" "}
          Mejor preguntar que firmar a ciegas. Escribinos a{" "}
          <a href="mailto:hola@ticketera.com" className="font-semibold text-[color:var(--marketing-accent)] underline-offset-4 hover:underline">
            hola@ticketera.com
          </a>{" "}
          y te respondemos sin abogadeo.
        </p>
      </div>
    </StaticMarketingPageShell>
  )
}
