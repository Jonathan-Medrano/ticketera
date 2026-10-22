import type { Metadata } from "next"

import StaticMarketingPageShell from "@/components/marketing/static-marketing-page-shell"
import StaticPageSection from "@/components/marketing/static-page-section"

export const metadata: Metadata = {
  title: "Política de privacidad · Ticketera",
}

const fecha = "12 de abril de 2026"

const toc = [
  { id: "datos-recopilados", label: "Qué datos recopilamos" },
  { id: "uso-de-datos", label: "Cómo usamos los datos" },
  { id: "almacenamiento-y-seguridad", label: "Almacenamiento y seguridad" },
  { id: "datos-de-menores", label: "Datos de menores" },
  { id: "tus-derechos", label: "Tus derechos" },
  { id: "cookies", label: "Cookies" },
  { id: "cambios-en-la-politica", label: "Cambios en esta política" },
] as const

export default function PrivacidadPage() {
  return (
    <StaticMarketingPageShell
      eyebrow="Legal"
      title="Política de privacidad"
      description={`Última actualización: ${fecha}. Qué datos guardamos, para qué los usamos y qué podés pedir si querés que se borren. Sin letra chica disimulada.`}
      toc={[...toc]}
    >
      <StaticPageSection index={1} id="datos-recopilados" title="Qué datos recopilamos">
        <p>Ticketera recopila distintos datos según el tipo de usuario:</p>
        <div className="space-y-5">
          <div
            className="rounded-card px-5 py-4"
            style={{
              background: "var(--marketing-accent-soft)",
              border: "1px solid rgba(56,189,248,0.15)",
            }}
          >
            <p className="mb-3 text-sm font-semibold" style={{ color: "var(--marketing-accent)" }}>
              Empresas registradas
            </p>
            <ul className="list-disc space-y-1.5 pl-5 text-sm" style={{ color: "var(--marketing-ink)", opacity: 0.88 }}>
              <li>Nombre y apellido del administrador.</li>
              <li>Nombre de la empresa y subdominio elegido.</li>
              <li>Email y contraseña almacenada con hash seguro.</li>
              <li>Datos de eventos publicados dentro de la plataforma.</li>
            </ul>
          </div>
          <div
            className="rounded-card px-5 py-4"
            style={{
              background: "var(--marketing-surface-strong)",
              border: "1px solid var(--marketing-border)",
            }}
          >
            <p className="mb-3 text-sm font-semibold" style={{ color: "var(--marketing-ink-strong)" }}>
              Compradores de entradas
            </p>
            <ul className="list-disc space-y-1.5 pl-5 text-sm" style={{ color: "var(--marketing-ink)", opacity: 0.88 }}>
              <li>Nombre completo, email y DNI.</li>
              <li>Historial de compras y entradas generadas.</li>
              <li>Datos de pago procesados por el proveedor externo correspondiente.</li>
            </ul>
          </div>
        </div>
      </StaticPageSection>

      <StaticPageSection index={2} id="uso-de-datos" title="Cómo usamos los datos">
        <ul className="list-disc space-y-2 pl-6">
          <li>Para operar la plataforma y procesar transacciones.</li>
          <li>Para enviar confirmaciones de compra y comunicaciones relacionadas al servicio.</li>
          <li>Para generar reportes de ventas accesibles solo por la empresa correspondiente.</li>
          <li>Para calcular y cobrar la comisión sobre las ventas online (entradas y consumibles), y para determinar el volumen de ventas que define la comisión aplicable a cada empresa.</li>
          <li>No vendemos ni compartimos datos personales con terceros con fines comerciales.</li>
        </ul>
      </StaticPageSection>

      <StaticPageSection index={3} id="almacenamiento-y-seguridad" title="Almacenamiento y seguridad">
        <p>
          Los datos se almacenan en servidores seguros. Las contraseñas se guardan usando algoritmos de hash unidireccional y nunca en texto plano. Aplicamos medidas técnicas razonables para proteger la información contra accesos no autorizados.
        </p>
      </StaticPageSection>

      <StaticPageSection index={4} id="datos-de-menores" title="Datos de menores">
        <p>
          Ticketera no está dirigida a menores de 18 años. Si tomás conocimiento de que un menor registró una cuenta, contactanos a través del soporte para eliminar la información correspondiente.
        </p>
      </StaticPageSection>

      <StaticPageSection index={5} id="tus-derechos" title="Tus derechos">
        <p>
          De acuerdo con la Ley 25.326 de Protección de Datos Personales de Argentina, tenés derecho a acceder, rectificar y suprimir tus datos personales. Para ejercer estos derechos, contactanos desde la sección de soporte.
        </p>
      </StaticPageSection>

      <StaticPageSection index={6} id="cookies" title="Cookies">
        <p>
          Usamos cookies estrictamente necesarias para mantener tu sesión activa. No usamos cookies de seguimiento ni publicidad de terceros.
        </p>
      </StaticPageSection>

      <StaticPageSection index={7} id="cambios-en-la-politica" title="Cambios en esta política">
        <p>
          Podemos actualizar esta política cuando sea necesario. Si el cambio es significativo, te lo notificaremos por los canales correspondientes.
        </p>
      </StaticPageSection>

      <div className="mt-12 rounded-card border border-[color:var(--marketing-border)] bg-[color:var(--marketing-surface)] px-6 py-5">
        <p className="text-sm text-[color:var(--marketing-ink)]/85">
          <span className="font-semibold text-[color:var(--marketing-ink-strong)] dark:text-white">¿Querés que borremos tus datos?</span>{" "}
          Escribinos a{" "}
          <a href="mailto:hola@ticketera.com" className="font-semibold text-[color:var(--marketing-accent)] underline-offset-4 hover:underline">
            hola@ticketera.com
          </a>{" "}
          desde el mail registrado y lo procesamos bajo la Ley 25.326. No te lo hacemos difícil.
        </p>
      </div>
    </StaticMarketingPageShell>
  )
}
