"use client"

import { AlignJustify, Eye, Image as ImageIcon, LayoutGrid, LayoutList, Maximize2, Minus, Palette, Rows3, Square, User } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { SectionCard } from "./shared-ui"
import type { SitioVentaForm } from "./types"

export function EditorialHomeSection({ form, setForm }: { form: SitioVentaForm; setForm: React.Dispatch<React.SetStateAction<SitioVentaForm>> }) {
  const titulo = form.titulo_eventos_home || "Elegí tu próximo evento"
  const subtitulo = form.subtitulo_eventos_home || "Viví una experiencia única con nuestra programación"
  const cta = form.cta_eventos_home || "Comprar"

  return (
    <SectionCard icon={User} title="Contenido editorial del home" subtitle="Definí cómo querés presentar el bloque principal de eventos">
      <div className="space-y-3">
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between">
            <Label className="text-[13px] font-medium text-foreground/70">Título de la sección</Label>
            <span className="text-[11px] text-muted-foreground">{form.titulo_eventos_home.length}/120</span>
          </div>
          <Input
            className="h-10"
            placeholder="Elegí tu próximo evento"
            maxLength={120}
            value={form.titulo_eventos_home}
            onChange={(e) => setForm({ ...form, titulo_eventos_home: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between">
            <Label className="text-[13px] font-medium text-foreground/70">Subtítulo de apoyo</Label>
            <span className="text-[11px] text-muted-foreground">{form.subtitulo_eventos_home.length}/255</span>
          </div>
          <Input
            className="h-10"
            placeholder="Viví una experiencia única con nuestra programación"
            maxLength={255}
            value={form.subtitulo_eventos_home}
            onChange={(e) => setForm({ ...form, subtitulo_eventos_home: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between">
            <Label className="text-[13px] font-medium text-foreground/70">CTA principal</Label>
            <span className="text-[11px] text-muted-foreground">{form.cta_eventos_home.length}/40</span>
          </div>
          <Input
            className="h-10"
            placeholder="Comprar"
            maxLength={40}
            value={form.cta_eventos_home}
            onChange={(e) => setForm({ ...form, cta_eventos_home: e.target.value })}
          />
          <p className="text-[11px] text-muted-foreground">Corto y claro: Comprar, Reservar, Quiero ir.</p>
        </div>

        {/* Inline preview */}
        <div className="rounded-xl border border-border/60 bg-muted/20 px-4 py-3 space-y-0.5">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/50 mb-2">Vista previa</p>
          <p className="text-sm font-bold text-foreground leading-tight truncate">{titulo}</p>
          <p className="text-[11px] text-muted-foreground leading-snug line-clamp-2">{subtitulo}</p>
          <div className="pt-1.5">
            <span className="inline-flex h-7 items-center rounded-lg bg-primary px-3 text-[11px] font-semibold text-white">
              {cta}
            </span>
          </div>
        </div>
      </div>
    </SectionCard>
  )
}

const PRESENTACION_ITEMS = [
  { key: "mostrar_descripcion_home" as const,  label: "Descripción",          desc: "Descripción corta del evento en la card." },
  { key: "mostrar_tanda_activa_home" as const, label: "Tanda activa",         desc: "Destaca la etapa comercial actual del evento." },
  { key: "mostrar_badge_stock_home" as const,  label: "Badge 'últimas'",      desc: "Genera urgencia cuando queda poco stock." },
  { key: "mostrar_fecha_home" as const,        label: "Fecha del evento",     desc: "Ayuda a leer cuándo sucede cada evento." },
  { key: "mostrar_lugar_home" as const,        label: "Lugar del evento",     desc: "Útil cuando el lugar es parte de la propuesta." },
  { key: "mostrar_precio_home" as const,       label: "Precio desde",         desc: "Precio base visible en las cards del home." },
]

export function PresentacionHomeSection({ form, setForm }: { form: SitioVentaForm; setForm: React.Dispatch<React.SetStateAction<SitioVentaForm>> }) {
  const activeCount = PRESENTACION_ITEMS.filter((item) => form[item.key]).length
  return (
    <SectionCard icon={Eye} title="Visibilidad del home" subtitle="Elegí qué información mostrás en las cards y la portada">
      <div className="space-y-2">
        <div className="flex items-center justify-between pb-1">
          <p className="text-[12px] text-muted-foreground">Señales activas</p>
          <span className={`text-[12px] font-semibold tabular-nums ${activeCount > 4 ? "text-amber-600 dark:text-amber-400" : "text-foreground"}`}>
            {activeCount}/{PRESENTACION_ITEMS.length}
          </span>
        </div>
        {PRESENTACION_ITEMS.map((item) => (
          <label
            key={item.key}
            className="flex items-center gap-3 rounded-xl border border-border/60 bg-muted/20 px-3 py-2.5 cursor-pointer hover:bg-muted/30 transition-colors"
          >
            <Switch
              checked={form[item.key]}
              onCheckedChange={(checked) => setForm({ ...form, [item.key]: checked })}
              className="shrink-0"
            />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-foreground leading-tight">{item.label}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{item.desc}</p>
            </div>
          </label>
        ))}
        <p className="pt-1 text-[11px] text-muted-foreground">Menos señales = mejor lectura. Activá solo lo que agrega valor.</p>
      </div>
    </SectionCard>
  )
}

function VisualOptionGroup<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: T
  onChange: (v: T) => void
  options: Array<{ value: T; label: string; hint?: string; icon?: React.ReactNode }>
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[13px] font-medium text-foreground/70">{label}</Label>
      <div className={`grid gap-1.5 ${options.length === 2 ? "grid-cols-2" : options.length === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
        {options.map((opt) => {
          const active = value === opt.value
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              aria-label={`${label}: ${opt.label}`}
              aria-pressed={active}
              className={`flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-center transition-all cursor-pointer ${
                active ? "border-primary bg-primary/5" : "border-border bg-muted/20 hover:bg-muted/40"
              }`}
            >
              {opt.icon && <span className={`${active ? "text-primary" : "text-muted-foreground"}`}>{opt.icon}</span>}
              <span className={`text-[12px] font-semibold leading-tight ${active ? "text-foreground" : "text-foreground/70"}`}>{opt.label}</span>
              {opt.hint && <span className="text-[10px] text-muted-foreground leading-tight">{opt.hint}</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function GridColumnsIcon({ cols }: { cols: 1 | 2 | 3 }) {
  return (
    <div className={`grid h-5 w-8 gap-0.5 ${cols === 1 ? "grid-cols-1" : cols === 2 ? "grid-cols-2" : "grid-cols-3"}`}>
      {Array.from({ length: cols }, (_, i) => (
        <div key={i} className="rounded-sm bg-current opacity-50 h-full" />
      ))}
    </div>
  )
}

/**
 * Layout general del home (ver openspec/changes/sitio-venta-v2/design.md).
 * "" => clasico: es el default historico y NO debe cambiar solo para tenants ya
 * publicados. Cartelera y Agenda tienen su propio arbol de render y por eso ignoran
 * las opciones de grilla de "Layout de cards" — se avisa abajo en vez de dejar al
 * usuario tocando controles que no hacen nada.
 */
export function LayoutHomeSection({ form, setForm }: { form: SitioVentaForm; setForm: React.Dispatch<React.SetStateAction<SitioVentaForm>> }) {
  const actual = form.eventos_layout || "clasico"
  return (
    <SectionCard icon={LayoutGrid} title="Layout del home" subtitle="Cómo se presentan los eventos en la portada de tu sitio">
      <VisualOptionGroup
        label="Presentación"
        value={actual}
        onChange={(v) => setForm({ ...form, eventos_layout: v as SitioVentaForm["eventos_layout"] })}
        options={[
          { value: "clasico",   label: "Clásico",   hint: "Grilla de cards",              icon: <LayoutGrid className="h-4 w-4" /> },
          { value: "cartelera", label: "Cartelera", hint: "Próximo evento en portada",    icon: <Maximize2 className="h-4 w-4" /> },
          { value: "agenda",    label: "Agenda",    hint: "Filas por fecha, más densa",   icon: <AlignJustify className="h-4 w-4" /> },
        ]}
      />
      <p className="mt-3 text-xs text-muted-foreground leading-relaxed">
        {actual === "cartelera" && "El próximo evento ocupa la portada con su imagen completa y el resto baja a una grilla. Si tenés un solo evento publicado, la portada ocupa toda la página."}
        {actual === "agenda" && "Una fila por fecha, con miniatura y precio. Es la que mejor aguanta cuando tenés muchas fechas cargadas."}
        {actual === "clasico" && "La grilla de siempre. Las opciones de abajo (columnas, tamaño y mobile) aplican a este layout."}
      </p>
      {actual !== "clasico" && (
        <p className="mt-2 text-xs text-amber-600 dark:text-amber-500 leading-relaxed">
          Ojo: con este layout, las opciones de &ldquo;Layout de cards&rdquo; (columnas, tamaño y mobile) no se aplican.
        </p>
      )}
    </SectionCard>
  )
}

export function EventCardsSection({ form, setForm }: { form: SitioVentaForm; setForm: React.Dispatch<React.SetStateAction<SitioVentaForm>> }) {
  return (
    <SectionCard icon={Palette} title="Layout de cards" subtitle="Cómo se ven y organizan los eventos en la grilla del home">
      <div className="grid gap-4 @lg:grid-cols-2">
        <VisualOptionGroup
          label="Estilo de card"
          value={form.event_card_style || "clasico"}
          onChange={(v) => setForm({ ...form, event_card_style: v === "editorial" ? "editorial" : "clasico" })}
          options={[
            { value: "clasico",   label: "Clásico",   hint: "Imagen + cuerpo separados", icon: <Rows3 className="h-4 w-4" /> },
            { value: "editorial", label: "Editorial", hint: "Imagen full-bleed + overlay", icon: <ImageIcon className="h-4 w-4" /> },
          ]}
        />

        <VisualOptionGroup
          label="Tamaño de cards en PC"
          value={form.desktop_event_card_size}
          onChange={(v) => setForm({ ...form, desktop_event_card_size: v })}
          options={[
            { value: "large",  label: "Grande",   hint: "Imagen prominente",  icon: <Maximize2 className="h-4 w-4" /> },
            { value: "medium", label: "Mediano",  hint: "Balance imagen/info",icon: <Square className="h-4 w-4" /> },
            { value: "small",  label: "Chico",    hint: "Más eventos visibles",icon: <Minus className="h-4 w-4" /> },
          ]}
        />

        <VisualOptionGroup
          label="Columnas en PC"
          value={form.card_columns || "3"}
          onChange={(v) => setForm({ ...form, card_columns: v as "1" | "2" | "3" })}
          options={[
            { value: "1", label: "1 col",  hint: "Foco",      icon: <GridColumnsIcon cols={1} /> },
            { value: "2", label: "2 col",  hint: "Espacioso", icon: <GridColumnsIcon cols={2} /> },
            { value: "3", label: "3 col",  hint: "Estándar",  icon: <GridColumnsIcon cols={3} /> },
          ]}
        />

        <VisualOptionGroup
          label="Mobile"
          value={form.mobile_event_layout || "lista"}
          onChange={(v) => setForm({ ...form, mobile_event_layout: v as "lista" | "cuadricula" })}
          options={[
            { value: "lista",      label: "Lista",      hint: "Fila imagen + detalle", icon: <LayoutList className="h-4 w-4" /> },
            { value: "cuadricula", label: "Cuadrícula", hint: "2 columnas",             icon: <LayoutGrid className="h-4 w-4" /> },
          ]}
        />

        <VisualOptionGroup
          label="Espaciado entre secciones"
          value={form.section_spacing || "normal"}
          onChange={(v) => setForm({ ...form, section_spacing: v as "compact" | "normal" | "spacious" })}
          options={[
            { value: "compact",  label: "Compacto",  hint: "Denso",    icon: <AlignJustify className="h-3.5 w-3.5" /> },
            { value: "normal",   label: "Normal",    hint: "Estándar", icon: <AlignJustify className="h-4 w-4" /> },
            { value: "spacious", label: "Amplio",    hint: "Aireado",  icon: <AlignJustify className="h-5 w-5" /> },
          ]}
        />
      </div>
    </SectionCard>
  )
}
