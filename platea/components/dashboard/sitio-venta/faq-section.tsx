"use client"

import dynamic from "next/dynamic"
import { LifeBuoy, Eye, EyeOff, GripVertical, Plus, Trash2 } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"

const RichTextEditor = dynamic(
  () => import("./rich-text-editor").then((mod) => mod.RichTextEditor),
  { ssr: false },
)
import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { SectionCard } from "./shared-ui"
import type { SitioVentaForm, SupportFaqDraft } from "./types"
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"

// Fila sorteable — hoisteada a module scope (no definida dentro de FaqSection)
// para no violar react-hooks/static-components: useSortable es un hook y cada
// fila necesita su propia instancia de componente, no una función inline por render.
function SortableFaqRow({
  faq,
  index,
  onUpdate,
  onToggleHidden,
  onDelete,
}: {
  faq: SupportFaqDraft
  index: number
  onUpdate: (nextFaq: SupportFaqDraft) => void
  onToggleHidden: () => void
  onDelete: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: faq.id })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="min-w-0 overflow-hidden rounded-xl border border-border/60 bg-muted/30 p-3 @sm:p-4 space-y-3"
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground cursor-grab active:cursor-grabbing"
          aria-label={`Reordenar FAQ ${index + 1}`}
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <p className="truncate text-sm font-semibold text-foreground flex-1">
            {faq.question.trim() || `Pregunta ${index + 1}`}
          </p>
          <Badge variant={faq.hidden ? "outline" : "default"} className="shrink-0 text-[11px] px-2 py-0.5 rounded-md">
            {faq.hidden ? "Oculta" : "Visible"}
          </Badge>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onToggleHidden}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label={faq.hidden ? `Mostrar FAQ ${index + 1}` : `Ocultar FAQ ${index + 1}`}
            >
              {faq.hidden ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">{faq.hidden ? "Mostrar" : "Ocultar"}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onDelete}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-destructive/30 bg-destructive/5 text-destructive transition-colors hover:bg-destructive/10"
              aria-label={`Eliminar FAQ ${index + 1}`}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">Eliminar</TooltipContent>
        </Tooltip>
      </div>
      <div className="space-y-1.5">
        <Label className="text-[13px] font-medium text-foreground/70">Pregunta</Label>
        <Input
          className="h-10"
          placeholder="Ej: ¿Cómo descargo mi entrada?"
          value={faq.question}
          onChange={(e) => onUpdate({ ...faq, question: e.target.value })}
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-[13px] font-medium text-foreground/70">Respuesta</Label>
        <RichTextEditor
          value={faq.answer}
          onChange={(html) => onUpdate({ ...faq, answer: html })}
          placeholder="Ej: Podés verla en Mis Tickets luego de comprar"
          minHeight="160px"
          showContactSnippets={false}
        />
      </div>
    </div>
  )
}

export function FaqSection({ form, setForm }: { form: SitioVentaForm; setForm: React.Dispatch<React.SetStateAction<SitioVentaForm>> }) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function updateFaq(index: number, nextFaq: SupportFaqDraft) {
    const nextFaqs = [...form.faqs]
    nextFaqs[index] = nextFaq
    setForm({ ...form, faqs: nextFaqs })
  }

  function addFaq() {
    setForm({
      ...form,
      faqs: [...form.faqs, { id: `faq-${Date.now()}`, question: "", answer: "", hidden: false }],
    })
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = form.faqs.findIndex((f) => f.id === active.id)
    const newIndex = form.faqs.findIndex((f) => f.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return
    setForm({ ...form, faqs: arrayMove(form.faqs, oldIndex, newIndex) })
  }

  const hasEmail = form.support_contact_email.trim().length > 0
  const visibleFaqCount = form.faqs.filter((faq) => !faq.hidden).length

  return (
    <SectionCard icon={LifeBuoy} title="Soporte y preguntas frecuentes" subtitle="Definí el email público y qué FAQs quedan visibles en soporte" fullWidth>
      <TooltipProvider>
        <div className="space-y-4">
          <div className="rounded-xl border border-border/60 bg-muted/30 p-4 space-y-3">
            <div className="space-y-1">
              <p className="text-[15px] font-semibold tracking-tight text-foreground">Canal de contacto</p>
              <p className="text-xs text-muted-foreground">Definí el email que recibe los mensajes del soporte público. Si queda vacío, el formulario no se muestra.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="support-contact-email" className="text-[13px] font-medium text-foreground/70">Email público de soporte</Label>
              <Input
                id="support-contact-email"
                type="email"
                className="h-10"
                placeholder="soporte@tuempresa.com"
                value={form.support_contact_email}
                onChange={(e) => setForm({ ...form, support_contact_email: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="empresa-whatsapp" className="text-[13px] font-medium text-foreground/70">WhatsApp (opcional)</Label>
              <Input
                id="empresa-whatsapp"
                type="tel"
                className="h-10"
                placeholder="+549 11 1234 5678"
                value={form.whatsapp}
                onChange={(e) => setForm({ ...form, whatsapp: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">Activa el botón de WhatsApp en soporte. Incluí el código de país.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="empresa-descripcion" className="text-[13px] font-medium text-foreground/70">Descripción (opcional)</Label>
              <Textarea
                id="empresa-descripcion"
                className="min-h-[72px] resize-none"
                rows={2}
                placeholder="Ej: Productora de eventos en CABA con más de 10 años de experiencia."
                value={form.descripcion}
                onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
              />
            </div>
            {!hasEmail ? (
              <div className="rounded-xl border border-dashed border-border/60 px-4 py-3 text-sm text-muted-foreground">
                El formulario público va a quedar oculto hasta configurar un email.
                {visibleFaqCount > 0 && (
                  <span> Hay {visibleFaqCount} FAQ{visibleFaqCount === 1 ? "" : "s"} visible{visibleFaqCount === 1 ? "" : "s"} para compradores.</span>
                )}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-border/60 px-4 py-3 text-sm text-muted-foreground">
                El formulario público va a estar visible.
              </div>
            )}
          </div>

          <div className="space-y-3">
          <div className="space-y-1">
            <p className="text-[15px] font-semibold tracking-tight text-foreground">Preguntas frecuentes</p>
            <p className="text-xs text-muted-foreground">Agregá, ocultá, eliminá o arrastrá FAQs para cambiar el orden en que aparecen en soporte.</p>
          </div>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={form.faqs.map((f) => f.id)} strategy={verticalListSortingStrategy}>
              {form.faqs.map((faq, i) => (
                <SortableFaqRow
                  key={faq.id}
                  faq={faq}
                  index={i}
                  onUpdate={(nextFaq) => updateFaq(i, nextFaq)}
                  onToggleHidden={() => updateFaq(i, { ...faq, hidden: !faq.hidden })}
                  onDelete={() => setForm({ ...form, faqs: form.faqs.filter((_, index) => index !== i) })}
                />
              ))}
            </SortableContext>
          </DndContext>

          {form.faqs.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
              Todavía no cargaste FAQs. Podés sumar visibles u ocultas y decidir después qué publicar.
            </div>
          ) : null}

          {form.faqs.length < 8 && (
            <button type="button" onClick={addFaq} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border bg-background px-4 text-sm font-medium text-primary transition-colors hover:bg-muted cursor-pointer">
              <Plus className="h-4 w-4" /> Agregar pregunta frecuente
            </button>
          )}
          </div>
        </div>
      </TooltipProvider>
    </SectionCard>
  )
}
