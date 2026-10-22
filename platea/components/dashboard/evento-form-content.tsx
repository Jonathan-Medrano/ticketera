"use client"

import { useEffect, useMemo, useRef, useState, type ElementType, type FormEvent } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { useLoading } from "@/components/loading-provider"
import { Button } from "@/components/ui/button"
import { IconAction } from "@/components/ui/icon-action"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ImageUploadInput } from "@/components/dashboard/image-upload-input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { formatDateTime, formatInt, formatMoney } from "@/lib/format"
import {
  AlertCircle,
  ArrowLeft,
  ChevronRight,
  BarChart2,
  CalendarDays,
  Check,
  ChevronDown,
  ImageIcon,
  Info,
  Plus,
  RotateCcw,
  Save,
  ShoppingBag,
  Ticket,
  Trash2,
} from "lucide-react"
import {
  attemptAdvanceEventoFormStep,
  EVENTO_FORM_STEPS,
  type EventoPrePublishVisibility,
  type EventoPublicationDraft,
  getEventoPublicationTimingCopy,
  getNextEventoFormStep,
  getPreviousEventoFormStep,
  isFinalEventoFormStep,
  shouldShowEventoFormSubmit,
  type EventoFormCategoriaDraft as Categoria,
  type EventoFormCoreState,
  type EventoFormFechaDraft as Fecha,
  type EventoFormStep,
  type EventoFormTandaDraft as Tanda,
  type EventoFormValidationPayload,
  type EventoFormValidationResult,
  type EventoPublicationTiming,
  validateEventoFormStep,
} from "./evento-form-navigation"

type EventoModo = "crear" | "editar"
type EventoBackendModoFecha = "unica" | "multiple" | "pase"

type EventoEditable = {
  id: string
  nombre: string
  descripcion?: string | null
  lugar?: string | null
  ciudad?: string | null
  modo_fecha: EventoBackendModoFecha
  imagen_url?: string | null
  tipo_mapa?: string | null
  venta_consumibles_habilitada?: number | boolean
  buyer_event_refunds_enabled?: number | boolean
  publication?: {
    mode: EventoPublicationTiming
    pre_publish_visibility: EventoPrePublishVisibility
    publish_at_utc: string | null
    publish_timezone: string | null
    publish_date_local?: string
    publish_time_local?: string
  }
  publication_status?: "hidden" | "listed" | "live"
}

type EventoFechaEditable = {
  id: string
  fecha: string
}

type EventoCategoriaEditable = {
  id: string
  nombre: string
  descripcion?: string | null
  imagen_url?: string | null
  precio: number
  stock: number
  tanda_id?: string | null
  entradas_por_unidad?: number
}

type EventoTandaEditable = {
  id: string
  nombre: string
  descripcion?: string | null
  imagen_url?: string | null
  estado: "activa" | "proxima" | "inactiva" | "agotada"
  orden: number
  activa_desde?: string | null
}

type Props = {
  modo: EventoModo
  evento?: EventoEditable
  tandasIniciales?: EventoTandaEditable[]
  categoriasIniciales?: EventoCategoriaEditable[]
  fechasIniciales?: EventoFechaEditable[]
  initialStep?: EventoFormStep
  returnHref?: string
}

export function getBuyerRefundToggleDescription(enabled: boolean) {
  return enabled
    ? "Este evento puede recibir solicitudes de reembolso de comprador si la empresa también activó la política general."
    : "Este evento no va a mostrar CTA de reembolso aunque la empresa tenga la política general activa."
}

export function normalizeEventoFormModoFecha(value?: EventoBackendModoFecha | null): EventoFormCoreState["modo_fecha"] {
  return value === "multiple" ? "multiple" : "unica"
}

export function buildInitialPublicationState(evento?: EventoEditable): EventoPublicationDraft {
  return {
    publication_timing: evento?.publication?.mode ?? "immediate",
    pre_publish_visibility: evento?.publication?.pre_publish_visibility ?? "hidden",
    publish_date_local: evento?.publication?.publish_date_local ?? "",
    publish_time_local: evento?.publication?.publish_time_local ?? "",
    publish_timezone: evento?.publication?.publish_timezone ?? "America/Argentina/Buenos_Aires",
  }
}

function SectionHeader({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: ElementType
  title: string
  subtitle?: string
}) {
  return (
    <div className="mb-5 flex items-start gap-3 border-b border-border pb-4">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <div>
        <p className="text-sm font-semibold text-foreground">{title}</p>
        {subtitle ? <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p> : null}
      </div>
    </div>
  )
}

// Estilo compartido para inputs inválidos: borde + anillo destructive (tokenizado).
const INVALID_FIELD_CLASS = "border-destructive focus-visible:border-destructive focus-visible:ring-destructive/30"

// Mensaje de error inline para un campo puntual del form.
function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return (
    <p className="flex items-start gap-1.5 text-xs font-medium text-destructive">
      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{message}</span>
    </p>
  )
}

function StepValidationAlert({ validation }: { validation?: EventoFormValidationResult }) {
  if (!validation || validation.valid || validation.errors.length === 0) return null

  return (
    <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
      <p className="flex items-center gap-2 font-semibold">
        <AlertCircle className="h-4 w-4 shrink-0" />
        Antes de continuar, corregí esto:
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        {validation.errors.map((error) => (
          <li key={error}>{error}</li>
        ))}
      </ul>
    </div>
  )
}

function buildInitialForm(evento?: EventoEditable): EventoFormCoreState {
  return {
    nombre: evento?.nombre ?? "",
    descripcion: evento?.descripcion ?? "",
    lugar: evento?.lugar ?? "",
    ciudad: evento?.ciudad ?? "",
    modo_fecha: normalizeEventoFormModoFecha(evento?.modo_fecha),
    imagen_url: evento?.imagen_url ?? "",
    venta_consumibles_habilitada: evento?.venta_consumibles_habilitada == null ? false : Boolean(evento.venta_consumibles_habilitada),
    buyer_event_refunds_enabled: evento?.buyer_event_refunds_enabled == null ? true : Boolean(evento.buyer_event_refunds_enabled),
    tipo_mapa: (evento?.tipo_mapa === "numerado" ? "numerado" : "libre") as "libre" | "numerado",
  }
}

