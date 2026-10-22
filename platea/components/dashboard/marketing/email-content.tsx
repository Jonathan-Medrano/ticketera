"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  Plus,
  Mail,
  Send,
  Pencil,
  Trash2,
  BarChart2,
  Settings,
  Zap,
  Clock,
  AlertTriangle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useLoading } from "@/components/loading-provider"
import SegmentSelector from "@/components/dashboard/marketing/segment-selector"
import { ImageUploadInput } from "@/components/dashboard/image-upload-input"
import { formatDate } from "@/lib/format"
import { puedeHacer, type Permisos } from "@/lib/permisos"

interface Campana {
  id: number
  nombre: string
  tipo: "manual" | "automatica"
  asunto: string
  estado: "borrador" | "enviando" | "enviada" | "pausada"
  segmento_id: number | null
  evento_id: number | null
  segmento_nombre: string | null
  evento_nombre: string | null
  total_destinatarios: number
  total_enviados: number
  total_abiertos: number
  total_clicks: number
  enviada_at: string | null
  created_at: string
}

interface Evento {
  id: string
  nombre: string
}

interface Segmentos {
  automaticos: { slug: string; nombre: string; count: number }[]
  manuales: { id: number; nombre: string; count: number }[]
}

interface ConfigEmail {
  email_marketing_from: string | null
  email_marketing_from_name: string | null
  email_marketing_habilitado: boolean
  marketing_carrito_ventana_min: number
  marketing_carrito_ventana_max: number
  marketing_automatizaciones: boolean
}

interface StatsEnvio {
  pendiente: number
  enviado: number
  abierto: number
  clicked: number
  bounced: number
  spam: number
}

interface Props {
  campanas: Campana[]
  eventos: Evento[]
  segmentos: Segmentos
  configEmail: ConfigEmail
  permisos?: Permisos
  esEmpleado?: boolean
}

// Contenido estructurado de la plantilla (mismos campos que el renderer del backend).
type MarketingEmailContent = {
  titulo: string | null
  parrafos: string[]
  imagen_url: string | null
  boton: { texto: string; url: string } | null
}

type FormState = {
  nombre: string
  asunto: string
  segmento_id: string
  evento_id: string
  // Campos estructurados del editor (no HTML):
  titulo: string
  cuerpo: string // un párrafo por bloque separado por línea en blanco
  imagen_url: string
  boton_texto: string
  boton_url: string
}

function emptyForm(): FormState {
  return {
    nombre: "",
    asunto: "",
    segmento_id: "",
    evento_id: "",
    titulo: "",
    cuerpo: "",
    imagen_url: "",
    boton_texto: "",
    boton_url: "",
  }
}

function campanaToForm(c: Campana): FormState {
  return {
    ...emptyForm(),
    nombre: c.nombre,
    asunto: c.asunto,
    segmento_id: c.segmento_id != null ? String(c.segmento_id) : "",
    evento_id: c.evento_id != null ? String(c.evento_id) : "",
  }
}

// cuerpo (textarea) → array de párrafos: cada bloque separado por una línea en blanco.
function cuerpoToParrafos(cuerpo: string): string[] {
  return cuerpo
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
}

