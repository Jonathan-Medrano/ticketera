"use client"

import { Fragment, useEffect, useRef, useState } from "react"
import { ChevronDown, ChevronUp, Eye, EyeOff, FileText, GripVertical, Image, ImageIcon, LayoutTemplate, MapPin, Plus, Quote, Star, Timer, Trash2, Video } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ImageUploadInput } from "@/components/dashboard/image-upload-input"
import { RichTextEditor } from "./rich-text-editor"
import { hasMeaningfulRichText } from "@/lib/tenant-rich-text"
import type { EventoPasadoOption } from "./types"
import {
  createTenantHomeBannerItem,
  createTenantHomeBannersGroupSection,
  createTenantHomeCountdownSection,
  createTenantHomeEventosSection,
  createTenantHomeGaleriaSection,
  createTenantHomeMapaSection,
  createTenantHomeSponsorsCarouselSection,
  createTenantHomeSponsorItem,
  createTenantHomeTestimonioItem,
  createTenantHomeTestimoniosSection,
  createTenantHomeTextoLibreSection,
  createTenantHomeVideoEmbedSection,
  hasRenderableMapaContent,
  MAX_TESTIMONIOS,
  parseTenantHomeVideoEmbedUrl,
  type TenantHomeBannerItem,
  type TenantHomeBannersGroupSection,
  type TenantHomeCountdownSection,
  type TenantHomeMapaSection,
  type TenantHomeSection,
  type TenantHomeSponsorsCarouselSection,
  type TenantHomeSponsorItem,
  type TenantHomeTestimonioItem,
  type TenantHomeTestimoniosSection,
  type TenantHomeTextoLibreSection,
  type TenantHomeVideoEmbedSection,
} from "@/lib/tenant-home-sections"
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
import type { GaleriaFotoItem } from "./types"

export type { TenantHomeSection }

// Radix Select no admite value="" en un SelectItem — sentinel para "sin vincular"
// que se mapea a evento_id: "" (unlinked) al leer/escribir el estado del form.
const NO_EVENTO_VALUE = "__sin_vincular__"

const DEFAULT_SECTIONS: TenantHomeSection[] = [
  createTenantHomeEventosSection(),
  createTenantHomeGaleriaSection(),
  createTenantHomeBannersGroupSection(),
  createTenantHomeSponsorsCarouselSection("section-sponsors"),
]

// Renderiza el ícono de la sección directamente (sin aliasear a un componente
// creado durante el render → react-hooks/static-components).
function SectionIcon({ type, className }: { type: TenantHomeSection["type"]; className?: string }) {
  switch (type) {
    case "galeria": return <ImageIcon className={className} />
    case "banners_group": return <Image className={className} />
    case "auspiciantes_carousel": return <Star className={className} />
    case "texto_libre": return <FileText className={className} />
    case "countdown": return <Timer className={className} />
    case "video_embed": return <Video className={className} />
    case "mapa": return <MapPin className={className} />
    case "testimonios": return <Quote className={className} />
    case "eventos":
    default: return <LayoutTemplate className={className} />
  }
}

function getSectionLabel(type: TenantHomeSection["type"]) {
  switch (type) {
    case "eventos": return "Eventos"
    case "galeria": return "Galería"
    case "banners_group": return "Banners"
    case "banner": return "Banner"
    case "auspiciantes_carousel": return "Carrusel de sponsors"
    case "texto_libre": return "Texto libre"
    case "countdown": return "Cuenta regresiva"
    case "video_embed": return "Video"
    case "mapa": return "Mapa / ubicación"
    case "testimonios": return "Testimonios"
    default: return "Sección"
  }
}

