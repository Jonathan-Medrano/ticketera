"use client"

import { ChevronRight, MessageCircle, Send } from "lucide-react"
import { TenantPanel } from "./tenant-surface"
import { TenantInput, TenantTextarea } from "./tenant-field"
import { normalizeInfoContentToHtml, sanitizeTenantRichText } from "@/lib/tenant-rich-text"
import type { TenantEmpresa } from "@/lib/tenant"

import { TENANT_NAVBAR_CLEARANCE } from "@/lib/tenant-navbar-clearance"
export type SupportViewTenant = Pick<TenantEmpresa, "id" | "nombre" | "slug" | "logo_url" | "descripcion" | "color_primario" | "color_fondo" | "color_texto" | "whatsapp">

export type SupportViewMessage = {
  role: "bot" | "user"
  text: string
}

export type SupportViewForm = {
  nombre: string
  email: string
  mensaje: string
}

function isLightColor(hex: string): boolean {
  const clean = hex.replace("#", "")
  if (clean.length !== 6) return false
  const r = parseInt(clean.slice(0, 2), 16)
  const g = parseInt(clean.slice(2, 4), 16)
  const b = parseInt(clean.slice(4, 6), 16)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5
}

function buildSupportTheme(tenant: SupportViewTenant) {
  const isLight = isLightColor(tenant.color_fondo)

  return {
    isLight,
    panelBackground: `${tenant.color_texto}06`,
    panelBorder: `${tenant.color_texto}14`,
    panelShadow: "none",
    mutedText: `${tenant.color_texto}${isLight ? "75" : "80"}`,
    softText: `${tenant.color_texto}${isLight ? "55" : "45"}`,
    botBubble: isLight ? "rgba(15,23,42,0.06)" : `${tenant.color_texto}12`,
    questionSurface: isLight ? "rgba(15,23,42,0.04)" : `${tenant.color_texto}08`,
    questionSurfaceHover: isLight ? "rgba(15,23,42,0.06)" : `${tenant.color_texto}12`,
    contactSurface: isLight ? "rgba(15,23,42,0.04)" : `${tenant.color_texto}05`,
    successSurface: isLight ? `${tenant.color_primario}18` : `${tenant.color_primario}22`,
  }
}