// Argentina never observes DST; this converts a UTC instant to the AR datetime-local string.
function utcToArDatetimeLocal(iso: string): string {
  const d = new Date(iso)
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d)
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "00"
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`
}

function buildInitialFechas(modo: EventoModo, fechasIniciales?: EventoFechaEditable[]): Fecha[] {
  if (modo === "editar" && fechasIniciales && fechasIniciales.length > 0) {
    return fechasIniciales.map((f) => ({
      id: String(f.id),
      fecha: utcToArDatetimeLocal(f.fecha),
    }))
  }

  return [{ id: "1", fecha: "" }]
}

function buildInitialCategorias(modo: EventoModo, categoriasIniciales?: EventoCategoriaEditable[]): Categoria[] {
  if (modo === "editar" && categoriasIniciales && categoriasIniciales.length > 0) {
    return categoriasIniciales.map((c) => ({
      id: String(c.id),
      nombre: c.nombre ?? "",
      descripcion: c.descripcion ?? "",
      imagen_url: c.imagen_url ?? "",
      precio: c.precio?.toString() ?? "",
      stock: c.stock?.toString() ?? "",
      tanda_id: c.tanda_id ? String(c.tanda_id) : "",
      entradas_por_unidad: c.entradas_por_unidad ? String(c.entradas_por_unidad) : "1",
    }))
  }

  return [{ id: "1", nombre: "General", descripcion: "", imagen_url: "", precio: "", stock: "", tanda_id: "", entradas_por_unidad: "1" }]
}

function buildInitialTandas(modo: EventoModo, tandasIniciales?: EventoTandaEditable[]): Tanda[] {
  if (modo === "editar" && tandasIniciales && tandasIniciales.length > 0) {
    return tandasIniciales.map((tanda) => ({
      id: String(tanda.id),
      nombre: tanda.nombre ?? "",
      descripcion: tanda.descripcion ?? "",
      imagen_url: tanda.imagen_url ?? "",
      estado: tanda.estado ?? "inactiva",
      activa_desde: tanda.activa_desde ? utcToArDatetimeLocal(tanda.activa_desde) : "",
    }))
  }

  return []
}

// Heurística best-effort (no exhaustiva) para volver al step probable cuando el backend
// rechaza el submit final. Basada en palabras clave del mensaje de error — frágil por
// naturaleza, así que solo se usa como ayuda de navegación; el mensaje real del servidor
// siempre se muestra igual, matchee o no. Si el backend cambia su copy, esto deja de
// acertar pero no rompe nada (el usuario ve el error igual, solo no salta de step).
function guessEventoFormStepFromServerError(message: string): EventoFormStep | null {
  const normalized = message.toLowerCase()
  if (normalized.includes("public")) return "publicacion"
  if (normalized.includes("precio") || normalized.includes("stock") || normalized.includes("categor") || normalized.includes("tanda")) return "venta"
  if (normalized.includes("fecha") || normalized.includes("función") || normalized.includes("funcion") || normalized.includes("agenda")) return "agenda"
  if (normalized.includes("nombre") || normalized.includes("lugar") || normalized.includes("modo de fecha")) return "info"
  return null
}

function capitalizeLabel(value: string) {
  if (!value) return value
  return value.charAt(0).toUpperCase() + value.slice(1)
}

// Mismo set de tokens que tandaEstadoConfig en evento-detalle-content para que
// el badge de estado de tanda se vea idéntico en el form y en el detalle.
function getTandaEstadoBadgeClass(estado: Tanda["estado"]) {
  switch (estado) {
    case "activa":
      return "border-success/30 bg-success/10 text-success"
    case "proxima":
      return "border-primary/30 bg-primary/10 text-primary"
    case "inactiva":
      return "border-border bg-muted text-muted-foreground"
    case "agotada":
      return "border-destructive/30 bg-destructive/10 text-destructive"
    default:
      return "border-border bg-card text-muted-foreground"
  }
}

// Item pendiente de confirmación de borrado (fecha/categoría/tanda) — el ícono de tacho
// nunca ejecuta la eliminación directamente, solo abre el Dialog de confirmación.
type PendingDelete =
  | { type: "fecha"; id: string; label: string }
  | { type: "categoria"; id: string; label: string }
  | { type: "tanda"; id: string; label: string; categoriasAsociadas: number }

function buildValidationPayload(
  form: EventoFormCoreState,
  fechas: Fecha[],
  categorias: Categoria[],
  tandas: Tanda[],
  usarTandas: boolean,
  publication: EventoPublicationDraft
): EventoFormValidationPayload {
  return {
    form,
    fechas,
    categorias,
    tandas,
    usarTandas,
    publication,
  }
}

export default function EventoFormContent({
  modo,
  evento,
  tandasIniciales = [],
  categoriasIniciales = [],
  fechasIniciales = [],
  initialStep = "info",
  returnHref,
}: Props) {
  const router = useRouter()
  const { withLoading } = useLoading()
  const [loading, setLoading] = useState(false)
  const [activeStep, setActiveStep] = useState<EventoFormStep>(initialStep)
  const [stepValidations, setStepValidations] = useState<Partial<Record<EventoFormStep, EventoFormValidationResult>>>({})
  // Phantom-click guard: clicking "Continuar" en step N hace que el botón se reemplace
  // por "Crear evento" (type=submit) en el mismo lugar del DOM. Algunos navegadores
  // retargetean el mouseup al botón nuevo, disparando el submit del form sin que el
  // usuario realmente clickee "Crear evento". Este flag bloquea handleSubmit por unos ms.
  const justAdvancedRef = useRef(false)
  // Double-submit guard: previene que un segundo click dispare el fetch si el primero
  // aún está en vuelo. Se resetea en el finally del bloque de submit.
  const submittingRef = useRef(false)

  const [form, setForm] = useState<EventoFormCoreState>(() => buildInitialForm(evento))
  const [fechas, setFechas] = useState<Fecha[]>(() => buildInitialFechas(modo, fechasIniciales))
  const [categorias, setCategorias] = useState<Categoria[]>(() => buildInitialCategorias(modo, categoriasIniciales))
  const [tandas, setTandas] = useState<Tanda[]>(() => buildInitialTandas(modo, tandasIniciales))
  const [publication, setPublication] = useState<EventoPublicationDraft>(() => buildInitialPublicationState(evento))
  const [usarTandas, setUsarTandas] = useState(tandasIniciales.length > 0)
  const [tandasAbiertasIds, setTandasAbiertasIds] = useState<string[]>(
    tandasIniciales[0]?.id ? [tandasIniciales[0].id] : []
  )

  const [isDirty, setIsDirty] = useState(false)
  const [showCancelDialog, setShowCancelDialog] = useState(false)
  // Destino real de la navegación pendiente cuando se intercepta un link/breadcrumb con
  // cambios sin guardar — el diálogo de "Salir sin guardar" navega acá en vez de siempre
  // ir a cancelHref (ver requestNavigation).
  const [pendingNavHref, setPendingNavHref] = useState<string | null>(null)
  // Fecha/categoría/tanda que el usuario pidió borrar — dispara el Dialog de confirmación
  // compartido en vez de eliminar al primer click.
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null)
  // Ancla para hacer scroll hasta el alert de validación cuando un step (el activo o uno
  // intermedio saltado por jumpToStep/submit) queda marcado como inválido.
  const validationAlertRef = useRef<HTMLDivElement | null>(null)

  const isEdit = modo === "editar"
  // M-3: detect events with modo_fecha="pase" — not editable via this form
  const isPase = isEdit && evento?.modo_fecha === "pase"
  const cancelHref = returnHref ?? "/dashboard/eventos"
  const activeValidation = stepValidations[activeStep]
  const publicationCopy = getEventoPublicationTimingCopy(modo)
  const publicationTiming = publication.publication_timing

  const activeStepIndex = useMemo(
    () => EVENTO_FORM_STEPS.findIndex((step) => step.id === activeStep),
    [activeStep]
  )

  // Estado visual del stepper: un paso anterior al activo se marca "completado" si
  // valida OK. Solo informativo para la UI — NO altera la lógica de navegación.
  const stepStatuses = useMemo(() => {
    const payload = buildValidationPayload(form, fechas, categorias, tandas, usarTandas, publication)
    return EVENTO_FORM_STEPS.map((step, index) => {
      if (step.id === activeStep) return "active" as const
      if (index < activeStepIndex && validateEventoFormStep(step.id, payload).valid) return "complete" as const
      return "pending" as const
    })
  }, [form, fechas, categorias, tandas, usarTandas, publication, activeStep, activeStepIndex])

  const totalStock = useMemo(() => categorias.reduce((acc, c) => acc + (Number(c.stock) || 0), 0), [categorias])
  const totalMin = useMemo(
    () =>
      categorias.reduce<number | null>((acc, c) => {
        // Skip categories with no price defined yet (empty input or NaN), but a price of
        // 0 (free — supported explicitly by the form) is a valid, real minimum.
        if (c.precio === "" || Number.isNaN(Number(c.precio))) return acc
        const precio = Number(c.precio)
        return acc === null ? precio : Math.min(acc, precio)
      }, null),
    [categorias]
  )
  const totalMax = useMemo(
    () =>
      categorias.reduce<number | null>((acc, c) => {
        if (c.precio === "" || Number.isNaN(Number(c.precio))) return acc
        const precio = Number(c.precio)
        return acc === null ? precio : Math.max(acc, precio)
      }, null),
    [categorias]
  )

  function clearStepValidation(step: EventoFormStep) {
    setStepValidations((current) => {
      const next = { ...current }
      delete next[step]
      return next
    })
  }

  function markDirty() {
    setIsDirty(true)
  }

  // Navegación guardada: si hay cambios sin guardar, abre el mismo diálogo de confirmación
  // que usa "Cancelar" en vez de navegar directo — apuntando el destino real a `href`.
  // Usado por el breadcrumb, el link al evento y el botón "Volver" para no bypasear el guard.
  function requestNavigation(href: string) {
    if (isDirty) {
      setPendingNavHref(href)
      setShowCancelDialog(true)
    } else {
      router.push(href)
    }
  }

  // M-4: warn on browser close/tab navigation when there are unsaved changes
  useEffect(() => {
    if (!isDirty) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ""
    }
    window.addEventListener("beforeunload", handler)
    return () => window.removeEventListener("beforeunload", handler)
  }, [isDirty])

  // Scroll-to-error: cuando el step activo queda con una validación inválida (por
  // "Continuar", por un salto de jumpToStep bloqueado en un step intermedio, o por el
  // submit final), llevamos la vista hasta el alert de errores para que el usuario no
  // tenga que adivinar dónde está el problema si scrolleó lejos.
  useEffect(() => {
    if (activeValidation && !activeValidation.valid) {
      validationAlertRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    }
  }, [activeValidation])

  function currentPayload() {
    return buildValidationPayload(form, fechas, categorias, tandas, usarTandas, publication)
  }

  function setValidationForStep(step: EventoFormStep, validation: EventoFormValidationResult) {
    setStepValidations((current) => ({ ...current, [step]: validation }))
  }

  function jumpToStep(step: EventoFormStep) {
    const ORDERED_STEPS: EventoFormStep[] = ["info", "agenda", "venta", "publicacion"]
    const currentIdx = ORDERED_STEPS.indexOf(activeStep)
    const targetIdx = ORDERED_STEPS.indexOf(step)

    if (targetIdx > currentIdx) {
      const payload = currentPayload()
      // Saltar hacia adelante exige que el step actual Y todos los intermedios sean
      // válidos (mismo criterio que el loop de submit final) — si no, se bloquea el
      // salto en el primer step inválido en vez de dejar pasos sin completar atrás.
      for (let i = currentIdx; i < targetIdx; i++) {
        const stepToCheck = ORDERED_STEPS[i]
        const errors = validateEventoFormStep(stepToCheck, payload)
        if (!errors.valid) {
          setValidationForStep(stepToCheck, errors)
          setActiveStep(stepToCheck)
          return
        }
      }
    }

    clearStepValidation(step)
    setActiveStep(step)
  }

  function agregarFecha() {
    markDirty()
    setFechas([...fechas, { id: Date.now().toString(), fecha: "" }])
  }

  function eliminarFecha(id: string) {
    if (fechas.length === 1) return
    markDirty()
    setFechas(fechas.filter((f) => f.id !== id))
  }

  function actualizarFecha(id: string, valor: string) {
    markDirty()
    clearStepValidation("agenda")
    setFechas(fechas.map((f) => (f.id === id ? { ...f, fecha: valor } : f)))
  }

  function agregarCategoria() {
    markDirty()
    clearStepValidation("venta")
    setCategorias([
      ...categorias,
      { id: Date.now().toString(), nombre: "", descripcion: "", imagen_url: "", precio: "", stock: "", tanda_id: "", entradas_por_unidad: "1" },
    ])
  }

  function eliminarCategoria(id: string) {
    if (categorias.length === 1) return
    markDirty()
    clearStepValidation("venta")
    setCategorias(categorias.filter((c) => c.id !== id))
  }

  function actualizarCategoria(id: string, campo: keyof Categoria, valor: string) {
    markDirty()
    clearStepValidation("venta")
    setCategorias(categorias.map((c) => (c.id === id ? { ...c, [campo]: valor } : c)))
  }

  function agregarTanda() {
    markDirty()
    clearStepValidation("venta")
    const nuevaTanda: Tanda = {
      id: `temp-${Date.now()}`,
      nombre: "",
      descripcion: "",
      imagen_url: "",
      estado: tandas.length === 0 ? "activa" : "proxima",
      activa_desde: "",
    }

    setTandas([...tandas, nuevaTanda])
    setTandasAbiertasIds((prev) => [...prev, nuevaTanda.id])
  }

  function actualizarTanda(id: string, campo: keyof Tanda, valor: string) {
    markDirty()
    clearStepValidation("venta")
    setTandas(tandas.map((t) => (t.id === id ? { ...t, [campo]: valor } : t)))
  }

  function cambiarEstadoTanda(id: string, estado: Tanda["estado"]) {
    markDirty()
    clearStepValidation("venta")

    if (estado === "activa") {
      // Solo puede haber una tanda activa a la vez: la que ya estaba activa pasa a
      // "Próxima" en silencio salvo que avisemos acá.
      const afectadas = tandas.filter((tanda) => tanda.id !== id && tanda.estado === "activa")
      afectadas.forEach((tanda) => {
        toast.info(`"${tanda.nombre.trim() || "Tanda sin nombre"}" pasó a Próxima`)
      })
    }

    setTandas((prev) =>
      prev.map((tanda) => {
        if (estado === "activa") {
          if (tanda.id === id) return { ...tanda, estado: "activa" }
          if (tanda.estado === "agotada") return tanda
          return { ...tanda, estado: "proxima" }
        }

        if (tanda.id !== id) return tanda
        return { ...tanda, estado }
      })
    )
  }

  function toggleTandaAbierta(id: string) {
    setTandasAbiertasIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]))
  }

  function expandirTodasLasTandas() {
    setTandasAbiertasIds(tandas.map((tanda) => tanda.id))
  }

  function colapsarTodasLasTandas() {
    setTandasAbiertasIds([])
  }

  function eliminarTanda(id: string) {
    markDirty()
    clearStepValidation("venta")
    const tandasRestantes = tandas.filter((tanda) => tanda.id !== id)
    setTandas(tandasRestantes)
    setTandasAbiertasIds((prev) => prev.filter((item) => item !== id))
    setCategorias((prev) => prev.map((categoria) => (categoria.tanda_id === id ? { ...categoria, tanda_id: "" } : categoria)))
  }

  // Ejecuta la eliminación real una vez confirmada en el Dialog — nunca se llama
  // directamente desde el ícono de tacho.
  function confirmPendingDelete() {
    if (!pendingDelete) return
    if (pendingDelete.type === "fecha") eliminarFecha(pendingDelete.id)
    else if (pendingDelete.type === "categoria") eliminarCategoria(pendingDelete.id)
    else if (pendingDelete.type === "tanda") eliminarTanda(pendingDelete.id)
    setPendingDelete(null)
  }

  function handleContinue() {
    const attempt = attemptAdvanceEventoFormStep(activeStep, currentPayload())
    if (!attempt.advanced || !attempt.nextStep) {
      setValidationForStep(activeStep, attempt.validation)
      return
    }

    justAdvancedRef.current = true
    setTimeout(() => { justAdvancedRef.current = false }, 300)
    clearStepValidation(activeStep)
    setActiveStep(attempt.nextStep)
  }

  function handleBack() {
    const previous = getPreviousEventoFormStep(activeStep)
    if (!previous) return
    setActiveStep(previous)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()

    if (justAdvancedRef.current) {
      return
    }

    const finalValidation = validateEventoFormStep(activeStep, currentPayload())
    if (!finalValidation.valid) {
      setValidationForStep(activeStep, finalValidation)
      return
    }

    if (!isFinalEventoFormStep(activeStep)) {
      const nextStep = getNextEventoFormStep(activeStep)
      if (nextStep) {
        clearStepValidation(activeStep)
        setActiveStep(nextStep)
      }
      return
    }

    const ORDERED_STEPS: EventoFormStep[] = ["info", "agenda", "venta", "publicacion"]
    for (const step of ORDERED_STEPS) {
      const stepErrors = validateEventoFormStep(step, currentPayload())
      if (!stepErrors.valid) {
        setActiveStep(step)
        setValidationForStep(step, stepErrors)
        toast.error("Completá todos los campos requeridos antes de continuar")
        return
      }
    }

    if (submittingRef.current) return
    submittingRef.current = true

    await withLoading(async () => {
      setLoading(true)

      try {
        const url = isEdit ? `/api/eventos/${evento?.id}` : "/api/eventos"
        const method = isEdit ? "PATCH" : "POST"

        const res = await fetch(url, {
          method,
          headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...form,
              publication_mode: publication.publication_timing,
              pre_publish_visibility: publication.pre_publish_visibility,
              publish_date_local: publication.publication_timing === "scheduled" ? publication.publish_date_local : null,
              publish_time_local: publication.publication_timing === "scheduled" ? publication.publish_time_local : null,
              publish_timezone: publication.publication_timing === "scheduled" ? publication.publish_timezone : null,
              fechas,
              categorias: categorias.map((categoria) => ({
                ...categoria,
              tanda_id: usarTandas ? categoria.tanda_id || null : null,
            })),
            tandas: usarTandas
              ? tandas.map((tanda, index) => ({
                  id: tanda.id.startsWith("temp-") ? undefined : tanda.id,
                  temp_id: tanda.id,
                  nombre: tanda.nombre,
                  descripcion: tanda.descripcion || null,
                  imagen_url: tanda.imagen_url || null,
                  estado: tanda.estado,
                  orden: index,
                  activa_desde: tanda.activa_desde || null,
                }))
              : [],
          }),
        })

        let data: { error?: string; id?: string } | null = null
        try {
          data = await res.json()
        } catch {
          data = null
        }

        if (!res.ok) {
          // El backend puede rechazar en el submit final por validaciones que el wizard no
          // corrió (o corrió con datos que cambiaron server-side entretanto). Mostramos el
          // mensaje real del servidor cuando viene (es más específico que un genérico), y
          // usamos una heurística simple por palabras clave para volver al step relevante
          // — no hay forma confiable de mapear 1:1 sin acoplarse al texto exacto del backend,
          // así que si ninguna keyword matchea, el usuario se queda en "Publicación" (el
          // último step) con el mensaje real visible.
          const serverMessage = data?.error
          toast.error(serverMessage ?? (isEdit ? "Error al guardar los cambios" : "Error al crear el evento"))
          if (serverMessage) {
            const guessedStep = guessEventoFormStepFromServerError(serverMessage)
            if (guessedStep && guessedStep !== activeStep) {
              setActiveStep(guessedStep)
            }
          }
          return
        }

        toast.success(isEdit ? "Evento actualizado correctamente" : "Evento creado correctamente")
        setIsDirty(false)
        router.push(data?.id ? `/dashboard/eventos/${data.id}` : cancelHref)
        router.refresh()
      } finally {
        setLoading(false)
        submittingRef.current = false
      }
    })
  }

  const previousStep = getPreviousEventoFormStep(activeStep)
  const nextStep = getNextEventoFormStep(activeStep)

  return (
    <form
      onSubmit={handleSubmit}
      // flex + min-h + mt-auto en el footer (más abajo): en steps largos el footer se
      // ancla al fondo del viewport vía `sticky` mientras se scrollea; en steps cortos
      // (ej. "info") el contenido no llena el alto disponible y sin esto el footer
      // quedaría flotando a mitad de página en vez de pegado abajo — el min-h fuerza
      // que el form siempre ocupe al menos el alto visible, así mt-auto empuja el
      // footer al fondo real en ambos casos.
      className="flex min-h-[calc(100dvh-8rem)] flex-col space-y-5 pb-8"
      onKeyDown={(e) => {
        // Evita que Enter dispare el submit implícito del form al tabular entre inputs de
        // una sola línea (ej. fecha/hora de publicación) — solo el click/Enter explícito
        // sobre el botón de submit real debe disparar el envío.
        if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") {
          e.preventDefault()
        }
      }}
    >
      <nav aria-label="Navegación" className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Link
          href="/dashboard/eventos"
          className="hover:text-foreground transition-colors"
          onClick={(e) => {
            if (isDirty) {
              e.preventDefault()
              requestNavigation("/dashboard/eventos")
            }
          }}
        >
          Eventos
        </Link>
        {isEdit && evento && (
          <>
            <ChevronRight className="h-3.5 w-3.5 opacity-50" />
            <Link
              href={`/dashboard/eventos/${evento.id}`}
              className="hover:text-foreground transition-colors truncate max-w-[180px]"
              onClick={(e) => {
                if (isDirty) {
                  e.preventDefault()
                  requestNavigation(`/dashboard/eventos/${evento.id}`)
                }
              }}
            >
              {evento.nombre}
            </Link>
          </>
        )}
        <ChevronRight className="h-3.5 w-3.5 opacity-50" />
        <span className="text-foreground font-medium">{isEdit ? "Editar" : "Nuevo evento"}</span>
      </nav>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <IconAction
            label="Volver"
            href={cancelHref}
            disabled={loading}
            onClick={(e) => {
              if (isDirty) {
                e.preventDefault()
                requestNavigation(cancelHref)
              }
            }}
            className="h-9 w-9 shrink-0 rounded-xl bg-muted hover:bg-muted/80"
          >
            <ArrowLeft className="h-4 w-4 text-foreground" />
          </IconAction>
          <div>
            <h1 className="text-2xl font-bold text-foreground">{isEdit ? "Editar evento" : "Nuevo evento"}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {isEdit ? evento?.nombre ?? "Actualizá los datos del evento" : "Completá los datos de tu evento"}
            </p>
          </div>
        </div>

        <Button
          type="button"
          variant="outline"
          className="h-10"
          disabled={loading}
          onClick={() => requestNavigation(cancelHref)}
        >
          Cancelar
        </Button>
      </div>

      <div className="rounded-2xl border border-border bg-card p-3 shadow-sm md:p-4">
        {/* Mobile: indicador compacto — barra de progreso + dots + label del step activo.
            Evita apilar las 4 tarjetas completas (con descripción) antes del primer campo. */}
        <div className="md:hidden">
          <div className="flex items-center justify-between gap-2 px-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Paso {activeStepIndex + 1} de {EVENTO_FORM_STEPS.length}
            </p>
            <p className="text-xs font-semibold text-primary">{EVENTO_FORM_STEPS[activeStepIndex]?.label}</p>
          </div>
          <div className="mt-2 flex items-center gap-1.5">
            {EVENTO_FORM_STEPS.map((step, index) => {
              const status = stepStatuses[index]
              return (
                <button
                  key={step.id}
                  type="button"
                  aria-label={`Ir a ${step.label}`}
                  aria-current={status === "active" ? "step" : undefined}
                  disabled={loading}
                  onClick={() => jumpToStep(step.id)}
                  className="flex min-h-11 flex-1 items-center disabled:pointer-events-none disabled:opacity-50"
                >
                  <span
                    className={cn(
                      "block h-1.5 w-full rounded-full transition-colors",
                      status === "active" ? "bg-primary" : status === "complete" ? "bg-primary/50" : "bg-muted"
                    )}
                  />
                </button>
              )
            })}
          </div>
        </div>

        {/* md+: tarjetas completas con ícono, número, label y descripción */}
        <div className="hidden gap-2 md:grid md:grid-cols-4">
          {EVENTO_FORM_STEPS.map((step, index) => {
            const status = stepStatuses[index]
            const isActive = status === "active"
            const isComplete = status === "complete"

            return (
              <button
                key={step.id}
                type="button"
                aria-current={isActive ? "step" : undefined}
                disabled={loading}
                onClick={() => jumpToStep(step.id)}
                className={cn(
                  "group rounded-xl border px-4 py-3 text-left transition-colors disabled:pointer-events-none disabled:opacity-50",
                  isActive
                    ? "border-primary bg-primary/10 text-foreground shadow-sm"
                    : isComplete
                      ? "border-primary/40 bg-primary/5 text-foreground hover:border-primary/60"
                      : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground"
                )}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold transition-colors",
                      isActive
                        ? "bg-primary text-primary-foreground"
                        : isComplete
                          ? "bg-primary/15 text-primary"
                          : "bg-muted text-muted-foreground"
                    )}
                  >
                    {isComplete ? <Check className="h-3 w-3" /> : index + 1}
                  </span>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Paso {index + 1}</p>
                </div>
                <p className="mt-1.5 text-sm font-semibold">{step.label}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{step.description}</p>
              </button>
            )
          })}
        </div>
      </div>

      <div ref={validationAlertRef}>
        <StepValidationAlert validation={activeValidation} />
      </div>

      {activeStep === "info" ? (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm lg:col-span-2">
            <SectionHeader icon={Info} title="Información del evento" subtitle="Datos generales visibles para los compradores" />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2 space-y-1.5">
                <Label htmlFor="ev-nombre" className="text-xs font-medium text-muted-foreground">Nombre del evento</Label>
                <Input
                  id="ev-nombre"
                  maxLength={191}
                  className={cn("h-10", activeValidation?.fieldErrors.nombre ? INVALID_FIELD_CLASS : "")}
                  placeholder="Festival de Jazz 2026"
                  value={form.nombre}
                  onChange={(e) => {
                    markDirty()
                    clearStepValidation("info")
                    setForm({ ...form, nombre: e.target.value })
                  }}
                />
                <FieldError message={activeValidation?.fieldErrors.nombre} />
              </div>

              <div className="sm:col-span-2 space-y-1.5">
                <Label htmlFor="ev-descripcion" className="text-xs font-medium text-muted-foreground">
                  Descripción <span className="font-normal text-muted-foreground">(opcional)</span>
                </Label>
                <Textarea
                  id="ev-descripcion"
                  placeholder="Contá de qué se trata el evento..."
                  className="resize-none"
                  rows={3}
                  value={form.descripcion}
                  onChange={(e) => { markDirty(); setForm({ ...form, descripcion: e.target.value }) }}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="ev-lugar" className="text-xs font-medium text-muted-foreground">
                  Lugar <span className="font-normal text-muted-foreground">(opcional)</span>
                </Label>
                <Input id="ev-lugar" maxLength={191} className="h-10" placeholder="Teatro Colón, Buenos Aires" value={form.lugar} onChange={(e) => { markDirty(); setForm({ ...form, lugar: e.target.value }) }} />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="ev-ciudad" className="text-xs font-medium text-muted-foreground">
                  Ciudad <span className="font-normal text-muted-foreground">(opcional)</span>
                </Label>
                <Input id="ev-ciudad" maxLength={100} className="h-10" placeholder="Buenos Aires" value={form.ciudad} onChange={(e) => { markDirty(); setForm({ ...form, ciudad: e.target.value }) }} />
                <p className="text-xs text-muted-foreground">Se usa para el filtro de ciudad en la vidriera pública de Ticketera (home + /eventos).</p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="ev-modo-fecha" className="text-xs font-medium text-muted-foreground">Modo de fecha</Label>
                {isPase ? (
                  // M-3: "pase" is not editable via this form — show readonly badge
                  <div className="flex h-10 items-center gap-2 rounded-md border border-border bg-muted/40 px-3">
                    <span className="text-sm text-foreground">Pase</span>
                    <span className="rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">Solo lectura</span>
                  </div>
                ) : (
                  <Select
                    value={form.modo_fecha}
                    onValueChange={(value) => {
                      markDirty()
                      clearStepValidation("info")
                      clearStepValidation("agenda")
                      const modoFecha = value as EventoFormCoreState["modo_fecha"]
                      setForm({ ...form, modo_fecha: modoFecha })
                      if (modoFecha === "unica") {
                        setFechas([{ id: fechas[0]?.id ?? "1", fecha: fechas[0]?.fecha ?? "" }])
                      }
                    }}
                  >
                    <SelectTrigger id="ev-modo-fecha" className={cn("h-10! min-h-10! w-full", activeValidation?.fieldErrors.modo_fecha ? INVALID_FIELD_CLASS : "")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="min-w-55">
                      <SelectItem className="px-3 py-2.5" value="unica">
                        Fecha única
                      </SelectItem>
                      <SelectItem className="px-3 py-2.5" value="multiple">
                        Múltiples fechas
                      </SelectItem>
                    </SelectContent>
                  </Select>
                )}
                <FieldError message={activeValidation?.fieldErrors.modo_fecha} />
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <SectionHeader icon={ImageIcon} title="Imagen de portada" subtitle="Visible en la página pública" />

            <ImageUploadInput
              value={form.imagen_url}
              onChange={(url) => { markDirty(); setForm({ ...form, imagen_url: url }) }}
              type="evento"
              aspect="card"
              description="Recomendado: 4:3 horizontal"
            />
          </div>
        </div>
      ) : null}

      {activeStep === "agenda" ? (
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <SectionHeader
            icon={CalendarDays}
            title="Agenda del evento"
            subtitle={form.modo_fecha === "multiple" ? "El comprador elige entre varias funciones" : "Definí cuándo se realiza el evento"}
          />

          <div className="space-y-2">
            {fechas.map((f, i) => (
              <div key={f.id} className="space-y-1">
                {form.modo_fecha === "multiple" ? <p className="text-xs text-muted-foreground">Función {i + 1}</p> : null}

                <div className="flex gap-2">
                  <Input
                    type="datetime-local"
                    className={cn("h-10 flex-1", activeValidation?.fieldErrors[`fechas.${i}`] ? INVALID_FIELD_CLASS : "")}
                    value={f.fecha}
                    onChange={(e) => actualizarFecha(f.id, e.target.value)}
                  />

                  {fechas.length > 1 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label="Eliminar fecha"
                      className="h-10 w-10 shrink-0 p-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() =>
                        setPendingDelete({
                          type: "fecha",
                          id: f.id,
                          label: form.modo_fecha === "multiple" ? `Función ${i + 1}` : "la fecha del evento",
                        })
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  ) : null}
                </div>
                <FieldError message={activeValidation?.fieldErrors[`fechas.${i}`]} />
              </div>
            ))}

            {form.modo_fecha === "multiple" ? (
              <Button type="button" variant="outline" size="sm" className="mt-1 h-9 w-full gap-1.5" onClick={agregarFecha}>
                <Plus className="h-3.5 w-3.5" /> Agregar función
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {activeStep === "venta" ? (
        <div className="space-y-5">
          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <SectionHeader icon={Ticket} title="Modalidad comercial" subtitle="Elegí si querés un flujo simple o gestionar tandas manuales" />
            <div className="grid gap-3 md:grid-cols-2">
              <button
                type="button"
                onClick={() => {
                  markDirty()
                  clearStepValidation("venta")
                  setUsarTandas(false)
                }}
                className={cn(
                  "rounded-xl border p-4 text-left transition-colors",
                  !usarTandas ? "border-primary bg-primary/10" : "border-border bg-background hover:border-primary/40"
                )}
              >
                <p className="text-sm font-semibold text-foreground">Simple</p>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  Categorías estándar, sin agrupar en tandas.
                </p>
              </button>

              <button
                type="button"
                onClick={() => {
                  markDirty()
                  clearStepValidation("venta")
                  setUsarTandas(true)
                }}
                className={cn(
                  "rounded-xl border p-4 text-left transition-colors",
                  usarTandas ? "border-primary bg-primary/10" : "border-border bg-background hover:border-primary/40"
                )}
              >
                <p className="text-sm font-semibold text-foreground">Avanzado con tandas</p>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  Agrupá categorías en etapas comerciales, como Early Bird, Preventa o Última tanda.
                </p>
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <SectionHeader icon={ShoppingBag} title="Venta de consumibles" subtitle="Habilitá o no la compra pública de consumibles para este evento" />
            <div
              className="rounded-xl border border-border bg-muted/30 p-4 text-left cursor-pointer select-none"
              onClick={() => {
                markDirty()
                clearStepValidation("venta")
                setForm((current) => ({ ...current, venta_consumibles_habilitada: !current.venta_consumibles_habilitada }))
              }}
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <p className="text-sm font-semibold text-foreground">Venta pública de consumibles</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Activa: venta de consumibles en el sitio público habilitada. Inactiva: compras bloqueadas, canje operativo.
                  </p>
                </div>
                <label className="flex shrink-0 cursor-pointer items-center gap-2 text-sm font-medium text-foreground">
                  <input
                    type="checkbox"
                    checked={form.venta_consumibles_habilitada}
                    onChange={(event) => {
                      markDirty()
                      clearStepValidation("venta")
                      setForm((current) => ({ ...current, venta_consumibles_habilitada: event.target.checked }))
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="h-4 w-4"
                  />
                  Venta activa
                </label>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <SectionHeader icon={Ticket} title="Categorías de entrada" subtitle="Tipos de entrada con precio y stock propio" />

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {categorias.map((cat, i) => (
                <div key={cat.id} className="space-y-3 rounded-xl border border-border bg-muted/40 p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Categoría {i + 1}</span>
                    {categorias.length > 1 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label="Eliminar categoría"
                        className="h-9 w-9 p-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() =>
                          setPendingDelete({
                            type: "categoria",
                            id: cat.id,
                            label: cat.nombre.trim() || `Categoría ${i + 1}`,
                          })
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    ) : null}
                  </div>

                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label htmlFor={`cat-nombre-${cat.id}`} className="text-xs text-muted-foreground">Nombre</Label>
                      <Input
                        id={`cat-nombre-${cat.id}`}
                        className={cn("h-9 bg-card", activeValidation?.fieldErrors[`categorias.${i}.nombre`] ? INVALID_FIELD_CLASS : "")}
                        placeholder="General"
                        value={cat.nombre}
                        onChange={(e) => actualizarCategoria(cat.id, "nombre", e.target.value)}
                      />
                      <FieldError message={activeValidation?.fieldErrors[`categorias.${i}.nombre`]} />
                    </div>

                    <div className="space-y-1">
                      <Label htmlFor={`cat-precio-${cat.id}`} className="text-xs text-muted-foreground">Precio</Label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 select-none text-sm text-muted-foreground">$</span>
                        <Input
                          id={`cat-precio-${cat.id}`}
                          className={cn("h-9 bg-card pl-7 font-mono tabular-nums", activeValidation?.fieldErrors[`categorias.${i}.precio`] ? INVALID_FIELD_CLASS : "")}
                          placeholder="2500"
                          type="number"
                          min="0"
                          value={cat.precio}
                          onChange={(e) => actualizarCategoria(cat.id, "precio", e.target.value)}
                        />
                      </div>
                      <FieldError message={activeValidation?.fieldErrors[`categorias.${i}.precio`]} />
                      {Number(cat.precio) === 0 && cat.precio !== "" && (
                        <p className="mt-1 text-xs text-amber-500 dark:text-amber-400">Esta categoría será gratuita</p>
                      )}
                    </div>

                    <div className="space-y-1">
                      <Label htmlFor={`cat-stock-${cat.id}`} className="text-xs text-muted-foreground">Stock</Label>
                      <Input
                        id={`cat-stock-${cat.id}`}
                        className={cn("h-9 bg-card", activeValidation?.fieldErrors[`categorias.${i}.stock`] ? INVALID_FIELD_CLASS : "")}
                        placeholder="100"
                        type="number"
                        min="1"
                        value={cat.stock}
                        onChange={(e) => actualizarCategoria(cat.id, "stock", e.target.value)}
                      />
                      <FieldError message={activeValidation?.fieldErrors[`categorias.${i}.stock`]} />
                    </div>

                    <div className="space-y-1 sm:col-span-2">
                      <Label htmlFor={`cat-descripcion-${cat.id}`} className="text-xs text-muted-foreground">Descripción <span className="text-muted-foreground/50">(opc.)</span></Label>
                      <Textarea
                        id={`cat-descripcion-${cat.id}`}
                        rows={2}
                        className="resize-none bg-card text-sm"
                        placeholder="Incluye..."
                        value={cat.descripcion ?? ""}
                        onChange={(e) => actualizarCategoria(cat.id, "descripcion", e.target.value)}
                      />
                    </div>

                    <div className="space-y-1 sm:col-span-2">
                      <Label className="text-xs text-muted-foreground">
                        Pack <span className="text-muted-foreground/50">(opc. — Ej: 2x1)</span>
                      </Label>
                      <div className="flex flex-wrap items-center gap-2">
                        {[1, 2, 3, 4, 5].map((n) => {
                          const current = Number(cat.entradas_por_unidad || "1")
                          return (
                            <button
                              key={n}
                              type="button"
                              onClick={() => actualizarCategoria(cat.id, "entradas_por_unidad", String(n))}
                              className={cn(
                                "h-9 min-w-[64px] rounded-md border px-3 text-xs font-medium transition-colors",
                                current === n
                                  ? "border-primary bg-primary text-primary-foreground"
                                  : "border-border bg-background hover:bg-muted",
                              )}
                            >
                              {n === 1 ? "Normal (1)" : `Pack ×${n}`}
                            </button>
                          )
                        })}
                      </div>
                      <p className="text-[11px] text-muted-foreground pt-1">
                        {Number(cat.entradas_por_unidad || "1") <= 1
                          ? "Una compra = una entrada (comportamiento normal)."
                          : `Por cada unidad comprada, el sistema genera ${cat.entradas_por_unidad} QRs únicos. Ideal para "2x1", "3x2", etc. El stock se cuenta en unidades del pack.`}
                      </p>
                    </div>

                    <div className="sm:col-span-2 space-y-1">
                      <Label className="text-xs text-muted-foreground">
                        Foto de la categoría <span className="text-muted-foreground/50">(opc.)</span>
                      </Label>
                      <ImageUploadInput
                        type="evento"
                        aspect="card"
                        value={cat.imagen_url}
                        onChange={(url) => actualizarCategoria(cat.id, "imagen_url", url)}
                        description="Se muestra en el punto de venta para identificar la entrada de un vistazo."
                      />
                    </div>

                    {usarTandas && tandas.length > 0 ? (
                      <div className="sm:col-span-2 space-y-1">
                        <Label className="text-xs text-muted-foreground">Tanda</Label>
                        <Select value={cat.tanda_id || "_sin_tanda"} onValueChange={(value) => actualizarCategoria(cat.id, "tanda_id", value === "_sin_tanda" ? "" : value)}>
                          <SelectTrigger className="h-9! w-full bg-card">
                            <SelectValue placeholder="Sin tanda" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="_sin_tanda">Sin tanda</SelectItem>
                            {tandas.map((tanda) => (
                              <SelectItem key={tanda.id} value={tanda.id}>
                                {tanda.nombre || "Tanda sin nombre"}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}

              <div className={categorias.length % 2 === 0 ? "lg:col-span-2" : ""}>
                <Button type="button" variant="outline" size="sm" className="h-9 w-full gap-1.5" onClick={agregarCategoria}>
                  <Plus className="h-3.5 w-3.5" /> Agregar categoría
                </Button>
              </div>
            </div>
          </div>

          {usarTandas ? (
            <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
              <SectionHeader icon={BarChart2} title="Tandas manuales" subtitle="Agrupá categorías en etapas comerciales como Early Bird, Preventa o Última tanda" />

              {tandas.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border p-6 text-center">
                  <p className="mb-3 text-sm text-muted-foreground">Todavía no agregaste tandas</p>
                  <Button type="button" variant="outline" onClick={agregarTanda} className="gap-2">
                    <Plus className="h-4 w-4" /> Crear primera tanda
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-end gap-2">
                    <Button type="button" variant="outline" size="sm" className="h-8" onClick={expandirTodasLasTandas}>
                      Expandir todas
                    </Button>
                    <Button type="button" variant="outline" size="sm" className="h-8" onClick={colapsarTodasLasTandas}>
                      Colapsar todas
                    </Button>
                  </div>

                  {tandas.map((tanda, index) => {
                    const categoriasAsociadas = categorias.filter((categoria) => categoria.tanda_id === tanda.id).length
                    const tandaAbierta = tandasAbiertasIds.includes(tanda.id)

                    return (
                      <div key={tanda.id} className="rounded-xl border border-border bg-muted/30 p-3.5">
                        <div className="flex items-center gap-3">
                          <button type="button" className="min-w-0 flex-1 text-left" onClick={() => toggleTandaAbierta(tanda.id)}>
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                                  <p className="text-sm font-semibold text-foreground">Tanda {index + 1}</p>
                                  <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">#{index + 1}</span>
                                </div>
                                <div className="flex min-w-0 flex-wrap items-center gap-2">
                                  <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${getTandaEstadoBadgeClass(tanda.estado)}`}>
                                    {capitalizeLabel(tanda.estado)}
                                  </span>
                                  <span className="rounded-full border border-border bg-card px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                                    {categoriasAsociadas} categoría{categoriasAsociadas === 1 ? "" : "s"}
                                  </span>
                                  <span className="max-w-full truncate rounded-full border border-border bg-card px-2 py-0.5 text-[11px] font-medium text-foreground">
                                    {capitalizeLabel(tanda.nombre || "Sin nombre")}
                                  </span>
                                </div>
                              </div>
                              <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", tandaAbierta ? "rotate-180" : "")} />
                            </div>
                          </button>

                          <div className="hidden shrink-0 items-center gap-1 md:flex">
                            {([
                              ["activa", "Activa"],
                              ["proxima", "Próxima"],
                              ["inactiva", "Inactiva"],
                            ] as const).map(([estado, label]) => (
                              <Button
                                key={estado}
                                type="button"
                                variant="ghost"
                                size="sm"
                                className={cn(
                                  "h-7 px-2 text-[11px]",
                                  tanda.estado === estado ? "border border-border bg-card text-foreground" : "text-muted-foreground"
                                )}
                                onClick={() => cambiarEstadoTanda(tanda.id, estado)}
                              >
                                {label}
                              </Button>
                            ))}
                          </div>

                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            aria-label="Eliminar tanda"
                            className="h-9 w-9 shrink-0 p-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                            onClick={() =>
                              setPendingDelete({
                                type: "tanda",
                                id: tanda.id,
                                label: tanda.nombre.trim() || `Tanda ${index + 1}`,
                                categoriasAsociadas,
                              })
                            }
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>

                        {tandaAbierta ? (
                          <div className="mt-3 grid grid-cols-1 gap-2.5 border-t border-border/60 pt-3 lg:grid-cols-4">
                            <div className="space-y-1 lg:col-span-2">
                              <Label htmlFor={`tanda-nombre-${tanda.id}`} className="text-xs text-muted-foreground">Nombre</Label>
                              <Input
                                id={`tanda-nombre-${tanda.id}`}
                                className={cn("h-9 bg-card", activeValidation?.fieldErrors[`tandas.${index}.nombre`] ? INVALID_FIELD_CLASS : "")}
                                placeholder="Early Bird"
                                value={tanda.nombre}
                                onChange={(e) => actualizarTanda(tanda.id, "nombre", e.target.value)}
                              />
                              <FieldError message={activeValidation?.fieldErrors[`tandas.${index}.nombre`]} />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs text-muted-foreground">Estado</Label>
                              <Select value={tanda.estado} onValueChange={(value) => cambiarEstadoTanda(tanda.id, value as Tanda["estado"])}>
                                <SelectTrigger className="h-9! w-full bg-card">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="activa">Activa</SelectItem>
                                  <SelectItem value="proxima">Próxima</SelectItem>
                                  <SelectItem value="inactiva">Inactiva</SelectItem>
                                  <SelectItem value="agotada">Agotada</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-1">
                              <Label htmlFor={`tanda-activa-desde-${tanda.id}`} className="text-xs text-muted-foreground">Activa desde</Label>
                              <Input id={`tanda-activa-desde-${tanda.id}`} type="datetime-local" className="h-9 bg-card" value={tanda.activa_desde} onChange={(e) => actualizarTanda(tanda.id, "activa_desde", e.target.value)} />
                            </div>
                            <div className="space-y-1 lg:col-span-2">
                              <Label htmlFor={`tanda-descripcion-${tanda.id}`} className="text-xs text-muted-foreground">Descripción</Label>
                              <Input id={`tanda-descripcion-${tanda.id}`} className="h-9 bg-card" placeholder="Precio promocional por tiempo limitado" value={tanda.descripcion} onChange={(e) => actualizarTanda(tanda.id, "descripcion", e.target.value)} />
                            </div>
                            <div className="lg:col-span-2">
                              <ImageUploadInput
                                label="Imagen (opcional)"
                                value={tanda.imagen_url ?? ""}
                                onChange={(url) => actualizarTanda(tanda.id, "imagen_url", url)}
                                type="evento"
                                aspect="card"
                              />
                            </div>
                          </div>
                        ) : null}
                      </div>
                    )
                  })}

                  <Button type="button" variant="outline" onClick={agregarTanda} className="w-full gap-2 md:w-auto">
                    <Plus className="h-4 w-4" /> Agregar tanda
                  </Button>
                </div>
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {activeStep === "publicacion" ? (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <div className="space-y-5 lg:col-span-2">
            <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
              <SectionHeader icon={RotateCcw} title="Reembolso" subtitle="Se aplica con la política general de la empresa" />

              <div className="rounded-xl border border-border bg-muted/40 p-4 text-left">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-foreground">Reembolso para este evento</p>
                    <p className="mt-1 text-xs text-muted-foreground">{getBuyerRefundToggleDescription(form.buyer_event_refunds_enabled)}</p>
                  </div>
                  <label className="flex items-center gap-2 text-sm font-medium text-foreground shrink-0">
                    <input
                      type="checkbox"
                      checked={form.buyer_event_refunds_enabled}
                      onChange={(event) => { markDirty(); setForm((current) => ({ ...current, buyer_event_refunds_enabled: event.target.checked })) }}
                      className="h-4 w-4"
                    />
                    Reembolso activo
                  </label>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
              <SectionHeader icon={CalendarDays} title="Momento de publicación" subtitle="Elegí cómo querés tratar la salida al público" />

              <div className="grid gap-3 md:grid-cols-2">
                <button
                  type="button"
                  onClick={() => {
                    markDirty()
                    clearStepValidation("publicacion")
                    setPublication((current) => ({ ...current, publication_timing: "immediate" }))
                  }}
                  className={cn(
                    "rounded-xl border p-4 text-left transition-colors",
                    publicationTiming === "immediate" ? "border-primary bg-primary/10" : "border-border bg-background hover:border-primary/40"
                  )}
                >
                  <p className="text-sm font-semibold text-foreground">Publicar ahora</p>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{publicationCopy.immediate}</p>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    markDirty()
                    clearStepValidation("publicacion")
                    setPublication((current) => ({ ...current, publication_timing: "scheduled" }))
                  }}
                  className={cn(
                    "rounded-xl border p-4 text-left transition-colors",
                    publicationTiming === "scheduled" ? "border-primary bg-primary/10" : "border-border bg-background hover:border-primary/40"
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-foreground">Programar publicación</p>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{publicationCopy.scheduled}</p>
                </button>
              </div>

              {publicationTiming === "scheduled" ? (
                <div className="mt-4 space-y-4 rounded-xl border border-border bg-muted/30 p-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="ev-publish-date" className="text-xs font-medium text-muted-foreground">Fecha de publicación</Label>
                      <Input
                        id="ev-publish-date"
                        type="date"
                        className={cn("h-10", activeValidation?.fieldErrors.publish_date_local ? INVALID_FIELD_CLASS : "")}
                        value={publication.publish_date_local}
                        onChange={(event) => {
                          markDirty()
                          clearStepValidation("publicacion")
                          setPublication((current) => ({ ...current, publish_date_local: event.target.value }))
                        }}
                      />
                      <FieldError message={activeValidation?.fieldErrors.publish_date_local} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="ev-publish-time" className="text-xs font-medium text-muted-foreground">Hora de publicación</Label>
                      <Input
                        id="ev-publish-time"
                        type="time"
                        className={cn("h-10", activeValidation?.fieldErrors.publish_time_local ? INVALID_FIELD_CLASS : "")}
                        value={publication.publish_time_local}
                        onChange={(event) => {
                          markDirty()
                          clearStepValidation("publicacion")
                          setPublication((current) => ({ ...current, publish_time_local: event.target.value }))
                        }}
                      />
                      <FieldError message={activeValidation?.fieldErrors.publish_time_local} />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">Visibilidad antes de publicar</p>
                    <div className="grid gap-3 md:grid-cols-2">
                      <button
                        type="button"
                        className={cn(
                          "rounded-xl border p-4 text-left transition-colors",
                          publication.pre_publish_visibility === "hidden" ? "border-primary bg-primary/10" : "border-border bg-background hover:border-primary/40"
                        )}
                        onClick={() => {
                          markDirty()
                          clearStepValidation("publicacion")
                          setPublication((current) => ({ ...current, pre_publish_visibility: "hidden" }))
                        }}
                      >
                        <p className="text-sm font-semibold text-foreground">Oculto hasta publicar</p>
                        <p className="mt-1 text-xs text-muted-foreground">No aparece en listado ni detalle hasta que llegue el momento real de publicación.</p>
                      </button>
                      <button
                        type="button"
                        className={cn(
                          "rounded-xl border p-4 text-left transition-colors",
                          publication.pre_publish_visibility !== "hidden" ? "border-primary bg-primary/10" : "border-border bg-background hover:border-primary/40"
                        )}
                        onClick={() => {
                          markDirty()
                          clearStepValidation("publicacion")
                          setPublication((current) => ({
                            ...current,
                            pre_publish_visibility: current.pre_publish_visibility === "hidden" ? "listado_solo" : current.pre_publish_visibility,
                          }))
                        }}
                      >
                        <p className="text-sm font-semibold text-foreground">Mostrar antes de publicar</p>
                        <p className="mt-1 text-xs text-muted-foreground">Optás por visibilidad previa. El checkout SIGUE bloqueado hasta publicar.</p>
                      </button>
                    </div>

                    {publication.pre_publish_visibility !== "hidden" ? (
                      <div className="grid gap-3 md:grid-cols-2">
                        <button
                          type="button"
                          className={cn(
                            "rounded-xl border p-4 text-left transition-colors",
                            publication.pre_publish_visibility === "listado_solo" ? "border-primary bg-primary/10" : "border-border bg-background hover:border-primary/40"
                          )}
                          onClick={() => {
                            markDirty()
                            clearStepValidation("publicacion")
                            setPublication((current) => ({ ...current, pre_publish_visibility: "listado_solo" }))
                          }}
                        >
                          <p className="text-sm font-semibold text-foreground">Solo en listado</p>
                          <p className="mt-1 text-xs text-muted-foreground">Aparece en home/listado, pero el detalle y el checkout quedan bloqueados.</p>
                        </button>
                        <button
                          type="button"
                          className={cn(
                            "rounded-xl border p-4 text-left transition-colors",
                            publication.pre_publish_visibility === "detail_visible" ? "border-primary bg-primary/10" : "border-border bg-background hover:border-primary/40"
                          )}
                          onClick={() => {
                            markDirty()
                            clearStepValidation("publicacion")
                            setPublication((current) => ({ ...current, pre_publish_visibility: "detail_visible" }))
                          }}
                        >
                          <p className="text-sm font-semibold text-foreground">Ver detalle incluido</p>
                          <p className="mt-1 text-xs text-muted-foreground">El evento se puede abrir y ver completo, pero el checkout sigue cerrado hasta publicar.</p>
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex h-full flex-col">
            <div className="flex h-full flex-col rounded-2xl border border-border bg-card p-6 shadow-sm">
              <SectionHeader icon={BarChart2} title="Resumen del evento" subtitle="Se actualiza automáticamente" />

              <div className="grid grid-cols-2 gap-4">
                {[
                  { label: "Categorías", value: formatInt(categorias.length) },
                  { label: "Stock total", value: totalStock > 0 ? formatInt(totalStock) : "—" },
                  { label: "Precio mínimo", value: totalMin !== null ? formatMoney(totalMin) : "—" },
                  { label: "Precio máximo", value: totalMax !== null ? formatMoney(totalMax) : "—" },
                ].map(({ label, value }) => (
                  <div key={label} className="rounded-xl bg-muted p-3">
                    <p className="mb-1 text-xs text-muted-foreground">{label}</p>
                    <p className="text-lg font-bold text-foreground">{value}</p>
                  </div>
                ))}
              </div>

              <div className="mt-4 rounded-xl border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
                <p className="font-semibold text-foreground">{form.nombre || "Evento sin nombre todavía"}</p>
                <p className="mt-1">{form.lugar.trim() ? form.lugar : "Sin lugar especificado"}</p>
                <p className="mt-1">
                  {form.modo_fecha === "multiple"
                    ? `${fechas.length} ${fechas.length === 1 ? "función" : "funciones"} configuradas`
                    : fechas[0]?.fecha
                      ? formatDateTime(fechas[0].fecha)
                      : "Fecha única configurada"}
                </p>
                <p className="mt-1">{usarTandas ? `${tandas.length} tandas manuales activas en el borrador` : "Venta simple sin tandas manuales"}</p>
                <p className="mt-1">{form.buyer_event_refunds_enabled ? "Reembolso de comprador habilitado" : "Reembolso de comprador deshabilitado"}</p>
                <p className="mt-1">{form.venta_consumibles_habilitada ? "Venta pública de consumibles activa" : "Venta pública de consumibles inactiva"}</p>
                <p className="mt-1">
                  {publicationTiming === "scheduled"
                    ? `Publicación programada ${publication.publish_date_local || "sin fecha"} ${publication.publish_time_local || "sin hora"} (${publication.pre_publish_visibility === "hidden" ? "oculto hasta publicar" : publication.pre_publish_visibility === "detail_visible" ? "ver detalle incluido" : "solo en listado"})`
                    : "Publicación inmediata"}
                </p>
              </div>
            </div>

          </div>
        </div>
      ) : null}

      <div
        className="sticky bottom-0 z-10 mt-auto flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card/95 p-4 shadow-sm backdrop-blur-sm supports-backdrop-filter:bg-card/85"
        style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
      >
        {previousStep ? (
          <Button type="button" variant="outline" className="h-10" disabled={loading} onClick={handleBack}>
            Retroceder
          </Button>
        ) : (
          <div />
        )}

        {nextStep ? (
          <Button key="step-continue" type="button" className="h-10" onClick={handleContinue}>
            Continuar
          </Button>
        ) : shouldShowEventoFormSubmit(activeStep) ? (
          <Button key="step-submit" type="submit" className="h-10 gap-2" disabled={loading}>
            {isEdit ? <Save className="h-4 w-4" /> : null}
            {loading ? (isEdit ? "Guardando..." : "Creando evento...") : isEdit ? "Guardar cambios" : "Crear evento"}
          </Button>
        ) : null}
      </div>
      <Dialog
        open={showCancelDialog}
        onOpenChange={(open) => {
          setShowCancelDialog(open)
          if (!open) setPendingNavHref(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Salir sin guardar</DialogTitle>
            <DialogDescription>
              Tenés cambios sin guardar. Si salís ahora, perderás todo lo que modificaste.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCancelDialog(false)}>
              Seguir editando
            </Button>
            <Button variant="destructive" onClick={() => router.push(pendingNavHref ?? cancelHref)}>
              Salir sin guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pendingDelete?.type === "fecha"
                ? "Eliminar fecha"
                : pendingDelete?.type === "categoria"
                  ? "Eliminar categoría"
                  : "Eliminar tanda"}
            </DialogTitle>
            <DialogDescription>
              {pendingDelete?.type === "fecha" &&
                `Vas a eliminar ${pendingDelete.label}. Esta acción no se puede deshacer.`}
              {pendingDelete?.type === "categoria" &&
                `Vas a eliminar la categoría "${pendingDelete.label}". Esta acción no se puede deshacer.`}
              {pendingDelete?.type === "tanda" &&
                (pendingDelete.categoriasAsociadas > 0
                  ? `Vas a eliminar la tanda "${pendingDelete.label}". Sus ${pendingDelete.categoriasAsociadas} categoría${pendingDelete.categoriasAsociadas === 1 ? "" : "s"} asociada${pendingDelete.categoriasAsociadas === 1 ? "" : "s"} van a quedar sin tanda. Esta acción no se puede deshacer.`
                  : `Vas a eliminar la tanda "${pendingDelete.label}". Esta acción no se puede deshacer.`)}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDelete(null)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={confirmPendingDelete}>
              Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  )
}