function SectionRowContent({
  section,
  galeria_fotos,
  onGaleriaChange,
  onChange,
  canEdit,
  eventosPasados,
}: {
  section: TenantHomeSection
  galeria_fotos: GaleriaFotoItem[]
  onGaleriaChange: (fotos: GaleriaFotoItem[]) => void
  onChange: (section: TenantHomeSection) => void
  canEdit: boolean
  eventosPasados: EventoPasadoOption[]
}) {
  if (section.type === "eventos") {
    return (
      <p className="text-sm text-muted-foreground">
        Muestra todos los eventos publicados en el sitio.
      </p>
    )
  }

  if (section.type === "galeria") {
    function addFoto() {
      if (galeria_fotos.length >= 20) return
      onGaleriaChange([...galeria_fotos, { id: crypto.randomUUID(), url: "", titulo: "", visible: true }])
    }
    function updateFoto(index: number, next: GaleriaFotoItem) {
      const nextGaleria = [...galeria_fotos]
      nextGaleria[index] = next
      onGaleriaChange(nextGaleria)
    }
    function removeFoto(index: number) {
      onGaleriaChange(galeria_fotos.filter((_, i) => i !== index))
    }
    return (
      <div className="space-y-4">
        <div className="flex flex-col gap-3 @sm:flex-row @sm:items-start @sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-foreground">Fotos</p>
            <p className="text-xs text-muted-foreground mt-0.5">Máximo 20 fotos. Podés ocultarlas sin borrarlas.</p>
          </div>
          <Button type="button" variant="outline" onClick={addFoto} disabled={galeria_fotos.length >= 20 || !canEdit} className="w-full @sm:w-auto">
            <Plus className="h-4 w-4" /> Agregar foto
          </Button>
        </div>
        {galeria_fotos.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
            Todavía no cargaste fotos.
          </div>
        ) : (
          <div className="space-y-2.5">
            {galeria_fotos.map((foto, i) => (
              <div key={foto.id} className="min-w-0 overflow-hidden rounded-xl border border-border/60 bg-card p-4 space-y-3">
                <div className="flex flex-col gap-3 @sm:flex-row @sm:items-center @sm:justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    {foto.url.trim() ? (
                      <img src={foto.url} alt="" className="h-8 w-8 rounded object-cover shrink-0" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none" }} />
                    ) : (
                      <div className="h-8 w-8 rounded border border-border bg-muted/50 shrink-0" />
                    )}
                    <div className="space-y-0.5 min-w-0">
                      <p className="text-sm font-semibold text-foreground">Foto {i + 1}</p>
                      <p className="text-xs text-muted-foreground">{foto.visible ? "Visible en público." : "Oculta, no se muestra."}</p>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 @sm:flex-row @sm:flex-wrap @sm:items-center @sm:justify-end">
                    <Badge variant={foto.visible ? "default" : "outline"} className="inline-flex h-8 items-center rounded-xl px-3 text-sm font-medium">
                      {foto.visible ? "Visible" : "Oculta"}
                    </Badge>
                    <button type="button" onClick={() => updateFoto(i, { ...foto, visible: !foto.visible })} className="inline-flex h-8 w-full items-center justify-center gap-2 rounded-xl border border-border bg-background px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted @sm:w-auto">
                      {foto.visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      {foto.visible ? "Ocultar" : "Mostrar"}
                    </button>
                    <button type="button" onClick={() => removeFoto(i)} className="inline-flex h-8 w-full items-center justify-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10 @sm:w-auto">
                      <Trash2 className="h-4 w-4" /> Eliminar
                    </button>
                  </div>
                </div>
                <ImageUploadInput
                  label="Imagen"
                  value={foto.url}
                  onChange={(url) => updateFoto(i, { ...foto, url })}
                  type="galeria"
                  aspect="card"
                />
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Título (opcional)</Label>
                  <Input className="h-10" placeholder="Ej: Noche de apertura" value={foto.titulo} onChange={(e) => updateFoto(i, { ...foto, titulo: e.target.value })} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  if (section.type === "banners_group") {
    const sect = section as TenantHomeBannersGroupSection
    function addBanner() {
      if (sect.banners.length >= 10) return
      onChange({ ...sect, banners: [...sect.banners, createTenantHomeBannerItem()] })
    }
    function updateBanner(index: number, next: TenantHomeBannerItem) {
      const next_banners = [...sect.banners]
      next_banners[index] = next
      onChange({ ...sect, banners: next_banners })
    }
    function removeBanner(index: number) {
      onChange({ ...sect, banners: sect.banners.filter((_, i) => i !== index) })
    }
    return (
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Ancho</Label>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!canEdit}
              onClick={() => onChange({ ...sect, variant: "normal" as const })}
              aria-pressed={sect.variant !== "full"}
              className={`inline-flex h-8 items-center rounded-xl border px-3 text-sm font-medium transition-colors disabled:opacity-50 ${sect.variant !== "full" ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-foreground hover:bg-muted"}`}
            >
              Normal
            </button>
            <button
              type="button"
              disabled={!canEdit}
              onClick={() => onChange({ ...sect, variant: "full" as const })}
              aria-pressed={sect.variant === "full"}
              className={`inline-flex h-8 items-center rounded-xl border px-3 text-sm font-medium transition-colors disabled:opacity-50 ${sect.variant === "full" ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-foreground hover:bg-muted"}`}
            >
              Pantalla completa
            </button>
          </div>
        </div>
        <div className="flex flex-col gap-3 @sm:flex-row @sm:items-start @sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-foreground">Banners de contenido</p>
            <p className="text-xs text-muted-foreground mt-0.5">Máximo 10 banners. Cada uno puede tener título, subtítulo, imagen y un botón de acción.</p>
          </div>
          <Button type="button" variant="outline" onClick={addBanner} disabled={sect.banners.length >= 10 || !canEdit} className="w-full @sm:w-auto">
            <Plus className="h-4 w-4" /> Agregar banner
          </Button>
        </div>
        {sect.banners.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
            Todavía no cargaste banners de contenido.
          </div>
        ) : (
          <div className="space-y-2.5">
            {sect.banners.map((banner, i) => (
              <div key={banner.id} className="min-w-0 overflow-hidden rounded-xl border border-border/60 bg-card p-4 space-y-3">
                <div className="flex flex-col gap-3 @sm:flex-row @sm:items-center @sm:justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    {banner.image_url.trim() ? (
                      <img src={banner.image_url} alt="" className="h-10 w-10 rounded object-cover shrink-0" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none" }} />
                    ) : (
                      <div className="h-10 w-10 rounded border border-border bg-muted/50 shrink-0" />
                    )}
                    <p className="text-sm font-semibold text-foreground">Banner {i + 1}</p>
                  </div>
                  <div className="flex flex-col gap-2 @sm:flex-row @sm:items-center @sm:justify-end">
                    <Badge variant={banner.visible ? "default" : "outline"} className="inline-flex h-8 items-center rounded-xl px-3 text-sm font-medium">
                      {banner.visible ? "Visible" : "Oculto"}
                    </Badge>
                    <button type="button" onClick={() => updateBanner(i, { ...banner, visible: !banner.visible })} className="inline-flex h-8 w-full items-center justify-center gap-2 rounded-xl border border-border bg-background px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted @sm:w-auto">
                      {banner.visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      {banner.visible ? "Ocultar" : "Mostrar"}
                    </button>
                    <button type="button" onClick={() => removeBanner(i)} className="inline-flex h-8 w-full items-center justify-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10 @sm:w-auto">
                      <Trash2 className="h-4 w-4" /> Eliminar
                    </button>
                  </div>
                </div>
                <ImageUploadInput
                  label="Imagen del banner"
                  value={banner.image_url}
                  onChange={(url) => updateBanner(i, { ...banner, image_url: url })}
                  type="banner"
                  aspect="wide"
                />
                <div className="grid gap-3 @md:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Título</Label>
                    <Input className="h-10" placeholder="Ej: Gran evento de verano" value={banner.title} onChange={(e) => updateBanner(i, { ...banner, title: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Subtítulo</Label>
                    <Input className="h-10" placeholder="Ej: No te lo pierdas" value={banner.subtitle} onChange={(e) => updateBanner(i, { ...banner, subtitle: e.target.value })} />
                  </div>
                </div>
                <div className="grid gap-3 @md:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Texto del botón CTA</Label>
                    <Input className="h-10" placeholder="Ver más" value={banner.cta_label} onChange={(e) => updateBanner(i, { ...banner, cta_label: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">URL del botón CTA</Label>
                    <Input className="h-10" placeholder="https://..." value={banner.cta_href} onChange={(e) => updateBanner(i, { ...banner, cta_href: e.target.value })} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  if (section.type === "auspiciantes_carousel") {
    const carousel = section as TenantHomeSponsorsCarouselSection
    function updateCarousel(next: TenantHomeSponsorsCarouselSection) {
      onChange(next)
    }
    function addSponsor() {
      if (carousel.sponsors.length >= 12) return
      updateCarousel({ ...carousel, sponsors: [...carousel.sponsors, createTenantHomeSponsorItem()] })
    }
    function updateSponsor(index: number, next: TenantHomeSponsorItem) {
      const next_sponsors = [...carousel.sponsors]
      next_sponsors[index] = next
      updateCarousel({ ...carousel, sponsors: next_sponsors })
    }
    function removeSponsor(index: number) {
      updateCarousel({ ...carousel, sponsors: carousel.sponsors.filter((_, i) => i !== index) })
    }
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-border/60 bg-card p-4 space-y-3">
          <p className="text-sm font-semibold text-foreground">Encabezado del carrusel</p>
          <div className="grid gap-3 @md:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Título</Label>
              <Input className="h-10" placeholder="Nuestros sponsors" value={carousel.title} onChange={(e) => updateCarousel({ ...carousel, title: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Subtítulo</Label>
              <Input className="h-10" placeholder="Ej: Gracias a quienes hacen esto posible" value={carousel.subtitle} onChange={(e) => updateCarousel({ ...carousel, subtitle: e.target.value })} />
            </div>
          </div>
        </div>
        <div className="space-y-3">
          <div className="flex flex-col gap-3 @sm:flex-row @sm:items-start @sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-foreground">Sponsors</p>
              <p className="text-xs text-muted-foreground mt-0.5">Máximo 12 sponsors.</p>
            </div>
            <Button type="button" variant="outline" onClick={addSponsor} disabled={carousel.sponsors.length >= 12 || !canEdit} className="w-full @sm:w-auto">
              <Plus className="h-4 w-4" /> Agregar sponsor
            </Button>
          </div>
          {carousel.sponsors.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
              Todavía no cargaste sponsors.
            </div>
          ) : (
            <div className="space-y-2.5">
              {carousel.sponsors.map((sponsor, i) => (
                <div key={sponsor.id} className="min-w-0 overflow-hidden rounded-xl border border-border/60 bg-card p-4 space-y-3">
                  <div className="flex flex-col gap-3 @sm:flex-row @sm:items-center @sm:justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      {sponsor.logo_url.trim() ? (
                        <img src={sponsor.logo_url} alt="" className="h-8 w-8 rounded object-contain shrink-0" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none" }} />
                      ) : (
                        <div className="h-8 w-8 rounded border border-border bg-muted/50 shrink-0" />
                      )}
                      <p className="text-sm font-semibold text-foreground">Sponsor {i + 1}</p>
                    </div>
                    <button type="button" onClick={() => removeSponsor(i)} className="inline-flex h-8 w-full items-center justify-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10 @sm:w-auto">
                      <Trash2 className="h-4 w-4" /> Eliminar
                    </button>
                  </div>
                  <ImageUploadInput
                    label="Logo"
                    value={sponsor.logo_url}
                    onChange={(url) => updateSponsor(i, { ...sponsor, logo_url: url })}
                    type="sponsor"
                    aspect="square"
                  />
                  <div className="grid gap-3 @md:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Nombre</Label>
                      <Input className="h-10" placeholder="Ej: Coca-Cola" value={sponsor.name} onChange={(e) => updateSponsor(i, { ...sponsor, name: e.target.value })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">URL destino (opcional)</Label>
                      <Input className="h-10" placeholder="https://..." value={sponsor.href} onChange={(e) => updateSponsor(i, { ...sponsor, href: e.target.value })} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  if (section.type === "texto_libre") {
    const sect = section as TenantHomeTextoLibreSection
    return (
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Título (opcional)</Label>
          <Input
            className="h-10"
            placeholder="Ej: Nuestra historia"
            value={sect.titulo}
            onChange={(e) => onChange({ ...sect, titulo: e.target.value })}
            disabled={!canEdit}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Contenido</Label>
          <RichTextEditor
            value={sect.contenido_html}
            onChange={(html) => onChange({ ...sect, contenido_html: html })}
            placeholder="Contá algo sobre tu lugar, tu propuesta o lo que quieras compartir…"
            editable={canEdit}
            minHeight="200px"
          />
        </div>
      </div>
    )
  }

  if (section.type === "countdown") {
    const sect = section as TenantHomeCountdownSection
    return (
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Título (opcional)</Label>
          <Input
            className="h-10"
            placeholder="Ej: Faltan para la fiesta"
            value={sect.titulo}
            onChange={(e) => onChange({ ...sect, titulo: e.target.value })}
            disabled={!canEdit}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Cuenta hacia</Label>
          <div className="flex flex-col gap-2 @sm:flex-row">
            <button
              type="button"
              disabled={!canEdit}
              onClick={() => onChange({ ...sect, modo: "proximo_evento" as const })}
              aria-pressed={sect.modo !== "fecha_manual"}
              className={`inline-flex h-9 items-center justify-center rounded-xl border px-3 text-sm font-medium transition-colors disabled:opacity-50 ${sect.modo !== "fecha_manual" ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-foreground hover:bg-muted"}`}
            >
              Próximo evento (automático)
            </button>
            <button
              type="button"
              disabled={!canEdit}
              onClick={() => onChange({ ...sect, modo: "fecha_manual" as const })}
              aria-pressed={sect.modo === "fecha_manual"}
              className={`inline-flex h-9 items-center justify-center rounded-xl border px-3 text-sm font-medium transition-colors disabled:opacity-50 ${sect.modo === "fecha_manual" ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-foreground hover:bg-muted"}`}
            >
              Fecha manual
            </button>
          </div>
          {sect.modo === "proximo_evento" ? (
            <p className="text-xs text-muted-foreground">
              Usa la fecha del próximo evento publicado con venta abierta. Si no hay ninguno, este bloque no se muestra en el sitio.
            </p>
          ) : (
            <div className="space-y-1.5 pt-1">
              <Label className="text-xs text-muted-foreground">Fecha y hora (Argentina)</Label>
              <Input
                type="datetime-local"
                className="h-10"
                value={sect.fecha_manual}
                onChange={(e) => onChange({ ...sect, fecha_manual: e.target.value })}
                disabled={!canEdit}
              />
            </div>
          )}
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Mensaje al llegar a cero (opcional)</Label>
          <Input
            className="h-10"
            placeholder="Ej: ¡Ya arrancamos!"
            value={sect.texto_finalizado}
            onChange={(e) => onChange({ ...sect, texto_finalizado: e.target.value })}
            disabled={!canEdit}
          />
        </div>
      </div>
    )
  }

  if (section.type === "video_embed") {
    const sect = section as TenantHomeVideoEmbedSection
    const trimmedUrl = sect.url.trim()
    const parsed = trimmedUrl ? parseTenantHomeVideoEmbedUrl(trimmedUrl) : null
    return (
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">URL del video</Label>
          <Input
            className="h-10"
            placeholder="https://youtube.com/watch?v=... o https://instagram.com/reel/..."
            value={sect.url}
            onChange={(e) => onChange({ ...sect, url: e.target.value })}
            disabled={!canEdit}
          />
          {trimmedUrl && !parsed && (
            <p className="text-xs font-medium text-destructive">
              No pudimos reconocer esa URL, pegá un link de YouTube o Instagram.
            </p>
          )}
          {parsed && (
            <p className="text-xs text-muted-foreground">
              Reconocido como {parsed.provider === "youtube" ? "video de YouTube" : "publicación de Instagram"}.
            </p>
          )}
          {!trimmedUrl && (
            <p className="text-xs text-muted-foreground">
              Pegá un link de YouTube (video o short) o Instagram (post o reel). No hace falta ninguna API key.
            </p>
          )}
        </div>
      </div>
    )
  }

  if (section.type === "mapa") {
    const sect = section as TenantHomeMapaSection
    return (
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Dirección</Label>
          <Input
            className="h-10"
            placeholder="Ej: Av. Corrientes 1234, CABA"
            value={sect.direccion}
            onChange={(e) => onChange({ ...sect, direccion: e.target.value })}
            disabled={!canEdit}
          />
        </div>
        <div className="grid gap-3 @md:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Latitud (opcional)</Label>
            <Input
              type="number"
              step="any"
              className="h-10"
              placeholder="Ej: -34.6037"
              value={sect.lat}
              onChange={(e) => onChange({ ...sect, lat: e.target.value })}
              disabled={!canEdit}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Longitud (opcional)</Label>
            <Input
              type="number"
              step="any"
              className="h-10"
              placeholder="Ej: -58.3816"
              value={sect.lng}
              onChange={(e) => onChange({ ...sect, lng: e.target.value })}
              disabled={!canEdit}
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {hasRenderableMapaContent(sect)
            ? sect.lat.trim() && sect.lng.trim()
              ? "Se muestra el mapa interactivo con la ubicación exacta."
              : "Se muestra la dirección con un botón \"Cómo llegar\". Completá lat/lng para mostrar el mapa interactivo."
            : "Cargá al menos la dirección para que este bloque se muestre en el sitio."}
        </p>
      </div>
    )
  }

  if (section.type === "testimonios") {
    const sect = section as TenantHomeTestimoniosSection
    function addTestimonio() {
      if (sect.testimonios.length >= MAX_TESTIMONIOS) return
      onChange({ ...sect, testimonios: [...sect.testimonios, createTenantHomeTestimonioItem()] })
    }
    function updateTestimonio(index: number, next: TenantHomeTestimonioItem) {
      const next_testimonios = [...sect.testimonios]
      next_testimonios[index] = next
      onChange({ ...sect, testimonios: next_testimonios })
    }
    function removeTestimonio(index: number) {
      onChange({ ...sect, testimonios: sect.testimonios.filter((_, i) => i !== index) })
    }
    function moveTestimonio(index: number, direction: -1 | 1) {
      const target = index + direction
      if (target < 0 || target >= sect.testimonios.length) return
      const next_testimonios = [...sect.testimonios]
      const [moved] = next_testimonios.splice(index, 1)
      next_testimonios.splice(target, 0, moved)
      onChange({ ...sect, testimonios: next_testimonios })
    }
    return (
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Título (opcional)</Label>
          <Input
            className="h-10"
            placeholder="Ej: Lo que dicen de nosotros"
            value={sect.titulo}
            onChange={(e) => onChange({ ...sect, titulo: e.target.value })}
            disabled={!canEdit}
          />
        </div>
        <div className="flex flex-col gap-3 @sm:flex-row @sm:items-start @sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-foreground">Testimonios</p>
            <p className="text-xs text-muted-foreground mt-0.5">Máximo {MAX_TESTIMONIOS}. Necesitan nombre y texto para mostrarse.</p>
          </div>
          <Button type="button" variant="outline" onClick={addTestimonio} disabled={sect.testimonios.length >= MAX_TESTIMONIOS || !canEdit} className="w-full @sm:w-auto">
            <Plus className="h-4 w-4" /> Agregar testimonio
          </Button>
        </div>
        {sect.testimonios.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
            Todavía no cargaste testimonios.
          </div>
        ) : (
          <div className="space-y-2.5">
            {sect.testimonios.map((testimonio, i) => (
              <div key={testimonio.id} className="min-w-0 overflow-hidden rounded-xl border border-border/60 bg-card p-4 space-y-3">
                <div className="flex flex-col gap-3 @sm:flex-row @sm:items-center @sm:justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    {testimonio.url_foto.trim() ? (
                      <img src={testimonio.url_foto} alt="" className="h-8 w-8 rounded-full object-cover shrink-0" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none" }} />
                    ) : (
                      <div className="h-8 w-8 rounded-full border border-border bg-muted/50 shrink-0" />
                    )}
                    <p className="text-sm font-semibold text-foreground">Testimonio {i + 1}</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={!canEdit || i === 0}
                      onClick={() => moveTestimonio(i, -1)}
                      className="h-8 w-8 shrink-0 flex items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
                      aria-label="Subir testimonio"
                    >
                      <ChevronUp className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      disabled={!canEdit || i === sect.testimonios.length - 1}
                      onClick={() => moveTestimonio(i, 1)}
                      className="h-8 w-8 shrink-0 flex items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
                      aria-label="Bajar testimonio"
                    >
                      <ChevronDown className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      disabled={!canEdit}
                      onClick={() => removeTestimonio(i)}
                      className="inline-flex h-8 items-center justify-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
                    >
                      <Trash2 className="h-4 w-4" /> Eliminar
                    </button>
                  </div>
                </div>
                <ImageUploadInput
                  label="Foto (opcional)"
                  value={testimonio.url_foto}
                  onChange={(url) => updateTestimonio(i, { ...testimonio, url_foto: url })}
                  type="sponsor"
                  aspect="square"
                />
                <div className="grid gap-3 @md:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Nombre</Label>
                    <Input
                      className="h-10"
                      placeholder="Ej: María Gómez"
                      value={testimonio.nombre}
                      onChange={(e) => updateTestimonio(i, { ...testimonio, nombre: e.target.value })}
                      disabled={!canEdit}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Rol / organización (opcional)</Label>
                    <Input
                      className="h-10"
                      placeholder="Ej: Productora de La Fiesta"
                      value={testimonio.rol}
                      onChange={(e) => updateTestimonio(i, { ...testimonio, rol: e.target.value })}
                      disabled={!canEdit}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Texto</Label>
                  <Textarea
                    className="min-h-[80px] resize-none"
                    rows={3}
                    placeholder="Ej: La mejor fiesta a la que fui este año, todo perfecto de principio a fin."
                    value={testimonio.texto}
                    onChange={(e) => updateTestimonio(i, { ...testimonio, texto: e.target.value })}
                    disabled={!canEdit}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Vincular a un evento (opcional)</Label>
                  {eventosPasados.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Todavía no tenés eventos finalizados para vincular.
                    </p>
                  ) : (
                    <>
                      <Select
                        value={testimonio.evento_id?.trim() ? testimonio.evento_id : NO_EVENTO_VALUE}
                        onValueChange={(value) => updateTestimonio(i, { ...testimonio, evento_id: value === NO_EVENTO_VALUE ? "" : value })}
                        disabled={!canEdit}
                      >
                        <SelectTrigger className="h-10 w-full bg-background">
                          <SelectValue placeholder="Sin vincular" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NO_EVENTO_VALUE}>Sin vincular</SelectItem>
                          {eventosPasados.map((evento) => (
                            <SelectItem key={evento.id} value={evento.id}>
                              {evento.nombre}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Si vinculás un evento, la card pública muestra su imagen de portada y su nombre en vez del avatar genérico.
                      </p>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  return null
}

function SectionRow({
  section,
  galeria_fotos,
  onGaleriaChange,
  onSectionChange,
  onToggleVisible,
  onDelete,
  label,
  canEdit,
  eventosPasados,
}: {
  section: TenantHomeSection
  galeria_fotos: GaleriaFotoItem[]
  onGaleriaChange: (fotos: GaleriaFotoItem[]) => void
  onSectionChange: (section: TenantHomeSection) => void
  onToggleVisible: () => void
  onDelete?: () => void
  label?: string
  canEdit: boolean
  eventosPasados: EventoPasadoOption[]
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: section.id })
  const [expanded, setExpanded] = useState(false)
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }
  const visible = (section as { visible?: boolean }).visible !== false

  return (
    <div ref={setNodeRef} style={style} className="border border-border/60 rounded-xl bg-muted/30 overflow-hidden">
      <div className="flex items-center gap-2 p-3">
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="h-8 w-8 shrink-0 flex items-center justify-center rounded-lg border border-border bg-background text-muted-foreground cursor-grab active:cursor-grabbing"
          aria-label="Reordenar sección"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <SectionIcon type={section.type} className="h-4 w-4 text-muted-foreground shrink-0" />
        <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
          <p className="text-sm font-semibold text-foreground">{label ?? getSectionLabel(section.type)}</p>
          {!expanded && (() => {
            if (section.type === "texto_libre") {
              const hasContent = hasMeaningfulRichText((section as TenantHomeTextoLibreSection).contenido_html)
              return (
                <span className="text-xs text-muted-foreground bg-muted/50 border border-border rounded-full px-2 py-0.5">
                  {hasContent ? "Con contenido" : "Sin contenido"}
                </span>
              )
            }
            if (section.type === "countdown") {
              const c = section as TenantHomeCountdownSection
              const badgeLabel = c.modo === "fecha_manual"
                ? (c.fecha_manual ? "Fecha manual" : "Fecha manual (sin definir)")
                : "Próximo evento"
              return (
                <span className="text-xs text-muted-foreground bg-muted/50 border border-border rounded-full px-2 py-0.5">
                  {badgeLabel}
                </span>
              )
            }
            if (section.type === "video_embed") {
              const v = section as TenantHomeVideoEmbedSection
              const parsed = v.url.trim() ? parseTenantHomeVideoEmbedUrl(v.url) : null
              const badgeLabel = !v.url.trim() ? "Sin URL" : parsed ? (parsed.provider === "youtube" ? "YouTube" : "Instagram") : "URL no reconocida"
              return (
                <span className="text-xs text-muted-foreground bg-muted/50 border border-border rounded-full px-2 py-0.5">
                  {badgeLabel}
                </span>
              )
            }
            if (section.type === "mapa") {
              const m = section as TenantHomeMapaSection
              const badgeLabel = hasRenderableMapaContent(m) ? (m.lat.trim() && m.lng.trim() ? "Con mapa interactivo" : "Solo dirección") : "Sin contenido"
              return (
                <span className="text-xs text-muted-foreground bg-muted/50 border border-border rounded-full px-2 py-0.5">
                  {badgeLabel}
                </span>
              )
            }

            let count: number | null = null
            let label = ""
            if (section.type === "galeria") {
              count = galeria_fotos.length
              label = count === 1 ? "1 foto" : `${count} fotos`
            } else if (section.type === "banners_group") {
              count = (section as TenantHomeBannersGroupSection).banners.length
              label = count === 1 ? "1 banner" : `${count} banners`
            } else if (section.type === "auspiciantes_carousel") {
              count = (section as TenantHomeSponsorsCarouselSection).sponsors.length
              label = count === 1 ? "1 sponsor" : `${count} sponsors`
            } else if (section.type === "testimonios") {
              count = (section as TenantHomeTestimoniosSection).testimonios.length
              label = count === 1 ? "1 testimonio" : `${count} testimonios`
            }
            if (count === null) return null
            return (
              <span className="text-xs text-muted-foreground bg-muted/50 border border-border rounded-full px-2 py-0.5">
                {count === 0 ? "Sin contenido" : label}
              </span>
            )
          })()}
        </div>
        {!visible && <Badge variant="outline">Oculta</Badge>}
        {onDelete && (
          <button
            type="button"
            disabled={!canEdit}
            onClick={onDelete}
            className="h-8 w-8 shrink-0 flex items-center justify-center rounded-lg border border-destructive/30 bg-destructive/5 text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
            aria-label="Eliminar sección"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
        <button
          type="button"
          disabled={!canEdit}
          onClick={onToggleVisible}
          className="h-8 w-8 shrink-0 flex items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
          aria-label={visible ? "Ocultar sección" : "Mostrar sección"}
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="h-8 w-8 shrink-0 flex items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-colors hover:text-foreground"
          aria-label={expanded ? "Colapsar sección" : "Expandir sección"}
        >
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>
      {expanded && (
        <div className="border-t border-border p-4">
          <SectionRowContent
            section={section}
            galeria_fotos={galeria_fotos}
            onGaleriaChange={onGaleriaChange}
            onChange={onSectionChange}
            canEdit={canEdit}
            eventosPasados={eventosPasados}
          />
        </div>
      )}
    </div>
  )
}

// Módulo-scope: compartido entre el picker del final de la lista y el picker
// contextual "+" que se inserta entre bloques (Fase 2 del plan de mejoras del editor).
const SINGULAR_ADDABLE_TYPES = ["galeria", "auspiciantes_carousel", "texto_libre", "countdown", "video_embed", "mapa", "testimonios"] as const
type SingularAddableType = typeof SINGULAR_ADDABLE_TYPES[number]

// Lista de botones de tipo de sección — reusada por el picker de "agregar al final"
// y por el picker contextual que abre cada InsertSectionDivider.
function SectionTypePickerButtons({
  missingSingularTypes,
  canAddBannersGroup,
  canEdit,
  onPick,
}: {
  missingSingularTypes: readonly SingularAddableType[]
  canAddBannersGroup: boolean
  canEdit: boolean
  onPick: (type: SingularAddableType | "banners_group") => void
}) {
  return (
    <>
      {missingSingularTypes.map((type) => (
        <button
          key={type}
          type="button"
          disabled={!canEdit}
          onClick={() => onPick(type)}
          className="inline-flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          <SectionIcon type={type} className="h-4 w-4 text-primary" />
          {getSectionLabel(type)}
        </button>
      ))}
      {canAddBannersGroup && (
        <button
          type="button"
          disabled={!canEdit}
          onClick={() => onPick("banners_group")}
          className="inline-flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          <Image className="h-4 w-4 text-primary" />
          Banners de contenido
        </button>
      )}
    </>
  )
}

// Divisor "+" contextual entre dos bloques — hover revela el botón, click expande
// el mismo picker de tipos para insertar EXACTAMENTE en esa posición (en vez de
// agregar al final y tener que arrastrar hacia arriba).
function InsertSectionDivider({
  isOpen,
  onToggle,
  onPick,
  missingSingularTypes,
  canAddBannersGroup,
  canEdit,
}: {
  isOpen: boolean
  onToggle: () => void
  onPick: (type: SingularAddableType | "banners_group") => void
  missingSingularTypes: readonly SingularAddableType[]
  canAddBannersGroup: boolean
  canEdit: boolean
}) {
  return (
    <div className="group/divider relative py-1">
      <div className="pointer-events-none absolute inset-x-3 top-1/2 h-px -translate-y-1/2 bg-border/0 transition-colors group-hover/divider:bg-border" />
      <div className="relative flex justify-center">
        <button
          type="button"
          disabled={!canEdit}
          onClick={onToggle}
          className={`inline-flex h-6 w-6 items-center justify-center rounded-full border border-border bg-background text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover/divider:opacity-100 disabled:cursor-not-allowed disabled:opacity-0 ${isOpen ? "opacity-100" : ""}`}
          aria-label="Insertar sección acá"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      {isOpen && (
        <div className="mt-2 flex flex-wrap justify-center gap-2 rounded-xl border border-dashed border-border bg-muted/30 p-3">
          <SectionTypePickerButtons
            missingSingularTypes={missingSingularTypes}
            canAddBannersGroup={canAddBannersGroup}
            canEdit={canEdit}
            onPick={onPick}
          />
        </div>
      )}
    </div>
  )
}

export function SectionsOrderManager({
  sections,
  onChange,
  galeria_fotos,
  onGaleriaChange,
  canEdit,
  eventosPasados = [],
}: {
  sections: TenantHomeSection[]
  onChange: (sections: TenantHomeSection[]) => void
  galeria_fotos: GaleriaFotoItem[]
  onGaleriaChange: (fotos: GaleriaFotoItem[]) => void
  canEdit: boolean
  /** Eventos pasados/finalizados del tenant — opciones para "Vincular a un evento" en el bloque testimonios. */
  eventosPasados?: EventoPasadoOption[]
}) {
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  })
  useEffect(() => {
    if (sections.length === 0) {
      onChangeRef.current(DEFAULT_SECTIONS)
    }
    // intentionally runs only on mount — initializes sections when none are saved yet
  }, [])

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  // Índice del divisor "+" contextual actualmente abierto (Fase 2). null = ninguno abierto.
  const [insertAtIndex, setInsertAtIndex] = useState<number | null>(null)

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (over && active.id !== over.id) {
      const oldIndex = sections.findIndex((s) => s.id === active.id)
      const newIndex = sections.findIndex((s) => s.id === over.id)
      onChange(arrayMove(sections, oldIndex, newIndex))
    }
  }

  function toggleVisible(id: string) {
    onChange(
      sections.map((s) => {
        if (s.id !== id) return s
        const current = (s as { visible?: boolean }).visible !== false
        return { ...s, visible: !current }
      })
    )
  }

  function updateSection(updated: TenantHomeSection) {
    onChange(sections.map((s) => (s.id === updated.id ? updated : s)))
  }

  function deleteSection(id: string) {
    onChange(sections.filter((s) => s.id !== id))
  }

  const displaySections = sections.length > 0 ? sections : DEFAULT_SECTIONS

  const MAX_BANNERS_GROUPS = 5
  const missingSingularTypes = SINGULAR_ADDABLE_TYPES.filter((type) => !displaySections.some((s) => s.type === type))
  const bannersGroupCount = displaySections.filter((s) => s.type === "banners_group").length
  const bannersGroupIds = displaySections.filter((s) => s.type === "banners_group").map((s) => s.id)
  const canAddBannersGroup = bannersGroupCount < MAX_BANNERS_GROUPS
  const canAddAnything = missingSingularTypes.length > 0 || canAddBannersGroup

  // insertIndex ausente (o >= length) = agregar al final, comportamiento original.
  // Con insertIndex, inserta exactamente en esa posición (Fase 2: "+" contextual).
  function addSection(type: SingularAddableType | "banners_group", insertIndex?: number) {
    let newSection: TenantHomeSection
    if (type === "galeria") newSection = createTenantHomeGaleriaSection()
    else if (type === "banners_group") newSection = createTenantHomeBannersGroupSection()
    else if (type === "auspiciantes_carousel") newSection = createTenantHomeSponsorsCarouselSection()
    else if (type === "texto_libre") newSection = createTenantHomeTextoLibreSection()
    else if (type === "countdown") newSection = createTenantHomeCountdownSection()
    else if (type === "video_embed") newSection = createTenantHomeVideoEmbedSection()
    else if (type === "mapa") newSection = createTenantHomeMapaSection()
    else newSection = createTenantHomeTestimoniosSection()

    if (insertIndex === undefined || insertIndex >= displaySections.length) {
      onChange([...displaySections, newSection])
      return
    }
    const next = [...displaySections]
    next.splice(insertIndex, 0, newSection)
    onChange(next)
  }

  return (
    <div className="min-w-0 overflow-hidden bg-card rounded-2xl border border-border/60 p-4">
      <div className="flex items-start gap-2.5 mb-5">
        <LayoutTemplate className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
        <div>
          <p className="text-[15px] font-semibold tracking-tight text-foreground">Secciones del home</p>
          <p className="text-xs text-muted-foreground mt-0.5">Arrastrá para reordenar. Usá el ojo para mostrar u ocultar cada sección.</p>
        </div>
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={displaySections.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {displaySections.map((section, idx) => {
              let sectionLabel: string | undefined
              if (section.type === "banners_group" && bannersGroupCount > 1) {
                const bgIdx = bannersGroupIds.indexOf(section.id)
                sectionLabel = `Banners ${bgIdx + 1}`
              }
              return (
                <Fragment key={section.id}>
                  {idx > 0 && canAddAnything && (
                    <InsertSectionDivider
                      isOpen={insertAtIndex === idx}
                      onToggle={() => setInsertAtIndex(insertAtIndex === idx ? null : idx)}
                      onPick={(type) => {
                        addSection(type, idx)
                        setInsertAtIndex(null)
                      }}
                      missingSingularTypes={missingSingularTypes}
                      canAddBannersGroup={canAddBannersGroup}
                      canEdit={canEdit}
                    />
                  )}
                  <SectionRow
                    section={section}
                    label={sectionLabel}
                    galeria_fotos={galeria_fotos}
                    onGaleriaChange={onGaleriaChange}
                    onSectionChange={updateSection}
                    onToggleVisible={() => toggleVisible(section.id)}
                    onDelete={section.type !== "eventos" ? () => deleteSection(section.id) : undefined}
                    canEdit={canEdit}
                    eventosPasados={eventosPasados}
                  />
                </Fragment>
              )
            })}
          </div>
        </SortableContext>
      </DndContext>
      {canAddAnything && (
        <div className="mt-3 pt-3 border-t border-border">
          <p className="text-xs text-muted-foreground mb-2">Agregar sección</p>
          <div className="flex flex-wrap gap-2">
            <SectionTypePickerButtons
              missingSingularTypes={missingSingularTypes}
              canAddBannersGroup={canAddBannersGroup}
              canEdit={canEdit}
              onPick={(type) => addSection(type)}
            />
          </div>
        </div>
      )}
    </div>
  )
}
