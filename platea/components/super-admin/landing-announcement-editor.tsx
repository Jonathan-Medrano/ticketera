"use client"

import { useEffect, useState } from "react"
import Link from "@tiptap/extension-link"
import StarterKit from "@tiptap/starter-kit"
import { EditorContent, useEditor, useEditorState } from "@tiptap/react"
import { Bold, Italic, Link2, Loader2, Megaphone, Unlink } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { SuperAdminPanel } from "@/components/super-admin/section-shell"
import { sanitizeAnnouncementHtml } from "@/lib/tenant-rich-text"
import AnnouncementBar from "@/components/marketing/announcement-bar"

type AnimationMode = "static" | "marquee_infinite" | "marquee_finite"
type AnimationSpeed = "slow" | "normal" | "fast"

type LandingAnnouncement = {
  id: string
  contentHtml: string
  ctaLabel: string | null
  ctaHref: string | null
  active: boolean
  animationMode?: AnimationMode
  animationSpeed?: AnimationSpeed
  backgroundColor?: string | null
  updatedAt: string
}

const ANIMATION_OPTIONS: Array<{ value: AnimationMode; label: string; hint: string }> = [
  { value: "static", label: "Estático", hint: "Sin movimiento. Si excede el ancho, se trunca." },
  { value: "marquee_infinite", label: "Movimiento infinito", hint: "Loop continuo: el texto se duplica para evitar el corte." },
  { value: "marquee_finite", label: "Movimiento finito", hint: "Cruza de derecha a izquierda y reinicia con una pausa visual." },
]

const SPEED_OPTIONS: Array<{ value: AnimationSpeed; label: string }> = [
  { value: "slow", label: "Lento" },
  { value: "normal", label: "Normal" },
  { value: "fast", label: "Rápido" },
]

const editorExtensions = [
  StarterKit.configure({
    heading: false,
    bulletList: false,
    orderedList: false,
    listItem: false,
    blockquote: false,
    codeBlock: false,
    code: false,
    horizontalRule: false,
  }),
  Link.configure({
    openOnClick: false,
    autolink: false,
    protocols: ["http", "https", "mailto"],
    defaultProtocol: "https",
  }),
]


function ToolbarButton({ active, onClick, children, title }: { active?: boolean; onClick: () => void; children: React.ReactNode; title: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant={active ? "secondary" : "ghost"} size="icon" onClick={onClick} aria-label={title} className="h-8 w-8">
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{title}</TooltipContent>
    </Tooltip>
  )
}

