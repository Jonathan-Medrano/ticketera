import type { Metadata } from "next"

import StaticMarketingPageShell from "@/components/marketing/static-marketing-page-shell"
import StaticPageSection from "@/components/marketing/static-page-section"

export const metadata: Metadata = {
  // Sin sufijo de marca: el template del root layout ya agrega " | Ticketera".
  title: "Cuándo cobrás tu plata",
  description:
    "Cómo y cuándo recibís el dinero de tus ventas, y dónde se revisan los plazos de acreditación de tu cuenta de Mercado Pago.",
}

/**
 * Ayuda oficial de Mercado Pago, no una URL interna de su panel.
 *
 * Mercado Pago configura costos y plazos POR CANAL DE COBRO: QR, Point (el lector
 * físico), Checkout y Link de pago tienen cada uno su propia pantalla. Las URLs
 * internas incluyen el canal en el path (`/costs-section/point/...`), así que
 * linkear una manda al organizador al canal equivocado: las entradas se venden
 * por Checkout online, no por Point, y tocar el plazo de Point no cambiaría nada.
 *
 * Por eso apuntamos a la ayuda oficial, que explica el concepto y lo lleva a la
 * sección correcta de SU cuenta, y además no se rompe cuando cambian los menús.
 */
const COSTOS_Y_PLAZOS_URL = "https://www.mercadopago.com.ar/ayuda/20513"

const toc = [
  { id: "donde-entra", label: "Dónde entra la plata" },
  { id: "por-que-tarda", label: "Por qué a veces tarda" },
  { id: "donde-se-mira", label: "Dónde se revisa" },
  { id: "porcentajes", label: "Sobre los porcentajes" },
  { id: "quien-hace-que", label: "Quién hace qué" },
] as const

/**
 * Página de ayuda para organizadores sobre plazos de acreditación.
 *
 * Sobre el alcance de lo que afirma: que el dinero entra directo a la cuenta del
 * organizador y que Ticketera no fija plazos está verificado contra la propia
 * integración (OAuth de Mercado Pago + application_fee, sin `money_release` en
 * ningún punto del backend). Lo que NO está confirmado es que toda cuenta pueda
 * cambiar su plazo: depende de las condiciones que Mercado Pago le habilite a
 * cada vendedor. Por eso la página dice "revisá qué opciones tenés" y nunca
 * "podés cambiarlo", y no publica ningún porcentaje: los aranceles varían por
 * rubro y volumen, y un número equivocado acá destruye la confianza justo en el
 * tema donde no se puede fallar, que es la plata.
 */
