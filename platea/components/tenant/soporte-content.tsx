"use client"

import { useEffect, useMemo, useState } from "react"
import { useTenant } from "./tenant-provider"
import { useTenantBuyerSession } from "./tenant-buyer-session-provider"
import { buildTenantApiPath } from "@/lib/tenant"
import { resolvePublicTenantSupportFaqCollection } from "@/lib/tenant-support"
import { SupportExperienceScreen, type SupportViewMessage } from "./support-view"

export default function SoporteContent() {
  const tenant = useTenant()
  const { buyerSession } = useTenantBuyerSession()

  const faqItems = useMemo(() => {
    return resolvePublicTenantSupportFaqCollection(tenant.faqs)
  }, [tenant.faqs])

  const respuestasAuto = useMemo(() => {
    return new Map(faqItems.map((item) => [item.question, item.answer]))
  }, [faqItems])

  const [mensajes, setMensajes] = useState<SupportViewMessage[]>([
    {
      role: "bot",
      text: `¡Hola! 👋 Soy el asistente de ${tenant.nombre}. ¿En qué puedo ayudarte?`,
    },
  ])

  const [formulario, setFormulario] = useState({
      nombre: buyerSession?.name ?? "",
      email: buyerSession?.email ?? "",
    mensaje: "",
  })
  const storageKey = `soporte:${tenant.slug}`
  const [botTyping, setBotTyping] = useState(false)
  const [enviado, setEnviado] = useState(false)
  const [loadingForm, setLoadingForm] = useState(false)
  const [errorForm, setErrorForm] = useState("")

  useEffect(() => {
    if (typeof window !== "undefined" && localStorage.getItem(storageKey)) {
      setEnviado(true)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    setFormulario((prev) => ({
      ...prev,
      nombre: prev.nombre || buyerSession?.name || "",
      email: prev.email || buyerSession?.email || "",
    }))
  }, [buyerSession?.name, buyerSession?.email])

  function responderAuto(pregunta: string) {
    if (botTyping) return
    setBotTyping(true)
    setMensajes((prev) => [...prev, { role: "user", text: pregunta }])
    setTimeout(() => {
      setMensajes((prev) => [
        ...prev,
          {
            role: "bot",
            text:
               respuestasAuto.get(pregunta) ??
               (tenant.support_contact_enabled
                 ? "Para más información, completá el formulario de contacto más abajo."
                 : "No hay formulario público disponible en este momento."),
          },
        ])
      setBotTyping(false)
    }, 600)
  }

  async function handleFormulario(e: React.FormEvent) {
    e.preventDefault()
    setLoadingForm(true)
    setErrorForm("")

    try {
      const res = await fetch(buildTenantApiPath(tenant.slug, "/soporte"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formulario),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setErrorForm(data?.error ?? "No se pudo enviar el mensaje. Probá nuevamente o usá WhatsApp.")
        return
      }
      localStorage.setItem(storageKey, Date.now().toString())
      setEnviado(true)
    } finally {
      setLoadingForm(false)
    }
  }

  return (
    <SupportExperienceScreen
      tenant={tenant}
      messages={mensajes}
       questions={faqItems.map((item) => item.question)}
      form={formulario}
      submitted={enviado}
      loading={loadingForm}
      error={errorForm}
      contactEnabled={Boolean(tenant.support_contact_enabled)}
      interactive
      botTyping={botTyping}
      onQuestionSelect={responderAuto}
      onFormChange={setFormulario}
      onSubmit={handleFormulario}
    />
  )
}
