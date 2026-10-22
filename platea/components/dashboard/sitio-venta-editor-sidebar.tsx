"use client"

import { FileText, Home as HomeIcon, LayoutTemplate, LifeBuoy, Palette } from "lucide-react"
import { cn } from "@/lib/utils"

export const SITIO_VENTA_EDITOR_SECTIONS = [
  { value: "branding", label: "Branding", hint: "Colores, logo e imágenes", icon: Palette },
  { value: "home", label: "Home", hint: "Layout, secciones, visibilidad y copy", icon: HomeIcon },
  { value: "informacion", label: "Información", hint: "Páginas legales, contacto y menú", icon: FileText },
  { value: "soporte", label: "Soporte", hint: "Email público, FAQs y visibilidad", icon: LifeBuoy },
  { value: "plantillas", label: "Plantillas", hint: "Guardá y aplicá configuraciones completas", icon: LayoutTemplate },
] as const

export type SitioVentaEditorSection = (typeof SITIO_VENTA_EDITOR_SECTIONS)[number]["value"]

export function SitioVentaEditorSidebar({
  activeSection,
  onSelectSection,
}: {
  activeSection: SitioVentaEditorSection
  onSelectSection: (section: SitioVentaEditorSection) => void
}) {
  return (
    <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-border bg-card px-2 py-2 lg:h-full lg:w-56 lg:flex-col lg:overflow-x-visible lg:overflow-y-auto lg:border-b-0 lg:border-r lg:py-3">
      {SITIO_VENTA_EDITOR_SECTIONS.map((section) => {
        const active = section.value === activeSection
        return (
          <button
            key={section.value}
            type="button"
            onClick={() => onSelectSection(section.value)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors lg:w-full lg:gap-2.5",
              active
                ? "bg-primary/10 text-primary"
                : "text-foreground/70 hover:bg-muted/40 hover:text-foreground"
            )}
          >
            <section.icon className={cn("h-4 w-4 shrink-0", active ? "opacity-100" : "opacity-60")} />
            <span className="flex min-w-0 flex-col">
              <span className="truncate">{section.label}</span>
              <span className="hidden truncate text-[11px] font-normal text-muted-foreground/80 lg:block">
                {section.hint}
              </span>
            </span>
          </button>
        )
      })}
    </nav>
  )
}