export default function AyudaCobrosPage() {
  return (
    <StaticMarketingPageShell
      eyebrow="Ayuda para organizadores"
      title="Cuándo cobrás tu plata"
      description="Si sentís que el dinero de tus ventas tarda en estar disponible, acá te explicamos de qué depende y dónde se revisa."
      toc={[...toc]}
    >
      <StaticPageSection id="donde-entra" title="La plata va directo a tu cuenta">
        <p>
          Cuando alguien compra una entrada, el dinero entra{" "}
          <strong style={{ color: "var(--marketing-ink-strong)" }}>a tu cuenta de Mercado Pago</strong>, el mismo día
          de la venta. Ticketera no lo recibe, no lo guarda y no lo retiene.
        </p>
        <p>
          Nuestra comisión se descuenta en ese mismo momento. No tenés que transferirnos nada después ni esperar una
          liquidación de nuestra parte.
        </p>
      </StaticPageSection>

      <StaticPageSection id="por-que-tarda" title="Por qué a veces tarda en estar disponible">
        <p>
          Una cosa es que la plata entre y otra es cuándo la podés usar. La venta se procesa{" "}
          <strong style={{ color: "var(--marketing-ink-strong)" }}>con tu cuenta de Mercado Pago</strong>, así que
          corren las condiciones que vos tenés con ellos: sus aranceles y sus plazos de acreditación.
        </p>
        <p>
          Ese plazo no lo define la plataforma de venta de entradas. Lo define Mercado Pago, y funciona con un
          intercambio simple: si querés la plata disponible antes, la comisión es mayor; si podés esperar, es menor.
        </p>
        <p>
          Lo que sí cambia según la plataforma es si te suman demora encima. Hay servicios que cobran a su propia
          cuenta y después te liquidan a vos, y ahí se agrega una espera adicional.{" "}
          <strong style={{ color: "var(--marketing-ink-strong)" }}>
            Con Ticketera eso no pasa: cobrás vos, en tu cuenta, desde el primer día.
          </strong>
        </p>
      </StaticPageSection>

      <StaticPageSection id="donde-se-mira" title="Dónde se revisa tu plazo">
        <p>
          Se mira desde tu propia cuenta de Mercado Pago. Antes de arrancar, un dato que evita perder el viaje:{" "}
          <strong style={{ color: "var(--marketing-ink-strong)" }}>
            Mercado Pago maneja los costos y plazos por separado para cada forma de cobro
          </strong>{" "}
          (QR, Point, Checkout y Link de pago). Las entradas se venden por Checkout online, así que esa es la sección
          que te importa. Cambiar el plazo de Point, que es el lector de tarjetas, no afecta tus ventas de entradas.
        </p>
        <p>Son tres pasos:</p>

        <ol className="space-y-4 pl-0">
          <li className="flex gap-4">
            <span
              className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold"
              style={{
                background: "var(--marketing-accent-soft)",
                color: "var(--marketing-accent)",
              }}
              aria-hidden="true"
            >
              1
            </span>
            <span>Entrá a Mercado Pago con el usuario con el que cobrás las entradas.</span>
          </li>
          <li className="flex gap-4">
            <span
              className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold"
              style={{
                background: "var(--marketing-accent-soft)",
                color: "var(--marketing-accent)",
              }}
              aria-hidden="true"
            >
              2
            </span>
            <span>
              Entrá a la sección de costos y plazos de acreditación. Mercado Pago explica dónde está acá:{" "}
              <a
                href={COSTOS_Y_PLAZOS_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold underline underline-offset-4"
                style={{ color: "var(--marketing-accent)" }}
              >
                cómo elegir costos y plazos
              </a>
              .
            </span>
          </li>
          <li className="flex gap-4">
            <span
              className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold"
              style={{
                background: "var(--marketing-accent-soft)",
                color: "var(--marketing-accent)",
              }}
              aria-hidden="true"
            >
              3
            </span>
            <span>
              Elegí la sección de <strong style={{ color: "var(--marketing-ink-strong)" }}>Checkout</strong> o{" "}
              <strong style={{ color: "var(--marketing-ink-strong)" }}>Link de pago</strong>, y fijate qué plazos tenés
              habilitados ahí y qué comisión tiene cada uno. Si hay uno más corto que te sirve, lo elegís y aplica a tus
              ventas siguientes.
            </span>
          </li>
        </ol>

        <p>
          Si entrás y no te deja cambiarlo, o directamente no te aparece la opción, escribinos y lo consultamos con
          Mercado Pago junto con vos.
        </p>
      </StaticPageSection>

      <StaticPageSection id="porcentajes" title="Por qué no publicamos los porcentajes">
        <p>
          Porque no son iguales para todos. Los aranceles de Mercado Pago cambian según el rubro, el volumen de ventas
          y las condiciones que cada cuenta tenga acordada con ellos.
        </p>
        <p>
          Los números que valen son los que ves en tu pantalla. Cualquier porcentaje que te pasemos nosotros sería un
          dato inventado, y en un tema de plata preferimos decirte dónde mirarlo antes que arriesgar un número
          equivocado.
        </p>
      </StaticPageSection>

      <StaticPageSection id="quien-hace-que" title="Quién hace qué">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[22rem] border-collapse text-left text-sm">
            <thead>
              <tr>
                <th
                  scope="col"
                  className="border-b py-3 pr-4 font-medium"
                  style={{ borderColor: "var(--marketing-border)", color: "var(--marketing-ink)", opacity: 0.7 }}
                >
                  Tema
                </th>
                <th
                  scope="col"
                  className="border-b py-3 font-medium"
                  style={{ borderColor: "var(--marketing-border)", color: "var(--marketing-ink)", opacity: 0.7 }}
                >
                  Quién lo maneja
                </th>
              </tr>
            </thead>
            <tbody>
              {[
                ["Vender las entradas", "Ticketera"],
                ["Control de acceso y QR", "Ticketera"],
                ["Barra, stock y reportes", "Ticketera"],
                ["Dónde entra la plata", "Tu cuenta de Mercado Pago"],
                ["Cuándo podés usarla", "Mercado Pago, según las condiciones de tu cuenta"],
              ].map(([tema, quien]) => (
                <tr key={tema}>
                  <td
                    className="border-b py-3 pr-4 font-semibold"
                    style={{ borderColor: "var(--marketing-border)", color: "var(--marketing-ink-strong)" }}
                  >
                    {tema}
                  </td>
                  <td
                    className="border-b py-3"
                    style={{ borderColor: "var(--marketing-border)", color: "var(--marketing-ink)" }}
                  >
                    {quien}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p>
          No podemos adelantarte el dinero ni acortar el plazo desde nuestro lado, porque nunca pasa por nuestras
          manos. Y eso es a propósito:{" "}
          <strong style={{ color: "var(--marketing-ink-strong)" }}>es tu plata y tiene que estar en tu cuenta.</strong>
        </p>
      </StaticPageSection>
    </StaticMarketingPageShell>
  )
}
