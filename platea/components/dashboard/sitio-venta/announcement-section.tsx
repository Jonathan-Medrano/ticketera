"use client"

import { Megaphone } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { SectionCard } from "./shared-ui"
import type { SitioVentaForm } from "./types"

export function AnnouncementSection({ form, setForm }: { form: SitioVentaForm; setForm: React.Dispatch<React.SetStateAction<SitioVentaForm>> }) {
  const bar = form.announcement_bar

  function update(patch: Partial<typeof bar>) {
    setForm((prev) => ({ ...prev, announcement_bar: { ...prev.announcement_bar, ...patch } }))
  }

  return (
    <SectionCard icon={Megaphone} title="Barra de anuncio" subtitle="Mensaje destacado en la parte superior del sitio para promos, fechas nuevas o avisos urgentes">
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-foreground">Activar barra</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Solo se muestra si hay texto cargado
            </p>
          </div>
          <Switch
            checked={bar.enabled}
            onCheckedChange={(checked) => update({ enabled: checked })}
          />
        </div>

        <div className={`space-y-4 transition-opacity ${bar.enabled ? "opacity-100" : "opacity-40 pointer-events-none select-none"}`}>
          <div className="space-y-1.5">
            <Label htmlFor="announcement-text">Mensaje</Label>
            <Input
              id="announcement-text"
              value={bar.text}
              onChange={(e) => update({ text: e.target.value.slice(0, 200) })}
              placeholder="🎉 Nueva fecha anunciada — 25 de julio en el Gran Rex"
              maxLength={200}
            />
            <p className="text-xs text-muted-foreground text-right">{bar.text.length}/200</p>
          </div>

          <div className="grid gap-3 @md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="announcement-link">Enlace (opcional)</Label>
              <Input
                id="announcement-link"
                value={bar.link ?? ""}
                onChange={(e) => update({ link: e.target.value })}
                placeholder="https://..."
                type="url"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="announcement-link-label">Texto del enlace</Label>
              <Input
                id="announcement-link-label"
                value={bar.link_label ?? ""}
                onChange={(e) => update({ link_label: e.target.value.slice(0, 50) })}
                placeholder="Ver más"
                maxLength={50}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Estilo</Label>
            <div className="grid grid-cols-2 gap-2">
              {([["brand", "Marca (tu color primario)"], ["warning", "Urgente (ámbar)"]] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => update({ style: value })}
                  aria-label={`Estilo ${label}`}
                  aria-pressed={bar.style === value}
                  className={`rounded-lg border px-3 py-2.5 text-left text-xs font-medium transition-colors ${
                    bar.style === value
                      ? "border-primary/40 bg-primary/5 text-foreground"
                      : "border-border text-muted-foreground hover:border-border/80 hover:bg-muted/30"
                  }`}
                >
                  <span className={`mr-2 inline-block h-2.5 w-2.5 rounded-full ${value === "warning" ? "bg-amber-500" : "bg-primary"}`} />
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {bar.enabled && bar.text && (
          <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium ${bar.style === "warning" ? "bg-amber-500/10 text-amber-700 dark:text-amber-400" : "bg-primary/10 text-primary"}`}>
            <Megaphone className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{bar.text}</span>
            {bar.link && bar.link_label && (
              <span className="ml-auto shrink-0 underline">{bar.link_label}</span>
            )}
          </div>
        )}
      </div>
    </SectionCard>
  )
}