export function SupportExperienceView({
  tenant,
  messages,
  questions,
  form,
  submitted,
  loading,
  error,
  contactEnabled,
  interactive = true,
  botTyping = false,
  onQuestionSelect,
  onFormChange,
  onSubmit,
}: {
  tenant: SupportViewTenant
  messages: SupportViewMessage[]
  questions: string[]
  form: SupportViewForm
  submitted: boolean
  loading: boolean
  error: string
  contactEnabled: boolean
  interactive?: boolean
  botTyping?: boolean
  onQuestionSelect?: (question: string) => void
  onFormChange?: (next: SupportViewForm) => void
  onSubmit?: (e: React.FormEvent) => void
}) {
  const theme = buildSupportTheme(tenant)

  return (
    <>
      <TenantPanel tenant={tenant} className="mb-8 overflow-hidden rounded-[2rem] border p-5 md:p-6" style={{ background: theme.panelBackground, borderColor: theme.panelBorder, boxShadow: theme.panelShadow }}>
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <div className="inline-flex items-center rounded-full px-3 py-1 text-[11px] font-semibold" style={{ background: `${tenant.color_primario}18`, color: tenant.color_primario }}>
            Centro de ayuda
          </div>
          {tenant.whatsapp ? (
            <div className="inline-flex items-center rounded-full px-3 py-1 text-[11px] font-medium" style={{ background: theme.questionSurface, color: theme.mutedText }}>
              WhatsApp activo
            </div>
          ) : null}
        </div>

        <h1 className="text-3xl md:text-4xl font-black tracking-[-0.04em]" style={{ color: tenant.color_texto }}>Soporte</h1>
        <p className="text-sm md:text-base mt-3 max-w-xl leading-relaxed" style={{ color: theme.mutedText }}>
          {questions.length > 0 && contactEnabled
            ? "Respondé tus dudas rápido con nuestras preguntas frecuentes configuradas o contactanos desde el formulario."
            : questions.length > 0
              ? "Respondé tus dudas rápido con nuestras preguntas frecuentes configuradas."
              : contactEnabled
                ? "Escribinos desde el formulario y te respondemos a la brevedad."
                : "Ahora mismo este tenant no tiene un canal público de soporte habilitado."}
        </p>
      </TenantPanel>

      {questions.length > 0 ? <TenantPanel tenant={tenant} className="rounded-[2rem] overflow-hidden mb-6 border" style={{ background: theme.panelBackground, borderColor: theme.panelBorder, boxShadow: theme.panelShadow }}>
        <div className="px-4 py-3 border-b flex items-center gap-2" style={{ borderColor: theme.panelBorder }}>
          <MessageCircle className="h-4 w-4" style={{ color: tenant.color_primario }} />
          <p className="text-sm font-semibold" style={{ color: tenant.color_texto }}>Asistente automático</p>
        </div>

        <div className="p-4 space-y-3 min-h-[200px] max-h-80 overflow-y-auto">
          {messages.map((message, index) => (
            <div key={`${message.role}-${index}`} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
              {message.role === "user" ? (
                <div
                  className="max-w-[85%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed text-white rounded-br-sm"
                  style={{ background: tenant.color_primario }}
                >
                  {message.text}
                </div>
              ) : (
                <div
                  className="max-w-[85%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed rounded-bl-sm [&_a]:underline [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_li]:my-0.5 [&_p+p]:mt-1.5 [&_strong]:font-semibold [&_em]:italic [&_u]:underline [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:opacity-80"
                  style={{ background: theme.botBubble, color: theme.mutedText }}
                  dangerouslySetInnerHTML={{ __html: sanitizeTenantRichText(normalizeInfoContentToHtml(message.text)) }}
                />
              )}
            </div>
          ))}
        </div>

        <div className="px-4 pb-4 border-t pt-3 space-y-2" style={{ borderColor: theme.panelBorder }}>
          <p className="text-xs mb-2 font-medium uppercase tracking-[0.18em]" style={{ color: theme.softText }}>Preguntas frecuentes</p>
          {questions.map((question) => (
            <button
              key={question}
              onClick={() => onQuestionSelect?.(question)}
              disabled={!interactive || botTyping}
              className="w-full flex items-center justify-between px-3 py-3 rounded-2xl text-left text-sm transition-all cursor-pointer disabled:cursor-default"
              style={{ background: theme.questionSurface, color: theme.mutedText, opacity: interactive && !botTyping ? 1 : 0.98 }}
            >
              <span className="font-medium">{question}</span>
              <ChevronRight className="h-4 w-4 shrink-0" style={{ color: theme.softText }} />
            </button>
            ))}
        </div>
      </TenantPanel> : null}

      {contactEnabled ? <TenantPanel tenant={tenant} className="rounded-[2rem] p-5 border" style={{ background: theme.panelBackground, borderColor: theme.panelBorder, boxShadow: theme.panelShadow }}>
        <p className="font-bold mb-1" style={{ color: tenant.color_texto }}>¿Necesitás más ayuda?</p>
        <p className="text-sm mb-5" style={{ color: theme.mutedText }}>Completá el formulario y te respondemos a la brevedad.</p>

        {submitted ? (
          <div className="text-center py-8">
            <div className="h-14 w-14 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: theme.successSurface }}>
              <Send className="h-7 w-7" style={{ color: tenant.color_primario }} />
            </div>
            <p className="font-bold mb-1" style={{ color: tenant.color_texto }}>¡Mensaje enviado!</p>
            <p className="text-sm" style={{ color: theme.mutedText }}>Te responderemos a la brevedad en tu email</p>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-3">
            {error ? (
              <div
                role="alert"
                className="rounded-xl border px-4 py-3 text-sm"
                style={{
                  background: theme.isLight ? "rgb(254 242 242)" : "rgba(239,68,68,0.1)",
                  borderColor: theme.isLight ? "rgb(252 165 165)" : "rgba(248,113,113,0.3)",
                  color: theme.isLight ? "rgb(185 28 28)" : "rgb(252 165 165)",
                }}
              >
                {error}
              </div>
            ) : null}

            <label className="block space-y-2 text-sm font-medium" style={{ color: tenant.color_texto }}>
              <span>Nombre</span>
              <TenantInput
                tenant={tenant}
                id="support-nombre"
                name="nombre"
                autoComplete="name"
                placeholder="Tu nombre"
                value={form.nombre}
                onChange={(e) => onFormChange?.({ ...form, nombre: e.target.value })}
                required
                disabled={!interactive}
              />
            </label>
            <label className="block space-y-2 text-sm font-medium" style={{ color: tenant.color_texto }}>
              <span>Email</span>
              <TenantInput
                tenant={tenant}
                id="support-email"
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="tu@email.com"
                value={form.email}
                onChange={(e) => onFormChange?.({ ...form, email: e.target.value })}
                required
                disabled={!interactive}
              />
            </label>
            <label className="block space-y-2 text-sm font-medium" style={{ color: tenant.color_texto }}>
              <span>Mensaje</span>
              <TenantTextarea
                tenant={tenant}
                placeholder="Describí tu consulta..."
                rows={4}
                value={form.mensaje}
                onChange={(e) => onFormChange?.({ ...form, mensaje: e.target.value })}
                required
                disabled={!interactive}
              />
            </label>

            {tenant.whatsapp ? (
              <a
                href={interactive ? `https://wa.me/${tenant.whatsapp.replace(/\D/g, "")}` : undefined}
                target={interactive ? "_blank" : undefined}
                rel={interactive ? "noopener noreferrer" : undefined}
                className={`flex items-center justify-center gap-2 w-full h-11 rounded-xl border text-sm transition-all ${interactive ? "cursor-pointer" : "cursor-default"}`}
                style={{ borderColor: theme.panelBorder, color: theme.mutedText, background: theme.contactSurface }}
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                </svg>
                Contactar por WhatsApp
              </a>
            ) : null}

            <button
              type="submit"
              disabled={loading || !interactive}
              className="w-full h-11 rounded-xl font-bold text-white text-sm flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
              style={{ background: tenant.color_primario }}
            >
              <Send className="h-4 w-4" />
              {loading ? "Enviando..." : "Enviar mensaje"}
            </button>
          </form>
        )}
      </TenantPanel> : null}

      {!contactEnabled && questions.length === 0 ? (
        <TenantPanel tenant={tenant} className="rounded-[2rem] p-5 border" style={{ background: theme.panelBackground, borderColor: theme.panelBorder, boxShadow: theme.panelShadow }}>
          <p className="font-bold mb-1" style={{ color: tenant.color_texto }}>Soporte no disponible</p>
          <p className="text-sm" style={{ color: theme.mutedText }}>Todavía no hay FAQs visibles ni un email público configurado para este tenant.</p>
        </TenantPanel>
      ) : null}
    </>
  )
}

export function SupportExperienceScreen(
  props: React.ComponentProps<typeof SupportExperienceView>
) {
  const { tenant } = props

  return (
    <div className="min-h-screen pb-28" style={{ background: tenant.color_fondo, color: tenant.color_texto }}>
      <div className="max-w-2xl mx-auto px-4" style={{ paddingTop: TENANT_NAVBAR_CLEARANCE }}>
        <SupportExperienceView {...props} />
      </div>
    </div>
  )
}
