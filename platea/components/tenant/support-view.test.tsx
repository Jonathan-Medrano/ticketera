import assert from "node:assert/strict"
import test from "node:test"
import { renderToStaticMarkup } from "react-dom/server"
import { SupportExperienceView, type SupportViewForm, type SupportViewMessage, type SupportViewTenant } from "@/components/tenant/support-view"

const tenantBase: SupportViewTenant = {
  id: "tenant-1",
  nombre: "Club Demo",
  slug: "club-demo",
  logo_url: null,
  descripcion: "Experiencias en vivo",
  color_primario: "#7c3aed",
  color_fondo: "#111827",
  color_texto: "#ffffff",
  whatsapp: null,
}

const messagesBase: SupportViewMessage[] = [{ role: "bot", text: "Hola" }]
const formBase: SupportViewForm = { nombre: "", email: "", mensaje: "" }

test("SupportExperienceView shows FAQs without rendering the contact form when contact is disabled", () => {
  const markup = renderToStaticMarkup(
    <SupportExperienceView
      tenant={tenantBase}
      messages={messagesBase}
      questions={["¿Horario?", "¿Dónde veo mis tickets?"]}
      form={formBase}
      submitted={false}
      loading={false}
      error=""
      contactEnabled={false}
      interactive={false}
    />
  )

  assert.match(markup, /Respondé tus dudas rápido con nuestras preguntas frecuentes configuradas\./)
  assert.match(markup, /Preguntas frecuentes/)
  assert.match(markup, /¿Horario\?/) 
  assert.doesNotMatch(markup, /¿Necesitás más ayuda\?/) 
  assert.doesNotMatch(markup, /Enviar mensaje/)
})

test("SupportExperienceView shows contact form without FAQ list when no public FAQs exist", () => {
  const markup = renderToStaticMarkup(
    <SupportExperienceView
      tenant={tenantBase}
      messages={messagesBase}
      questions={[]}
      form={formBase}
      submitted={false}
      loading={false}
      error=""
      contactEnabled={true}
      interactive={false}
    />
  )

  assert.match(markup, /Escribinos desde el formulario y te respondemos a la brevedad\./)
  assert.match(markup, />¿Necesitás más ayuda\?</)
  assert.match(markup, />Nombre</)
  assert.match(markup, />Email</)
  assert.match(markup, />Mensaje</)
  assert.doesNotMatch(markup, /Preguntas frecuentes/)
  assert.doesNotMatch(markup, /Asistente automático/)
})