function escHtmlPreview(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

// Preview client-side de la plantilla TICKETERA — espeja renderMarketingEmailHtml del
// backend. {{nombre}} se muestra con un valor de ejemplo.
function buildPreviewHtml(form: FormState): string {
  const withNombre = (t: string) => escHtmlPreview(t).replace(/\{\{nombre\}\}/g, "Nombre")
  const parts: string[] = []
  if (form.titulo.trim()) {
    parts.push(`<h1 style="font-size:22px;line-height:1.3;margin:0 0 16px;color:#111827">${withNombre(form.titulo.trim())}</h1>`)
  }
  if (form.imagen_url.trim()) {
    parts.push(`<img src="${escHtmlPreview(form.imagen_url.trim())}" alt="" style="display:block;width:100%;max-width:480px;height:auto;border-radius:12px;margin:0 0 16px" />`)
  }
  for (const p of cuerpoToParrafos(form.cuerpo)) {
    parts.push(`<p style="font-size:15px;line-height:1.6;margin:0 0 14px;color:#333">${withNombre(p).replace(/\n/g, "<br />")}</p>`)
  }
  if (form.boton_texto.trim()) {
    const url = form.boton_url.trim() || "#"
    parts.push(`<div style="margin:24px 0 8px"><a href="${escHtmlPreview(url)}" style="display:inline-block;background:#111827;color:#fff;text-decoration:none;padding:12px 20px;border-radius:999px;font-weight:600;font-size:15px">${escHtmlPreview(form.boton_texto.trim())}</a></div>`)
  }
  if (parts.length === 0) {
    return '<p style="color:#999;padding:16px;font-family:sans-serif">Completá el título o el texto para ver la vista previa</p>'
  }
  return `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:8px">${parts.join("")}</div>`
}

const ESTADO_BADGE: Record<string, { label: string; className: string }> = {
  borrador: { label: "Borrador", className: "bg-muted text-muted-foreground border-border" },
  enviando: { label: "Enviando", className: "bg-primary/10 text-primary border-primary/25" },
  enviada: { label: "Enviada", className: "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border-green-200" },
  pausada: { label: "Pausada", className: "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-200" },
}

const TIPO_BADGE: Record<string, { label: string; className: string }> = {
  manual: { label: "Manual", className: "bg-primary/10 text-primary border-primary/20" },
  automatica: { label: "Automática", className: "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 border-purple-200" },
}

function formatFecha(fecha: string | null) {
  return formatDate(fecha)
}

// El backend resuelve destinatarios con esta misma precedencia (segmento > evento > todos)
// al momento del envío — reflejamos el alcance real acá para que se confirme "a quién" antes de enviar.
function campanaScopeLabel(c: Campana | null): string {
  if (!c) return "todos los compradores"
  if (c.segmento_nombre) return `el segmento "${c.segmento_nombre}"`
  if (c.evento_nombre) return `los compradores de "${c.evento_nombre}"`
  return "todos los compradores"
}

export default function EmailMarketingContent({ campanas, eventos, segmentos, configEmail, permisos, esEmpleado }: Props) {
  const router = useRouter()
  const { withLoading } = useLoading()
  const puede = (permiso: keyof Permisos) => puedeHacer(permiso, esEmpleado ?? false, permisos)

  // Modal campaña
  const [modalOpen, setModalOpen] = useState(false)
  const [editando, setEditando] = useState<Campana | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm())

  // Modal stats
  const [statsOpen, setStatsOpen] = useState(false)
  const [statsData, setStatsData] = useState<StatsEnvio | null>(null)
  const [statsNombre, setStatsNombre] = useState("")
  const [statsError, setStatsError] = useState(false)

  // Modal confirmar envío
  const [confirmEnvioOpen, setConfirmEnvioOpen] = useState(false)
  const [campanaParaEnviar, setCampanaParaEnviar] = useState<Campana | null>(null)

  // Modal confirmar eliminación (reemplaza eliminación directa sin confirmación)
  const [campanaParaEliminar, setCampanaParaEliminar] = useState<Campana | null>(null)

  // Preview del contenido HTML
  const [vistaPreview, setVistaPreview] = useState(false)

  // Test send
  const [testEmail, setTestEmail] = useState('')
  const [enviandoTest, setEnviandoTest] = useState(false)

  // Configuración email
  const [configForm, setConfigForm] = useState({
    email_marketing_from: configEmail.email_marketing_from ?? "",
    email_marketing_from_name: configEmail.email_marketing_from_name ?? "",
    email_marketing_habilitado: configEmail.email_marketing_habilitado,
    marketing_carrito_ventana_min: configEmail.marketing_carrito_ventana_min,
    marketing_carrito_ventana_max: configEmail.marketing_carrito_ventana_max,
    marketing_automatizaciones: configEmail.marketing_automatizaciones,
  })

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function abrirCrear() {
    setEditando(null)
    setForm(emptyForm())
    setModalOpen(true)
  }

  async function abrirEditar(c: Campana) {
    // Cargar el contenido estructurado del detalle para repoblar el editor.
    try {
      const res = await fetch(`/api/marketing/campanas/${c.id}`)
      const data = await res.json()
      if (!res.ok || !data.data) {
        toast.error(data.error ?? "Error al cargar la campaña")
        return
      }
      const detalle = data.data as Campana & { contenido: MarketingEmailContent | null }
      const contenido = detalle.contenido
      if (!contenido) {
        // Campaña legacy (HTML crudo): empezamos con la plantilla vacía y avisamos.
        toast.message("Esta campaña usaba el formato anterior. Completá los campos para convertirla a la nueva plantilla.")
      }
      setEditando(c)
      setForm({
        ...campanaToForm(c),
        titulo: contenido?.titulo ?? "",
        cuerpo: (contenido?.parrafos ?? []).join("\n\n"),
        imagen_url: contenido?.imagen_url ?? "",
        boton_texto: contenido?.boton?.texto ?? "",
        boton_url: contenido?.boton?.url ?? "",
      })
      setModalOpen(true)
    } catch {
      toast.error("Error al cargar la campaña")
    }
  }

  function cerrarModal() {
    setModalOpen(false)
    setEditando(null)
    setForm(emptyForm())
    setVistaPreview(false)
    setTestEmail('')
    setEnviandoTest(false)
  }

  async function handleGuardar(e: React.FormEvent) {
    e.preventDefault()

    if (!form.nombre.trim()) { toast.error("El nombre es requerido"); return }
    if (!form.asunto.trim()) { toast.error("El asunto es requerido"); return }

    const parrafos = cuerpoToParrafos(form.cuerpo)
    if (!form.titulo.trim() && parrafos.length === 0) {
      toast.error("El email necesita al menos un título o un texto")
      return
    }
    if (form.boton_texto.trim() && !form.boton_url.trim()) {
      toast.error("El botón necesita un link")
      return
    }
    if (form.boton_url.trim() && !/^https?:\/\//i.test(form.boton_url.trim())) {
      toast.error("El link del botón debe empezar con http:// o https://")
      return
    }

    const contenido: MarketingEmailContent = {
      titulo: form.titulo.trim() || null,
      parrafos,
      imagen_url: form.imagen_url.trim() || null,
      boton: form.boton_texto.trim()
        ? { texto: form.boton_texto.trim(), url: form.boton_url.trim() }
        : null,
    }

    const body = {
      nombre: form.nombre.trim(),
      asunto: form.asunto.trim(),
      contenido,
      segmento_id: form.segmento_id && !isNaN(Number(form.segmento_id)) ? Number(form.segmento_id) : null,
      evento_id: form.evento_id ? Number(form.evento_id) : null,
    }

    await withLoading(async () => {
      const url = editando ? `/api/marketing/campanas/${editando.id}` : "/api/marketing/campanas"
      const method = editando ? "PUT" : "POST"
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? "Error al guardar la campaña")
        return
      }
      toast.success(editando ? "Campaña actualizada" : "Campaña creada")
      cerrarModal()
      router.refresh()
    })
  }

  async function handleEliminar() {
    if (!campanaParaEliminar) return
    const c = campanaParaEliminar
    setCampanaParaEliminar(null)

    await withLoading(async () => {
      const res = await fetch(`/api/marketing/campanas/${c.id}`, { method: "DELETE" })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? "Error al eliminar la campaña")
        return
      }
      toast.success("Campaña eliminada")
      router.refresh()
    })
  }

  function abrirConfirmEnvio(c: Campana) {
    setCampanaParaEnviar(c)
    setConfirmEnvioOpen(true)
  }

  async function handleEnviar() {
    if (!campanaParaEnviar) return
    setConfirmEnvioOpen(false)

    await withLoading(async () => {
      const res = await fetch(`/api/marketing/campanas/${campanaParaEnviar.id}/enviar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? "Error al enviar la campaña")
        return
      }
      // El envío es asíncrono (fire-and-forget en el backend): acá solo sabemos que se encoló,
      // no cuántos emails salieron. total_enviados no existe en esta respuesta.
      const destinatarios = typeof data.total_destinatarios === "number" ? data.total_destinatarios : null
      toast.success(
        destinatarios != null
          ? `Envío en curso: procesando para ${destinatarios} destinatario${destinatarios === 1 ? "" : "s"}`
          : "Envío en curso: la campaña se está procesando"
      )
      router.refresh()
    })
  }

  async function verStats(c: Campana) {
    setStatsNombre(c.nombre)
    setStatsData(null)
    setStatsError(false)
    setStatsOpen(true)
    try {
      const res = await fetch(`/api/marketing/campanas/${c.id}/stats`)
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? "Error al cargar estadísticas")
        setStatsError(true)
        return
      }
      if (!data.data) {
        toast.error("Error al cargar estadísticas")
        setStatsError(true)
        return
      }
      setStatsData(data.data)
    } catch {
      toast.error("Error al cargar estadísticas")
      setStatsError(true)
    }
  }

  async function handleGuardarConfig(e: React.FormEvent) {
    e.preventDefault()
    await withLoading(async () => {
      const res = await fetch("/api/marketing/email/configuracion", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email_marketing_from: configForm.email_marketing_from.trim() || null,
          email_marketing_from_name: configForm.email_marketing_from_name.trim() || null,
          email_marketing_habilitado: configForm.email_marketing_habilitado,
          marketing_carrito_ventana_min: configForm.marketing_carrito_ventana_min,
          marketing_carrito_ventana_max: configForm.marketing_carrito_ventana_max,
          marketing_automatizaciones: configForm.marketing_automatizaciones,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? "Error al guardar la configuración")
        return
      }
      toast.success("Configuración guardada")
    })
  }

  return (
    <div className="space-y-6 pb-8">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Email Marketing</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Campañas manuales y automatizaciones por email para tus compradores
          </p>
        </div>
        {puede("gestionar_campanas") && (
          <Button className="gap-2 h-10 px-6" onClick={abrirCrear}>
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Nueva campaña</span>
          </Button>
        )}
      </div>

      <Tabs defaultValue="campanas">
        <TabsList className="bg-muted/60">
          <TabsTrigger value="campanas">Campañas</TabsTrigger>
          <TabsTrigger value="automatizaciones">Automatizaciones</TabsTrigger>
          <TabsTrigger value="configuracion">Configuración</TabsTrigger>
        </TabsList>

        {/* ── Tab Campañas ── */}
        <TabsContent value="campanas" className="mt-6">
          <div className="bg-card rounded-xl border border-border overflow-hidden shadow-sm">
            {campanas.length === 0 ? (
              <div className="px-6 py-16 text-center">
                <Mail className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                <h3 className="font-semibold text-foreground mb-1">Sin campañas</h3>
                <p className="text-muted-foreground text-sm mb-4">
                  Todavía no hay campañas de email creadas
                </p>
                {puede("gestionar_campanas") && (
                  <Button className="gap-2" onClick={abrirCrear}>
                    <Plus className="h-4 w-4" /> Crear campaña
                  </Button>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-primary/15 bg-primary/10">
                      <th className="text-left px-5 py-3.5 text-[11px] font-semibold text-primary uppercase tracking-[0.16em]">Campaña</th>
                      <th className="text-left px-4 py-3.5 text-[11px] font-semibold text-primary uppercase tracking-[0.16em] hidden sm:table-cell">Tipo</th>
                      <th className="text-left px-4 py-3.5 text-[11px] font-semibold text-primary uppercase tracking-[0.16em]">Estado</th>
                      <th className="text-left px-4 py-3.5 text-[11px] font-semibold text-primary uppercase tracking-[0.16em] hidden md:table-cell">Enviados</th>
                      <th className="text-left px-4 py-3.5 text-[11px] font-semibold text-primary uppercase tracking-[0.16em] hidden lg:table-cell">Fecha</th>
                      <th className="px-5 py-3.5" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {campanas.map((c) => {
                      const estadoBadge = ESTADO_BADGE[c.estado] ?? ESTADO_BADGE.borrador
                      const tipoBadge = TIPO_BADGE[c.tipo] ?? TIPO_BADGE.manual
                      return (
                        <tr key={c.id} className="hover:bg-muted/30 transition-colors">
                          <td className="px-5 py-4">
                            <div className="flex items-center gap-3">
                              <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                                <Mail className="h-3.5 w-3.5 text-primary" />
                              </div>
                              <div className="min-w-0">
                                <p className="font-semibold text-foreground truncate">{c.nombre}</p>
                                <p className="text-xs text-muted-foreground truncate">{c.asunto}</p>
                                {(c.segmento_nombre || c.evento_nombre) && (
                                  <p className="text-xs text-muted-foreground truncate">
                                    {c.segmento_nombre ?? c.evento_nombre}
                                  </p>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-4 hidden sm:table-cell">
                            <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${tipoBadge.className}`}>
                              {tipoBadge.label}
                            </span>
                          </td>
                          <td className="px-4 py-4">
                            <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${estadoBadge.className}`}>
                              {estadoBadge.label}
                            </span>
                          </td>
                          <td className="px-4 py-4 hidden md:table-cell">
                            <span className="text-foreground font-medium">{c.total_enviados}</span>
                            <span className="text-muted-foreground">/{c.total_destinatarios}</span>
                          </td>
                          <td className="px-4 py-4 text-muted-foreground text-xs hidden lg:table-cell">
                            {c.enviada_at ? formatFecha(c.enviada_at) : formatFecha(c.created_at)}
                          </td>
                          <td className="px-5 py-4">
                            <div className="flex items-center gap-1 justify-end flex-wrap">
                              {c.estado === "enviada" && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 gap-1 px-2 text-xs"
                                  onClick={() => verStats(c)}
                                >
                                  <BarChart2 className="h-3.5 w-3.5" />
                                  Stats
                                </Button>
                              )}
                              {c.estado === "borrador" && (
                                <>
                                  {puede("enviar_campanas") && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-8 gap-1 px-2 text-xs text-primary hover:text-primary/80 hover:bg-primary/10"
                                      onClick={() => abrirConfirmEnvio(c)}
                                    >
                                      <Send className="h-3.5 w-3.5" />
                                      Enviar
                                    </Button>
                                  )}
                                  {puede("gestionar_campanas") && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-8 w-8 p-0"
                                      onClick={() => abrirEditar(c)}
                                    >
                                      <Pencil className="h-4 w-4" />
                                    </Button>
                                  )}
                                  {puede("gestionar_campanas") && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                                      onClick={() => setCampanaParaEliminar(c)}
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  )}
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── Tab Automatizaciones ── */}
        <TabsContent value="automatizaciones" className="mt-6">
          <div className="space-y-4">
            {/* Carrito abandonado */}
            <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-4">
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                    <Clock className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-semibold text-foreground">Carrito abandonado</p>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      Envía un recordatorio a compradores que dejaron un checkout sin completar.
                      La ventana de espera es configurable en la pestaña Configuración (por defecto: entre {configForm.marketing_carrito_ventana_min} y {configForm.marketing_carrito_ventana_max} min).
                    </p>
                    <p className="text-xs text-muted-foreground mt-2">
                      Se ejecuta automáticamente cada 15 minutos.
                    </p>
                  </div>
                </div>
                <label className={`flex items-center gap-2 shrink-0 ${puede("gestionar_campanas") ? "cursor-pointer" : "cursor-not-allowed opacity-60"}`}>
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-primary"
                    checked={configForm.email_marketing_habilitado}
                    disabled={!puede("gestionar_campanas")}
                    onChange={async (e) => {
                      if (!puede("gestionar_campanas")) return
                      const next = e.target.checked
                      setConfigForm((prev) => ({ ...prev, email_marketing_habilitado: next }))
                      const res = await fetch("/api/marketing/email/configuracion", {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          email_marketing_from: configForm.email_marketing_from || null,
                          email_marketing_from_name: configForm.email_marketing_from_name || null,
                          email_marketing_habilitado: next,
                          marketing_carrito_ventana_min: configForm.marketing_carrito_ventana_min,
                          marketing_carrito_ventana_max: configForm.marketing_carrito_ventana_max,
                          marketing_automatizaciones: configForm.marketing_automatizaciones,
                        }),
                      })
                      if (res.ok) {
                        toast.success(next ? "Automatización activada" : "Automatización desactivada")
                      } else {
                        toast.error("Error al guardar")
                        setConfigForm((prev) => ({ ...prev, email_marketing_habilitado: !next }))
                      }
                    }}
                  />
                  <span className="text-sm text-foreground">
                    {configForm.email_marketing_habilitado ? "Activo" : "Inactivo"}
                  </span>
                </label>
              </div>
            </div>

            {/* Próximamente */}
            {[
              { icon: Zap, nombre: "Bienvenida al comprador", desc: "Email automático cuando un comprador completa su primera compra." },
              { icon: Mail, nombre: "Recordatorio de evento", desc: "Recordatorio 24h antes del inicio del evento." },
            ].map((item) => (
              <div key={item.nombre} className="rounded-2xl border border-border bg-card/50 p-5 shadow-sm opacity-60">
                <div className="flex items-start gap-4">
                  <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center shrink-0 mt-0.5">
                    <item.icon className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-foreground">{item.nombre}</p>
                      <Badge variant="outline" className="text-xs">Próximamente</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5">{item.desc}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </TabsContent>

        {/* ── Tab Configuración ── */}
        <TabsContent value="configuracion" className="mt-6">
          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm max-w-xl">
            <div className="flex items-center gap-3 mb-5">
              <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center">
                <Settings className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="font-semibold text-foreground">Configuración de email</p>
                <p className="text-xs text-muted-foreground">
                  Los emails se envían desde el remitente verificado de TICKETERA. Acá podés personalizar a dónde llegan las respuestas y con qué nombre se muestran (opcional).
                </p>
              </div>
            </div>

            <form onSubmit={handleGuardarConfig} className="space-y-4">
            <fieldset disabled={!puede("gestionar_campanas")} className="space-y-4 disabled:opacity-60">
              {!puede("gestionar_campanas") && (
                <p className="text-xs text-muted-foreground -mt-1 mb-1">
                  No tenés permiso para editar la configuración de email marketing.
                </p>
              )}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Email para respuestas <span className="opacity-50">(opc.)</span></Label>
                <Input
                  className="h-10"
                  type="email"
                  maxLength={254}
                  placeholder="eventos@miempresa.com"
                  value={configForm.email_marketing_from}
                  onChange={(e) => setConfigForm((p) => ({ ...p, email_marketing_from: e.target.value }))}
                />
                <p className="text-xs text-muted-foreground">
                  Si un destinatario responde el email, la respuesta llega a esta casilla. Si lo dejás vacío, se usa el remitente de la plataforma.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Nombre del remitente <span className="opacity-50">(opc.)</span></Label>
                <Input
                  className="h-10"
                  maxLength={100}
                  placeholder="Mi Empresa Eventos"
                  value={configForm.email_marketing_from_name}
                  onChange={(e) => setConfigForm((p) => ({ ...p, email_marketing_from_name: e.target.value }))}
                />
              </div>

              <label className="flex items-center gap-2 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-primary"
                  checked={configForm.email_marketing_habilitado}
                  onChange={(e) => setConfigForm((p) => ({ ...p, email_marketing_habilitado: e.target.checked }))}
                />
                <span className="text-sm text-foreground">Habilitar email marketing</span>
              </label>
              <p className="text-xs text-muted-foreground -mt-2">
                Activa las automatizaciones de email (carrito abandonado y futuras).
              </p>

              <div className="border-t border-border pt-4 space-y-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Carrito abandonado</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Esperar mínimo (min)</Label>
                    <Input
                      className="h-10"
                      type="number"
                      min={15}
                      max={1440}
                      value={configForm.marketing_carrito_ventana_min}
                      onChange={(e) => setConfigForm((p) => ({ ...p, marketing_carrito_ventana_min: parseInt(e.target.value, 10) || 60 }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Esperar máximo (min)</Label>
                    <Input
                      className="h-10"
                      type="number"
                      min={15}
                      max={1440}
                      value={configForm.marketing_carrito_ventana_max}
                      onChange={(e) => setConfigForm((p) => ({ ...p, marketing_carrito_ventana_max: parseInt(e.target.value, 10) || 120 }))}
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  El email se envía si el checkout expiró hace entre {configForm.marketing_carrito_ventana_min} y {configForm.marketing_carrito_ventana_max} minutos.
                </p>
              </div>

              <Button type="submit" className="h-10 w-full mt-2">
                Guardar configuración
              </Button>
            </fieldset>
            </form>
          </div>
        </TabsContent>
      </Tabs>

      {/* ── Modal crear / editar campaña ── */}
      <Dialog open={modalOpen} onOpenChange={(v) => { if (!v) cerrarModal() }}>
        <DialogContent className="bg-card w-[calc(100vw-2rem)] sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-foreground">
              {editando ? "Editar campaña" : "Nueva campaña"}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {editando ? "Editá los datos de la campaña" : "Completá los datos de la nueva campaña de email"}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleGuardar} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Nombre de la campaña</Label>
                <Input
                  className="h-10"
                  placeholder="Ej: Newsletter Octubre"
                  value={form.nombre}
                  onChange={(e) => setField("nombre", e.target.value)}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Asunto del email</Label>
                <Input
                  className="h-10"
                  placeholder="Ej: ¡No te pierdas el evento del mes!"
                  value={form.asunto}
                  onChange={(e) => setField("asunto", e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                Segmento destinatario <span className="opacity-50">(opc.)</span>
              </Label>
              <SegmentSelector
                value={form.segmento_id}
                onChange={(v) => setForm((prev) => ({ ...prev, segmento_id: v, evento_id: "" }))}
                segmentos={segmentos}
                placeholder="Todos los compradores"
              />
              {eventos.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Elegir un segmento reemplaza el filtro por evento (y viceversa) — no se pueden combinar.
                </p>
              )}
            </div>

            {eventos.length > 0 && (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">
                  Filtrar por evento <span className="opacity-50">(opc.)</span>
                </Label>
                <Select
                  value={form.evento_id || "todos"}
                  onValueChange={(v) =>
                    setForm((prev) => ({ ...prev, evento_id: v === "todos" ? "" : v, segmento_id: "" }))
                  }
                >
                  <SelectTrigger className="h-10 bg-background">
                    <SelectValue placeholder="Todos los eventos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos los compradores</SelectItem>
                    {eventos.map((ev) => (
                      <SelectItem key={ev.id} value={String(ev.id)}>{ev.nombre}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">Contenido del email</Label>
                <div className="flex gap-1 text-xs">
                  <button
                    type="button"
                    onClick={() => setVistaPreview(false)}
                    className={`px-2 py-0.5 rounded ${!vistaPreview ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    onClick={() => setVistaPreview(true)}
                    className={`px-2 py-0.5 rounded ${vistaPreview ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    Preview
                  </button>
                </div>
              </div>

              {vistaPreview ? (
                <div className="rounded-lg border border-border overflow-hidden">
                  <div className="bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground border-b border-border">
                    Vista previa del email
                  </div>
                  <iframe
                    srcDoc={buildPreviewHtml(form)}
                    className="w-full h-72 bg-white"
                    sandbox="allow-same-origin"
                    title="Preview del email"
                  />
                </div>
              ) : (
                <div className="space-y-3 rounded-lg border border-border p-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Título <span className="opacity-50">(opc.)</span></Label>
                    <Input
                      className="h-10 bg-background"
                      placeholder="¡Vuelve el evento del año!"
                      value={form.titulo}
                      onChange={(e) => setField("titulo", e.target.value)}
                      maxLength={200}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Texto del email</Label>
                    <textarea
                      className="w-full h-40 rounded-md border border-input bg-background px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-ring"
                      placeholder={"Hola {{nombre}}, te escribimos para contarte...\n\nDejá una línea en blanco para separar párrafos."}
                      value={form.cuerpo}
                      onChange={(e) => setField("cuerpo", e.target.value)}
                      maxLength={100000}
                      rows={8}
                    />
                    <p className="text-xs text-muted-foreground">
                      Usá <code className="font-mono">{"{{nombre}}"}</code> para personalizar con el nombre de cada destinatario. Una línea en blanco = párrafo nuevo.
                    </p>
                  </div>

                  <ImageUploadInput
                    type="marketing"
                    aspect="wide"
                    value={form.imagen_url}
                    onChange={(url) => setField("imagen_url", url)}
                    label="Imagen (opc.)"
                    description="JPG, PNG, WEBP o GIF · hasta 5MB. Se sube a tu almacenamiento."
                  />

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Botón <span className="opacity-50">(opc.)</span></Label>
                      <Input
                        className="h-10 bg-background"
                        placeholder="Ver evento"
                        value={form.boton_texto}
                        onChange={(e) => setField("boton_texto", e.target.value)}
                        maxLength={60}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Link del botón</Label>
                      <Input
                        className="h-10 bg-background"
                        placeholder="https://..."
                        value={form.boton_url}
                        onChange={(e) => setField("boton_url", e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                El email se arma con la plantilla de TICKETERA (logo, estilos y pie). No necesitás escribir HTML.
              </p>
            </div>

            {editando && puede("enviar_campanas") && (
              <div className="border-t border-border pt-4">
                <p className="text-xs font-medium text-muted-foreground mb-2">Enviar prueba</p>
                <div className="flex gap-2">
                  <Input
                    type="email"
                    placeholder="tu@email.com"
                    value={testEmail}
                    onChange={e => setTestEmail(e.target.value)}
                    className="h-9 flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-9 shrink-0"
                    disabled={!testEmail || enviandoTest}
                    onClick={async () => {
                      setEnviandoTest(true)
                      try {
                        const res = await fetch(`/api/marketing/campanas/${editando.id}/test-send`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ email: testEmail }),
                        })
                        const data = await res.json()
                        if (res.ok) toast.success('Email de prueba enviado')
                        else toast.error(data.error ?? 'Error al enviar prueba')
                      } catch {
                        toast.error('Error al enviar prueba')
                      } finally {
                        setEnviandoTest(false)
                      }
                    }}
                  >
                    {enviandoTest ? 'Enviando...' : 'Enviar prueba'}
                  </Button>
                </div>
              </div>
            )}

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" className="flex-1 h-10" onClick={cerrarModal}>
                Cancelar
              </Button>
              <Button type="submit" className="flex-1 h-10">
                {editando ? "Guardar cambios" : "Guardar borrador"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Modal confirmar envío ── */}
      <Dialog open={confirmEnvioOpen} onOpenChange={setConfirmEnvioOpen}>
        <DialogContent className="bg-card max-w-md">
          <DialogHeader>
            <DialogTitle className="text-foreground">Confirmar envío</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              ¿Querés enviar la campaña <strong className="text-foreground">{campanaParaEnviar?.nombre}</strong> a{" "}
              <strong className="text-foreground">{campanaScopeLabel(campanaParaEnviar)}</strong>?
              Esta acción es irreversible: una vez enviada no se puede pausar ni deshacer.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="pt-2">
            <Button variant="outline" className="flex-1 h-10" onClick={() => setConfirmEnvioOpen(false)}>
              Cancelar
            </Button>
            <Button className="flex-1 h-10 gap-2" onClick={handleEnviar}>
              <Send className="h-4 w-4" />
              Enviar campaña
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Modal confirmar eliminación ── */}
      <Dialog open={!!campanaParaEliminar} onOpenChange={(v) => { if (!v) setCampanaParaEliminar(null) }}>
        <DialogContent className="bg-card sm:max-w-sm p-6">
          <DialogHeader>
            <DialogTitle className="text-foreground">¿Eliminar &ldquo;{campanaParaEliminar?.nombre}&rdquo;?</DialogTitle>
            <DialogDescription className="sr-only">Confirmar eliminación de campaña de email</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-start gap-3 bg-destructive/10 border border-destructive/20 rounded-xl p-4">
              <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-foreground mb-1">{campanaParaEliminar?.nombre}</p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Se eliminará permanentemente. Esta acción no se puede deshacer.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 h-10" onClick={() => setCampanaParaEliminar(null)}>
                Cancelar
              </Button>
              <Button variant="destructive" className="flex-1 h-10" onClick={handleEliminar}>
                Eliminar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Modal stats ── */}
      <Dialog open={statsOpen} onOpenChange={setStatsOpen}>
        <DialogContent className="bg-card max-w-md">
          <DialogHeader>
            <DialogTitle className="text-foreground">Estadísticas — {statsNombre}</DialogTitle>
            <DialogDescription className="sr-only">
              Estadísticas de envío de la campaña
            </DialogDescription>
          </DialogHeader>
          {statsError ? (
            <div className="py-8 text-center text-sm text-destructive">
              No se pudieron cargar las estadísticas. Intentá de nuevo.
            </div>
          ) : !statsData ? (
            <div className="py-8 text-center text-muted-foreground text-sm">Cargando...</div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 py-2">
              {[
                { label: "Enviados", value: statsData.enviado, color: "text-green-600" },
                { label: "Abiertos", value: statsData.abierto, color: "text-primary" },
                { label: "Clicks", value: statsData.clicked, color: "text-primary" },
                { label: "Pendientes", value: statsData.pendiente, color: "text-muted-foreground" },
                { label: "Bounced", value: statsData.bounced, color: "text-amber-600" },
                { label: "Spam", value: statsData.spam, color: "text-destructive" },
              ].map((stat) => (
                <div key={stat.label} className="rounded-lg border border-border bg-muted/30 p-3 text-center">
                  <p className={`text-2xl font-bold ${stat.color}`}>{stat.value}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{stat.label}</p>
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" className="w-full h-10" onClick={() => setStatsOpen(false)}>
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