function normalizeLinkUrl(raw: string) {
  const trimmed = raw.trim()
  if (!trimmed) return ""
  if (/^(https?:\/\/|mailto:|#|\/)/.test(trimmed)) return trimmed
  return `https://${trimmed}`
}

function isValidCtaHref(value: string) {
  if (!value) return true
  return /^(https?:\/\/|\/|#|mailto:)/.test(value)
}

function isValidHex(value: string) {
  return /^#[0-9a-fA-F]{6}$/.test(value)
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-7 w-56 animate-pulse rounded-lg bg-muted" />
          <div className="h-4 w-80 animate-pulse rounded-lg bg-muted" />
        </div>
        <div className="h-10 w-24 animate-pulse rounded-lg bg-muted" />
      </div>
      <div className="h-24 w-full animate-pulse rounded-[28px] bg-muted" />
      <div className="h-52 w-full animate-pulse rounded-[28px] bg-muted" />
      <div className="h-24 w-full animate-pulse rounded-[28px] bg-muted" />
      <div className="h-40 w-full animate-pulse rounded-[28px] bg-muted" />
      <div className="h-28 w-full animate-pulse rounded-[28px] bg-muted" />
      <div className="h-20 w-full animate-pulse rounded-[28px] bg-muted" />
    </div>
  )
}

export default function LandingAnnouncementEditor() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [contentHtml, setContentHtml] = useState("")
  const [ctaLabel, setCtaLabel] = useState("")
  const [ctaHref, setCtaHref] = useState("")
  const [active, setActive] = useState(false)
  const [animationMode, setAnimationMode] = useState<AnimationMode>("static")
  const [animationSpeed, setAnimationSpeed] = useState<AnimationSpeed>("normal")
  const [backgroundColor, setBackgroundColor] = useState("")
  const [linkUrl, setLinkUrl] = useState("")

  const editor = useEditor({
    immediatelyRender: false,
    extensions: editorExtensions,
    content: "",
    editorProps: {
      attributes: {
        class:
          "min-h-[60px] rounded-2xl border border-border bg-background px-4 py-3 text-sm focus:outline-none prose prose-sm max-w-none [&_p]:m-0",
      },
      handleClick(_view, _pos, event) {
        const target = event.target as HTMLElement | null
        if (target?.closest("a")) {
          event.preventDefault()
          return true
        }
        return false
      },
    },
    onUpdate: ({ editor: currentEditor }) => {
      setContentHtml(sanitizeAnnouncementHtml(currentEditor.getHTML()))
    },
  })

  const editorState = useEditorState({
    editor: editor!,
    selector: ({ editor: ed }) => ({
      isBold: ed.isActive("bold"),
      isItalic: ed.isActive("italic"),
      isLink: ed.isActive("link"),
    }),
  })

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch("/api/platform/landing-announcement", { cache: "no-store" })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = (await res.json()) as { data: LandingAnnouncement | null }
        if (cancelled) return
        const data = json.data
        if (data) {
          const sanitized = sanitizeAnnouncementHtml(data.contentHtml)
          setContentHtml(sanitized)
          setCtaLabel(data.ctaLabel ?? "")
          setCtaHref(data.ctaHref ?? "")
          setActive(data.active)
          setAnimationMode(data.animationMode ?? "static")
          setAnimationSpeed(data.animationSpeed ?? "normal")
          setBackgroundColor(data.backgroundColor ?? "")
          editor?.commands.setContent(sanitized, { emitUpdate: false })
        }
      } catch (err) {
        if (!cancelled) setError("No se pudo cargar el anuncio actual")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    if (editor) load()
    return () => {
      cancelled = true
    }
  }, [editor])

  useEffect(() => {
    if (!editor) return
    const syncLinkState = () => {
      const href = (editor.getAttributes("link").href as string | undefined) ?? ""
      setLinkUrl(href)
    }
    syncLinkState()
    editor.on("selectionUpdate", syncLinkState)
    editor.on("transaction", syncLinkState)
    return () => {
      editor.off("selectionUpdate", syncLinkState)
      editor.off("transaction", syncLinkState)
    }
  }, [editor])

  async function handleSave() {
    if (!isValidCtaHref(ctaHref.trim())) {
      setError("El link del CTA debe empezar con http(s)://, /, # o mailto:")
      return
    }
    const trimmedBg = backgroundColor.trim()
    if (trimmedBg && !isValidHex(trimmedBg)) {
      setError("El color de fondo debe ser un hex válido (#rrggbb)")
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/platform/landing-announcement", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contentHtml: sanitizeAnnouncementHtml(contentHtml),
          ctaLabel: ctaLabel.trim() || null,
          ctaHref: ctaHref.trim() || null,
          active,
          animationMode,
          animationSpeed,
          backgroundColor: trimmedBg || null,
        }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json.error ?? `HTTP ${res.status}`)
      }
      toast.success("Anuncio guardado")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar")
    } finally {
      setSaving(false)
    }
  }

  const hasContent = sanitizeAnnouncementHtml(contentHtml).replace(/<[^>]+>/g, "").trim().length > 0

  if (loading) {
    return <LoadingSkeleton />
  }

  const saveButton = (
    <Button onClick={handleSave} disabled={saving || !hasContent} size="lg">
      {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
      {saving ? "Guardando…" : "Guardar"}
    </Button>
  )

  return (
    <div className="space-y-6">
      {/* Page header row */}
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Anuncio de la landing</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Barra superior pública en la home. Soporta texto plano, <strong>negrita</strong>, <em>itálica</em> y links inline.
            Si dejás el CTA vacío, el bar se renderiza sin botón.
          </p>
        </div>
        {saveButton}
      </header>

      {/* 1. Estado — promoted to top */}
      <SuperAdminPanel>
        <Label className="text-sm font-medium">Estado</Label>
        <div className="mt-3 flex items-center gap-3">
          <Switch checked={active} onCheckedChange={setActive} id="announcement-active" />
          <Label htmlFor="announcement-active" className="text-sm">
            {active ? "Visible en la landing" : "Oculto"}
          </Label>
        </div>
      </SuperAdminPanel>

      {/* 2. Mensaje */}
      <SuperAdminPanel>
        <div className="mb-3 flex items-center justify-between">
          <Label className="text-sm font-medium">Mensaje</Label>
          <TooltipProvider>
          <div className="flex gap-1">
            {editor && editorState ? (
              <>
                <ToolbarButton title="Negrita (Ctrl+B)" active={editorState.isBold} onClick={() => editor.chain().focus().toggleBold().run()}>
                  <Bold className="h-3.5 w-3.5" />
                </ToolbarButton>
                <ToolbarButton title="Itálica (Ctrl+I)" active={editorState.isItalic} onClick={() => editor.chain().focus().toggleItalic().run()}>
                  <Italic className="h-3.5 w-3.5" />
                </ToolbarButton>
                <ToolbarButton title="Quitar link" active={false} onClick={() => { editor.chain().focus().unsetLink().run(); setLinkUrl("") }}>
                  <Unlink className="h-3.5 w-3.5" />
                </ToolbarButton>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    editor.commands.clearContent()
                    setContentHtml("")
                  }}
                >
                  Limpiar
                </Button>
              </>
            ) : null}
          </div>
          </TooltipProvider>
        </div>
        <EditorContent editor={editor} />

        <div className="mt-3 flex flex-col gap-2 rounded-xl border border-border bg-muted/30 p-3 md:flex-row md:items-end">
          <div className="min-w-0 flex-1 space-y-1">
            <Label className="text-xs">Link sobre texto seleccionado</Label>
            <Input
              className="h-9"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              placeholder="https://... o mailto:..."
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              if (!editor) return
              const nextUrl = normalizeLinkUrl(linkUrl)
              if (!nextUrl) return
              editor.chain().focus().extendMarkRange("link").setLink({ href: nextUrl }).run()
              setLinkUrl(nextUrl)
            }}
          >
            <Link2 className="mr-1.5 h-3.5 w-3.5" /> Aplicar
          </Button>
        </div>
      </SuperAdminPanel>

      {/* 3. CTA opcional */}
      <SuperAdminPanel>
        <Label className="text-sm font-medium">CTA opcional</Label>
        <p className="mt-1 text-xs text-muted-foreground">Si completás los dos campos, aparece un link al final de la barra.</p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">Texto del CTA</Label>
            <Input
              value={ctaLabel}
              onChange={(e) => setCtaLabel(e.target.value)}
              maxLength={120}
              placeholder="Ver detalles"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">URL del CTA</Label>
            <Input
              value={ctaHref}
              onChange={(e) => setCtaHref(e.target.value)}
              maxLength={500}
              placeholder="https://ticketera.com/novedades"
            />
          </div>
        </div>
      </SuperAdminPanel>

      {/* 4. Animación */}
      <SuperAdminPanel>
        <Label className="text-sm font-medium">Animación</Label>
        <p className="mt-1 text-xs text-muted-foreground">
          El movimiento se pausa al pasar el mouse y se desactiva para usuarios con <code className="rounded bg-muted px-1">prefers-reduced-motion</code>.
        </p>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {ANIMATION_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setAnimationMode(opt.value)}
              className={`flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-colors ${
                animationMode === opt.value
                  ? "border-primary bg-primary/5 ring-2 ring-primary"
                  : "border-border bg-background hover:bg-muted/40"
              }`}
            >
              <span className="text-sm font-semibold">{opt.label}</span>
              <span className="text-xs text-muted-foreground">{opt.hint}</span>
            </button>
          ))}
        </div>

        {animationMode !== "static" ? (
          <div className="mt-4">
            <Label className="text-xs">Velocidad</Label>
            <div className="mt-2 inline-flex rounded-xl border border-border bg-background p-1">
              {SPEED_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setAnimationSpeed(opt.value)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                    animationSpeed === opt.value
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted/60"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </SuperAdminPanel>

      {/* 5. Color de fondo */}
      <SuperAdminPanel>
        <Label className="text-sm font-medium">Color de fondo</Label>
        <p className="mt-1 text-xs text-muted-foreground">
          Si dejás vacío, usa el color de la marca. Si elegís uno custom, el texto se ajusta automáticamente para mantener contraste.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <input
            type="color"
            value={backgroundColor && isValidHex(backgroundColor) ? backgroundColor : "#ffffff"}
            onChange={(e) => setBackgroundColor(e.target.value)}
            className="h-10 w-14 cursor-pointer rounded-lg border border-border bg-transparent"
            aria-label="Selector de color"
          />
          <Input
            className="h-10 max-w-[140px] font-mono"
            value={backgroundColor}
            onChange={(e) => setBackgroundColor(e.target.value)}
            placeholder="#ffd6c0"
            maxLength={7}
          />
          <Button type="button" variant="outline" size="sm" onClick={() => setBackgroundColor("")}>
            Usar default
          </Button>
        </div>
      </SuperAdminPanel>

      {/* 6. Live preview — always rendered */}
      <div className="space-y-2">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Preview en vivo</Label>
        <div className="rounded-[28px] border border-border bg-card p-4 shadow-[var(--superadmin-soft-shadow)]">
          {hasContent ? (
            <div className="overflow-hidden rounded-xl border border-border shadow-sm">
              <AnnouncementBar
                contentHtml={sanitizeAnnouncementHtml(contentHtml)}
                ctaLabel={ctaLabel.trim() || null}
                ctaHref={ctaHref.trim() || null}
                animationMode={animationMode}
                animationSpeed={animationSpeed}
                backgroundColor={backgroundColor.trim() && isValidHex(backgroundColor.trim()) ? backgroundColor.trim() : null}
              />
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-8 text-center">
              <Megaphone className="h-8 w-8 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">El preview aparece aquí cuando agregás contenido al mensaje.</p>
            </div>
          )}
        </div>
      </div>

      {/* Error display */}
      {error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {/* Bottom save row */}
      <div className="flex justify-end">
        {saveButton}
      </div>
    </div>
  )
}
