"use client"

import { useState } from "react"
import { AlertTriangle, Image, Palette, Plus, RotateCcw, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { ImageUploadInput } from "@/components/dashboard/image-upload-input"
import { SectionCard, SubSection, ColorInput } from "./shared-ui"
import type { SitioVentaForm } from "./types"

const FONT_OPTIONS = [
  { value: "",              label: "Predeterminada (Nunito)",   style: {} },
  { value: "inter",         label: "Inter — Moderna y prolija", style: { fontFamily: "'Inter', sans-serif" } },
  { value: "poppins",       label: "Poppins — Versátil",        style: { fontFamily: "'Poppins', sans-serif" } },
  { value: "dm-sans",       label: "DM Sans — Clean",           style: { fontFamily: "'DM Sans', sans-serif" } },
  { value: "montserrat",    label: "Montserrat — Deportiva",    style: { fontFamily: "'Montserrat', sans-serif" } },
  { value: "space-grotesk", label: "Space Grotesk — Tech",      style: { fontFamily: "'Space Grotesk', sans-serif" } },
  { value: "raleway",       label: "Raleway — Elegante",        style: { fontFamily: "'Raleway', sans-serif" } },
  { value: "playfair",      label: "Playfair Display — Premium",style: { fontFamily: "'Playfair Display', serif" } },
  { value: "bebas",         label: "Bebas Neue — Impacto",      style: { fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.05em", textTransform: "uppercase" as const } },
] as const

const BORDER_RADIUS_OPTIONS = [
  { value: "" as const,        label: "Predeterminado", preview: "rounded-xl" },
  { value: "sharp" as const,   label: "Sharp",     preview: "rounded-none" },
  { value: "soft" as const,    label: "Suave",     preview: "rounded" },
  { value: "rounded" as const, label: "Redondeado",preview: "rounded-xl" },
] as const

const BUTTON_STYLE_OPTIONS = [
  { value: "filled" as const,  label: "Sólido",      desc: "Fondo de color" },
  { value: "outline" as const, label: "Borde",        desc: "Solo contorno" },
  { value: "ghost" as const,   label: "Texto",        desc: "Sin borde ni fondo" },
] as const

export const PLANTILLAS_SITIO = [
  {
    id: "nocturna",
    nombre: "Nocturna",
    descripcion: "Shows y boliches. Oscura e intensa.",
    color_primario: "#2563eb",
    color_fondo: "#000000",
    color_texto: "#ffffff",
    border_radius: "rounded" as const,
    button_style: "filled" as const,
    font: "",
    heading_font: "",
  },
  {
    id: "clara",
    nombre: "Clara",
    descripcion: "Marcas prolijas y eventos familiares.",
    color_primario: "#0f766e",
    color_fondo: "#f8fafc",
    color_texto: "#0f172a",
    border_radius: "soft" as const,
    button_style: "filled" as const,
    font: "poppins",
    heading_font: "",
  },
  {
    id: "vibrante",
    nombre: "Vibrante",
    descripcion: "Festivales, promos y eventos juveniles.",
    color_primario: "#db2777",
    color_fondo: "#111827",
    color_texto: "#f9fafb",
    border_radius: "rounded" as const,
    button_style: "filled" as const,
    font: "montserrat",
    heading_font: "",
  },
  {
    id: "premium",
    nombre: "Premium",
    descripcion: "Teatro y eventos de lujo. Elegante y serif.",
    color_primario: "#b45309",
    color_fondo: "#0a0a0a",
    color_texto: "#f5f0e8",
    border_radius: "soft" as const,
    button_style: "outline" as const,
    font: "raleway",
    heading_font: "playfair",
  },
  {
    id: "tech",
    nombre: "Tech",
    descripcion: "Congresos, meetups y eventos tech.",
    color_primario: "#6366f1",
    color_fondo: "#0f172a",
    color_texto: "#e2e8f0",
    border_radius: "sharp" as const,
    button_style: "filled" as const,
    font: "space-grotesk",
    heading_font: "",
  },
  {
    id: "urbano",
    nombre: "Urbano",
    descripcion: "Reggaetón, trap y fiestas urbanas. Cálida y con actitud.",
    color_primario: "#e11d48",
    color_fondo: "#18181b",
    color_texto: "#fafafa",
    border_radius: "rounded" as const,
    button_style: "filled" as const,
    font: "",
    heading_font: "bebas",
  },
  {
    id: "under",
    nombre: "Under",
    descripcion: "Techno y underground. Cruda y minimalista.",
    color_primario: "#a3e635",
    color_fondo: "#000000",
    color_texto: "#f4f4f5",
    border_radius: "sharp" as const,
    button_style: "outline" as const,
    font: "dm-sans",
    heading_font: "",
  },
  {
    id: "pastel",
    nombre: "Pastel",
    descripcion: "Day parties, afters y eventos al aire libre. Suave y luminosa.",
    color_primario: "#a78bfa",
    color_fondo: "#fdf4ff",
    color_texto: "#3b0764",
    border_radius: "rounded" as const,
    button_style: "filled" as const,
    font: "inter",
    heading_font: "",
  },
  {
    id: "exclusive",
    nombre: "Exclusive",
    descripcion: "Eventos VIP y experiencias exclusivas. Blanco y negro, sin distracciones.",
    color_primario: "#000000",
    color_fondo: "#ffffff",
    color_texto: "#0a0a0a",
    border_radius: "sharp" as const,
    button_style: "outline" as const,
    font: "inter",
    heading_font: "",
  },
] as const

// Módulo-scope (no adentro de BrandingVisualSection): definirlo dentro del render
// hacía que se recreara —y remontara todo el DOM de los 9 botones— en cada
// keystroke de cualquier campo de la sección (confirmado por ESLint
// react-hooks/static-components).
function FontPicker({ value, onChange, forHeading }: { value: string; onChange: (v: string) => void; forHeading?: boolean }) {
  const options = forHeading
    ? [{ value: "", label: "Misma que el cuerpo", style: {} }, ...FONT_OPTIONS.slice(1)]
    : FONT_OPTIONS
  return (
    <div className="grid grid-cols-2 gap-1.5 @sm:grid-cols-3">
      {options.map((opt) => {
        const active = value === opt.value
        const shortName = opt.value === "" ? (forHeading ? "Igual" : "Nunito") : opt.label.split(" —")[0].split(" ")[0]
        const sampleText = opt.value === "" ? (forHeading ? "=body" : "Ag") : opt.style && "fontFamily" in opt.style && (opt.style as { fontFamily?: string }).fontFamily?.includes("Bebas") ? "AB" : "Ag"
        const ariaName = opt.value === "" ? (forHeading ? "Misma que el cuerpo" : "Nunito (predeterminada)") : opt.label.split(" —")[0]
        return (
          <button
            key={opt.value || (forHeading ? "h-default" : "default")}
            type="button"
            onClick={() => onChange(opt.value)}
            aria-label={`Seleccionar fuente ${ariaName}`}
            aria-pressed={active}
            className={`relative flex flex-col gap-1 rounded-xl border p-2.5 text-left transition-all cursor-pointer ${
              active ? "border-primary bg-primary/5" : "border-border bg-muted/20 hover:bg-muted/40"
            }`}
          >
            <span className="text-xl font-semibold leading-none" style={opt.style}>
              {sampleText}
            </span>
            <span className="text-[10px] leading-snug text-muted-foreground truncate w-full">{shortName}</span>
            {active && <div className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-primary" aria-hidden />}
          </button>
        )
      })}
    </div>
  )
}

export function BrandingVisualSection({ form, setForm, aplicarPlantilla }: { form: SitioVentaForm; setForm: React.Dispatch<React.SetStateAction<SitioVentaForm>>; aplicarPlantilla: (plantilla: (typeof PLANTILLAS_SITIO)[number]) => void }) {
  const [confirmNavbarSyncOpen, setConfirmNavbarSyncOpen] = useState(false)
  const hasNavbarColorOverride = !!form.navbar_color.trim() && form.navbar_color.trim().toLowerCase() !== form.color_primario.trim().toLowerCase()
  const radiusPx = form.border_radius === "sharp" ? "0px" : form.border_radius === "soft" ? "4px" : "12px"

  return (
    <TooltipProvider>
      <>
        <SectionCard icon={Palette} title="Branding visual" subtitle="Nombre, colores y aspecto principal de tu sitio">
          <div className="space-y-4">

            {/* ── Identidad ── */}
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="empresa-nombre" className="text-[13px] font-medium text-foreground/70">Nombre del sitio</Label>
                <Input
                  id="empresa-nombre"
                  className="h-10"
                  placeholder="Ej: Fenix Live"
                  maxLength={100}
                  value={form.nombre}
                  onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="empresa-descripcion" className="text-[13px] font-medium text-foreground/70">Descripción del sitio</Label>
                <Textarea
                  id="empresa-descripcion"
                  className="min-h-[72px] resize-none"
                  placeholder="Ej: La productora de shows y festivales más grande de La Plata"
                  maxLength={255}
                  value={form.descripcion}
                  onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
                />
                <p className="text-[11px] text-muted-foreground text-right">{form.descripcion.length}/255</p>
              </div>
            </div>

            {/* ── Plantillas ── */}
            <SubSection title="Plantillas base">
              <div className="grid min-w-0 grid-cols-1 gap-2 @xs:grid-cols-2 @lg:grid-cols-3">
                {PLANTILLAS_SITIO.map((plantilla) => {
                  const activa =
                    form.color_primario === plantilla.color_primario &&
                    form.color_fondo === plantilla.color_fondo &&
                    form.color_texto === plantilla.color_texto &&
                    form.border_radius === plantilla.border_radius &&
                    form.button_style === plantilla.button_style
                  const bRad = plantilla.border_radius === "sharp" ? "0px" : plantilla.border_radius === "soft" ? "4px" : "12px"
                  return (
                    <button
                      key={plantilla.id}
                      type="button"
                      onClick={() => aplicarPlantilla(plantilla)}
                      aria-label={`Aplicar plantilla ${plantilla.nombre}`}
                      aria-pressed={activa}
                      className={`group overflow-hidden rounded-xl border text-left transition-all cursor-pointer ${
                        activa ? "border-primary ring-1 ring-primary/30" : "border-border bg-muted/10 hover:border-border/80"
                      }`}
                    >
                      {/* Mini site preview */}
                      <div className="relative h-[68px]" style={{ background: plantilla.color_fondo }}>
                        {/* Navbar */}
                        <div className="absolute inset-x-0 top-0 flex h-[20px] items-center gap-1.5 px-2.5" style={{ background: plantilla.color_primario }}>
                          <div className="h-1 w-8 rounded-full bg-white/40" />
                          <div className="ml-auto h-2.5 w-5 rounded bg-white/20" />
                        </div>
                        {/* Hero body */}
                        <div className="absolute bottom-0 left-0 right-0 px-2.5 pb-2 pt-1">
                          <div className="mb-1 h-1.5 w-2/3 rounded-full opacity-55" style={{ background: plantilla.color_texto }} />
                          <div className="mb-1.5 h-1 w-1/2 rounded-full opacity-30" style={{ background: plantilla.color_texto }} />
                          <div
                            className="inline-flex h-4 w-10 items-center justify-center text-[7px] font-bold"
                            style={{
                              borderRadius: bRad,
                              background: plantilla.button_style === "filled" ? plantilla.color_primario : "transparent",
                              border: `1px solid ${plantilla.color_primario}`,
                              color: plantilla.button_style === "filled" ? "#fff" : plantilla.color_primario,
                            }}
                          >
                            CTA
                          </div>
                        </div>
                        {activa && (
                          <div className="absolute top-[22px] right-1.5 flex h-4 items-center rounded-full bg-primary px-1.5">
                            <span className="text-[9px] font-semibold text-white">✓</span>
                          </div>
                        )}
                      </div>
                      <div className="px-2.5 py-2">
                        <p className="text-[12px] font-semibold text-foreground leading-tight">{plantilla.nombre}</p>
                        <p className="mt-0.5 text-[10px] leading-tight text-muted-foreground line-clamp-2">{plantilla.descripcion}</p>
                      </div>
                    </button>
                  )
                })}
              </div>
            </SubSection>

            {/* ── Colores ── */}
            <SubSection title="Colores">
              <div className="grid grid-cols-2 gap-3">
                <ColorInput
                  label="Primario"
                  value={form.color_primario}
                  onChange={(v) => setForm({ ...form, color_primario: v })}
                  compact
                />
                <ColorInput
                  label="Fondo"
                  value={form.color_fondo}
                  onChange={(v) => setForm({ ...form, color_fondo: v })}
                  compact
                />
                <ColorInput
                  label="Texto"
                  value={form.color_texto}
                  onChange={(v) => setForm({ ...form, color_texto: v })}
                  compact
                />
                <ColorInput
                  label="Cards (opc.)"
                  value={form.color_superficie || form.color_fondo}
                  onChange={(v) => setForm({ ...form, color_superficie: v.toLowerCase() === form.color_fondo.toLowerCase() ? "" : v })}
                  compact
                />
              </div>
              <p className="text-[11px] text-muted-foreground">Primario: botones y acentos. Cards: fondo de las tarjetas (si diferís del fondo general).</p>

              {/* Live micro-preview */}
              <div className="overflow-hidden border border-border/60" style={{ background: form.color_fondo, borderRadius: radiusPx }}>
                <div className="flex h-7 items-center gap-2 px-3" style={{ background: form.navbar_color || form.color_primario }}>
                  <span className="text-[10px] font-bold text-white/90">{form.nombre || "Mi Sitio"}</span>
                  <div className="ml-auto h-3.5 w-12 rounded-md bg-white/20" />
                </div>
                <div className="px-4 py-3.5 flex items-end justify-between gap-3">
                  <div className="space-y-1 flex-1">
                    <div className="h-2 w-2/3 rounded-full opacity-60" style={{ background: form.color_texto }} />
                    <div className="h-1.5 w-1/2 rounded-full opacity-30" style={{ background: form.color_texto }} />
                  </div>
                  <div
                    className="shrink-0 inline-flex h-6 w-20 items-center justify-center text-[9px] font-semibold"
                    style={{
                      borderRadius: radiusPx,
                      background: form.button_style === "filled" ? form.color_primario : "transparent",
                      border: form.button_style !== "ghost" ? `1.5px solid ${form.color_primario}` : "none",
                      color: form.button_style === "filled" ? "#ffffff" : form.color_primario,
                    }}
                  >
                    Comprar
                  </div>
                </div>
              </div>
            </SubSection>

            {/* ── Estilo visual ── */}
            <SubSection title="Estilo visual">
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-[13px] font-medium text-foreground/70">Esquinas</Label>
                  <div className="grid grid-cols-3 gap-1.5 @lg:grid-cols-5">
                    {BORDER_RADIUS_OPTIONS.map((opt) => {
                      const active = form.border_radius === opt.value
                      return (
                        <button
                          key={opt.value || "default"}
                          type="button"
                          onClick={() => setForm({ ...form, border_radius: opt.value })}
                          aria-label={`Esquinas ${opt.label}`}
                          aria-pressed={active}
                          className={`flex flex-col items-center gap-1.5 rounded-lg border px-1 py-2.5 text-center transition-all cursor-pointer ${
                            active ? "border-primary bg-primary/5" : "border-border bg-muted/20 hover:bg-muted/40"
                          }`}
                        >
                          <div className={`h-5 w-8 border-2 border-current opacity-60 ${opt.preview}`} style={{ color: active ? "var(--primary)" : undefined }} />
                          <span className="text-[10px] leading-tight text-muted-foreground">{opt.label}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[13px] font-medium text-foreground/70">Estilo de botones</Label>
                  <div className="grid grid-cols-3 gap-2">
                    {BUTTON_STYLE_OPTIONS.map((opt) => {
                      const active = form.button_style === opt.value
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setForm({ ...form, button_style: opt.value })}
                          aria-label={`Estilo de botones ${opt.label}`}
                          aria-pressed={active}
                          className={`flex flex-col items-center gap-2 rounded-xl border px-3 py-3 transition-all cursor-pointer ${
                            active ? "border-primary bg-primary/5" : "border-border bg-muted/20 hover:bg-muted/40"
                          }`}
                        >
                          <div
                            className="flex h-6 w-16 items-center justify-center text-[9px] font-semibold"
                            style={{
                              borderRadius: radiusPx,
                              background: opt.value === "filled" ? form.color_primario : "transparent",
                              border: opt.value !== "ghost" ? `1.5px solid ${form.color_primario}` : "none",
                              color: opt.value === "filled" ? "#fff" : form.color_primario,
                            }}
                          >
                            Comprar
                          </div>
                          <div className="text-center">
                            <p className="text-[11px] font-medium text-foreground">{opt.label}</p>
                            <p className="text-[10px] text-muted-foreground">{opt.desc}</p>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
            </SubSection>

            {/* ── Tipografía ── */}
            <SubSection title="Tipografía">
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-[13px] font-medium text-foreground/70">Fuente del cuerpo</Label>
                  <FontPicker value={form.font} onChange={(v) => setForm({ ...form, font: v })} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[13px] font-medium text-foreground/70">Fuente de títulos <span className="text-muted-foreground font-normal">(opcional)</span></Label>
                  <FontPicker value={form.heading_font} onChange={(v) => setForm({ ...form, heading_font: v })} forHeading />
                  <p className="text-[11px] text-muted-foreground">Una fuente de título diferente al cuerpo agrega carácter. Dejá &quot;Igual&quot; para uniformidad.</p>
                </div>
              </div>
            </SubSection>

            {/* ── Navbar ── */}
            <SubSection title="Navbar superior">
              <div className="space-y-3">
                <div className="flex min-w-0 items-center gap-2">
                  <Select value={form.navbar_size} onValueChange={(value) => setForm({ ...form, navbar_size: value as "small" | "medium" | "large" })}>
                    <SelectTrigger className="h-9 flex-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="small">Chico</SelectItem>
                      <SelectItem value="medium">Mediano</SelectItem>
                      <SelectItem value="large">Grande</SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="color"
                      value={form.navbar_color || form.color_primario}
                      onChange={(e) => {
                        const nextColor = e.target.value
                        setForm({ ...form, navbar_color: nextColor.toLowerCase() === form.color_primario.toLowerCase() ? "" : nextColor })
                      }}
                      className="h-9 w-10 shrink-0 rounded-lg border border-border cursor-pointer bg-card p-1"
                      aria-label="Color del navbar"
                      title="Color del navbar"
                    />
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => setConfirmNavbarSyncOpen(true)}
                          disabled={!hasNavbarColorOverride}
                          className="h-9 w-9 shrink-0 rounded-lg border border-border bg-card flex items-center justify-center text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                          aria-label="Sincronizar con color principal"
                        >
                          <RotateCcw className="h-4 w-4" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>Sincronizar con color principal</TooltipContent>
                    </Tooltip>
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground">Tamaño del navbar · color de fondo (el picker). Si el color coincide con el primario, queda sincronizado.</p>

                {/* Tamaño del logo, independiente del navbar: un logo horizontal
                    necesita más alto que uno cuadrado para leerse igual. */}
                <div className="flex min-w-0 items-center gap-2">
                  <span className="shrink-0 text-xs text-muted-foreground">Logo</span>
                  <Select
                    value={form.logo_size || "auto"}
                    onValueChange={(value) => setForm({ ...form, logo_size: value === "auto" ? "" : (value as "small" | "medium" | "large" | "xl") })}
                  >
                    <SelectTrigger className="h-9 flex-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Automático</SelectItem>
                      <SelectItem value="small">Chico</SelectItem>
                      <SelectItem value="medium">Mediano</SelectItem>
                      <SelectItem value="large">Grande</SelectItem>
                      <SelectItem value="xl">Extra grande</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Tamaño del logo en el navbar. Se adapta solo a mobile. En <b>Automático</b> sigue al tamaño del navbar.
                  Si tu logo tiene margen transparente en el archivo, se va a ver chico igual: recortalo antes de subirlo.
                </p>
                <div className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-muted/10 px-3 py-2.5">
                  <div>
                    <p className="text-[13px] font-medium text-foreground">Efecto glass / blur</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">Navbar translúcida con desenfoque. Se ve mejor con banners de fondo.</p>
                  </div>
                  <Switch
                    checked={form.navbar_blur}
                    onCheckedChange={(checked) => setForm({ ...form, navbar_blur: checked })}
                  />
                </div>
              </div>
            </SubSection>

          </div>
        </SectionCard>

        <Dialog open={confirmNavbarSyncOpen} onOpenChange={setConfirmNavbarSyncOpen}>
          <DialogContent className="bg-card sm:max-w-sm p-6">
            <DialogHeader>
              <DialogTitle className="text-foreground">¿Sincronizar navbar?</DialogTitle>
              <DialogDescription className="sr-only">Confirmar sincronización del color del navbar con el color principal</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="flex items-start gap-3 rounded-xl border border-border/60 bg-muted/30 p-4">
                <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5 text-foreground" />
                <div>
                  <p className="text-sm font-semibold text-foreground mb-1">Se va a quitar el color personalizado</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    El navbar volverá a usar y seguir automáticamente el color principal del sitio.
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" className="flex-1 h-10" onClick={() => setConfirmNavbarSyncOpen(false)}>
                  Cancelar
                </Button>
                <Button
                  type="button"
                  className="flex-1 h-10"
                  onClick={() => {
                    setForm({ ...form, navbar_color: "" })
                    setConfirmNavbarSyncOpen(false)
                  }}
                >
                  Sincronizar
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </>
    </TooltipProvider>
  )
}

export function ImagenesSection({ form, setForm }: { form: SitioVentaForm; setForm: React.Dispatch<React.SetStateAction<SitioVentaForm>> }) {
  function updateBanner(index: number, value: string) {
    const nextBanners = [...form.banners]
    nextBanners[index] = value
    setForm({ ...form, banners: nextBanners })
  }

  function removeBanner(index: number) {
    setForm({
      ...form,
      banners: form.banners.filter((_, bannerIndex) => bannerIndex !== index),
    })
  }

  function addBanner() {
    setForm({
      ...form,
      banners: [...form.banners, ""],
    })
  }

  return (
      <SectionCard icon={Image} title="Imágenes" subtitle="Logo y banners principales">
        <div className="space-y-4">
          <div className="space-y-4">
            <ImageUploadInput
              label="Logo"
              value={form.logo_url}
              onChange={(url) => setForm({ ...form, logo_url: url })}
              type="logo"
              aspect="square"
              description="Aparece en el navbar del sitio público. Recomendado: cuadrado, mínimo 256×256"
            />

            <ImageUploadInput
              label="Favicon (ícono de la pestaña)"
              value={form.favicon_url}
              onChange={(url) => setForm({ ...form, favicon_url: url })}
              type="logo"
              aspect="square"
              description="Aparece en la pestaña del navegador y en bookmarks. Recomendado: cuadrado 64×64 o 128×128, fondo transparente. Si no lo subís, se usa el logo del navbar como respaldo."
            />

            <div className="space-y-1.5">
              <Label className="text-[13px] font-medium text-foreground/70">Presentación</Label>
              <Select value={form.banner_variant} onValueChange={(value) => setForm({ ...form, banner_variant: value as "blurred" | "full" })}>
                <SelectTrigger className="h-10 w-full">
                  <SelectValue />
                </SelectTrigger>
              <SelectContent>
                <SelectItem value="blurred">Normal — contenido dentro de un ancho cuidado, sin deformar la imagen</SelectItem>
                <SelectItem value="full">Estirar a pantalla — ocupa todo el ancho y le da más protagonismo</SelectItem>
              </SelectContent>
            </Select>
          </div>

            <div className="space-y-3">
               <div className="flex flex-col gap-3 @sm:flex-row @sm:items-start @sm:justify-between">
                <div>
                  <p className="text-[15px] font-semibold tracking-tight text-foreground">Banners</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Solo imagen. Para banners con texto y CTA, configurá la sección &quot;Banners&quot; en el tab Home.</p>
                </div>
                 <Button type="button" variant="outline" onClick={addBanner} disabled={form.banners.length >= 5} className="w-full @sm:w-auto">
                  <Plus className="h-4 w-4" /> Agregar banner
                </Button>
              </div>

              {form.banners.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
                  Todavía no cargaste banners.
                </div>
              ) : (
                <div className="space-y-4">
                  {form.banners.map((banner, index) => (
                    <div key={`banner-${index}`} className="flex flex-col gap-2 @sm:flex-row @sm:items-start">
                      <div className="min-w-0 flex-1">
                        <ImageUploadInput
                          label={`Banner ${index + 1}`}
                          value={banner}
                          onChange={(url) => updateBanner(index, url)}
                          type="banner"
                          aspect="wide"
                        />
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="shrink-0 @sm:mt-7"
                        onClick={() => removeBanner(index)}
                        disabled={form.banners.length === 1 && !banner.trim()}
                        aria-label={`Eliminar banner ${index + 1}`}
                      >
                        <Trash2 aria-hidden="true" className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </SectionCard>
  )
}
