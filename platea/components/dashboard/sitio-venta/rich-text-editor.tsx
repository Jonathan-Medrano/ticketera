"use client"

import { useEffect, useState } from "react"
import TiptapUnderline from "@tiptap/extension-underline"
import Link from "@tiptap/extension-link"
import StarterKit from "@tiptap/starter-kit"
import { EditorContent, useEditor, useEditorState } from "@tiptap/react"
import { Bold, Heading2, Heading3, Italic, Link2, List, ListOrdered, Mail, MapPin, Phone, Quote, Redo2, Underline, Unlink, Undo2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { normalizeInfoContentToHtml, sanitizeTenantRichText } from "@/lib/tenant-rich-text"

const editorExtensions = [
  StarterKit.configure({ heading: { levels: [2, 3] } }),
  TiptapUnderline,
  Link.configure({
    openOnClick: false,
    autolink: true,
    protocols: ["http", "https", "mailto"],
    defaultProtocol: "https",
  }),
]

function normalizeLinkUrl(raw: string) {
  const trimmed = raw.trim()
  if (!trimmed) return ""
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://") || trimmed.startsWith("mailto:")) return trimmed
  return `https://${trimmed}`
}

/** Strip all HTML tags and check if any visible content remains */
function isEmptyHtml(html: string): boolean {
  return !html.replace(/<[^>]*>/g, "").trim()
}

/** Normalize value for loading into the editor: handle legacy plain text and HTML */
function normalizeForEditor(value: string): string {
  return sanitizeTenantRichText(normalizeInfoContentToHtml(value))
}

const CONTACT_SNIPPETS = [
  {
    label: "WhatsApp",
    html: '<p><strong>WhatsApp:</strong> <a href="https://wa.me/549XXXXXXXXXX">Escribinos por WhatsApp</a></p>',
    hint: "Reemplazá XXXXXXXXXX con tu número",
    icon: MessageCircleFallback,
  },
  {
    label: "Teléfono",
    html: '<p><strong>Teléfono:</strong> <a href="tel:+549XXXXXXXXXX">+549 XX XXXX-XXXX</a></p>',
    hint: "Reemplazá con tu número",
    icon: Phone,
  },
  {
    label: "Email",
    html: '<p><strong>Email:</strong> <a href="mailto:hola@tuempresa.com">hola@tuempresa.com</a></p>',
    hint: "Reemplazá con tu email",
    icon: Mail,
  },
  {
    label: "Ubicación",
    html: "<p><strong>Ubicación:</strong> Calle 123, Ciudad, Provincia</p>",
    hint: "Reemplazá con tu dirección",
    icon: MapPin,
  },
] as const

function MessageCircleFallback(props: { className?: string }) {
  return <span className={props.className}>🟢</span>
}

function ToolDivider() {
  return <div aria-hidden className="mx-0.5 h-5 w-px shrink-0 bg-border" />
}

function IconBtn({
  active,
  onClick,
  title,
  children,
  disabled,
  size = "sm",
}: {
  active?: boolean
  onClick: () => void
  title: string
  children: React.ReactNode
  disabled?: boolean
  size?: "sm" | "xs"
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant={active ? "secondary" : "ghost"}
          size="icon"
          className={cn(size === "xs" ? "h-7 w-7" : "h-8 w-8", "shrink-0")}
          onClick={onClick}
          disabled={disabled}
          aria-label={title}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{title}</TooltipContent>
    </Tooltip>
  )
}

type EditorActiveState = {
  isBold: boolean
  isItalic: boolean
  isUnderline: boolean
  isH2: boolean
  isH3: boolean
  isBulletList: boolean
  isOrderedList: boolean
  isBlockquote: boolean
  isLink: boolean
  linkHref: string
  hasSelection: boolean
  bubbleCoords: { left: number; top: number } | null
  isEmpty: boolean
  canUndo: boolean
  canRedo: boolean
}

const EMPTY_STATE: EditorActiveState = {
  isBold: false,
  isItalic: false,
  isUnderline: false,
  isH2: false,
  isH3: false,
  isBulletList: false,
  isOrderedList: false,
  isBlockquote: false,
  isLink: false,
  linkHref: "",
  hasSelection: false,
  bubbleCoords: null,
  isEmpty: true,
  canUndo: false,
  canRedo: false,
}

export function RichTextEditor({
  value,
  onChange,
  placeholder = "",
  editable = true,
  minHeight = "360px",
  showContactSnippets = true,
}: {
  value: string
  onChange: (html: string) => void
  placeholder?: string
  editable?: boolean
  /** Min height of the editable area. Default: "360px". Use a smaller value (e.g. "160px") for compact fields. */
  minHeight?: string
  /** Show the contact snippet insert buttons. Default: true. Set to false for compact fields (e.g. FAQ). */
  showContactSnippets?: boolean
}) {
  const [linkUrl, setLinkUrl] = useState("")
  const [linkOpen, setLinkOpen] = useState(false)

  const editor = useEditor({
    immediatelyRender: false,
    extensions: editorExtensions,
    content: normalizeForEditor(value),
    editable,
    editorProps: {
      attributes: {
        class: "px-5 py-4 text-sm focus:outline-none prose prose-sm max-w-none",
        style: `min-height: ${minHeight}`,
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
    onUpdate: ({ editor: ed }) => {
      const html = sanitizeTenantRichText(ed.getHTML())
      onChange(isEmptyHtml(html) ? "" : html)
    },
  })

  // Guard against null editor on first render (immediatelyRender: false)
  const state = useEditorState({
    editor: editor as Parameters<typeof useEditorState>[0]["editor"],
    selector: ({ editor: ed }): EditorActiveState => {
      if (!ed) return EMPTY_STATE
      const { empty, from, to } = ed.state.selection
      let bubbleCoords: { left: number; top: number } | null = null
      if (!empty) {
        try {
          const start = ed.view.coordsAtPos(from)
          const end = ed.view.coordsAtPos(to - 1)
          bubbleCoords = { left: (start.left + end.right) / 2, top: start.top }
        } catch {
          bubbleCoords = null
        }
      }
      return {
        isBold: ed.isActive("bold"),
        isItalic: ed.isActive("italic"),
        isUnderline: ed.isActive("underline"),
        isH2: ed.isActive("heading", { level: 2 }),
        isH3: ed.isActive("heading", { level: 3 }),
        isBulletList: ed.isActive("bulletList"),
        isOrderedList: ed.isActive("orderedList"),
        isBlockquote: ed.isActive("blockquote"),
        isLink: ed.isActive("link"),
        linkHref: (ed.getAttributes("link").href as string | undefined) ?? "",
        hasSelection: !empty,
        bubbleCoords,
        isEmpty: ed.isEmpty,
        canUndo: ed.can().undo(),
        canRedo: ed.can().redo(),
      }
    },
  }) ?? EMPTY_STATE

  // Sync external value changes without overwriting equal content
  useEffect(() => {
    if (!editor) return
    const current = sanitizeTenantRichText(editor.getHTML())
    const next = normalizeForEditor(value)
    if (current !== next) editor.commands.setContent(next, { emitUpdate: false })
  }, [editor, value])

  useEffect(() => {
    if (!editor) return
    editor.setEditable(editable)
  }, [editor, editable])

  // Open link row whenever cursor lands on an existing link
  useEffect(() => {
    if (state.isLink && state.linkHref) {
      setLinkUrl(state.linkHref)
      setLinkOpen(true)
    }
  }, [state.isLink, state.linkHref])

  if (!editor) return null

  const applyLink = () => {
    const url = normalizeLinkUrl(linkUrl)
    if (!url) return
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run()
    setLinkUrl(url)
  }

  const removeLink = () => {
    editor.chain().focus().unsetLink().run()
    setLinkUrl("")
    setLinkOpen(false)
  }

  return (
    <TooltipProvider>
      <div className="overflow-hidden rounded-xl border border-border">
        {/* Toolbar */}
        <div
          className="flex flex-wrap items-center gap-0.5 border-b border-border bg-muted/30 px-2 py-1.5"
          onMouseDown={(e) => e.preventDefault()}
        >
          <IconBtn title="Deshacer (Ctrl+Z)" disabled={!state.canUndo} onClick={() => editor.chain().focus().undo().run()}>
            <Undo2 className="h-4 w-4" />
          </IconBtn>
          <IconBtn title="Rehacer (Ctrl+Y)" disabled={!state.canRedo} onClick={() => editor.chain().focus().redo().run()}>
            <Redo2 className="h-4 w-4" />
          </IconBtn>

          <ToolDivider />

          <IconBtn title="Título" active={state.isH2} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
            <Heading2 className="h-4 w-4" />
          </IconBtn>
          <IconBtn title="Subtítulo" active={state.isH3} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
            <Heading3 className="h-4 w-4" />
          </IconBtn>

          <ToolDivider />

          <IconBtn title="Negrita (Ctrl+B)" active={state.isBold} onClick={() => editor.chain().focus().toggleBold().run()}>
            <Bold className="h-4 w-4" />
          </IconBtn>
          <IconBtn title="Itálica (Ctrl+I)" active={state.isItalic} onClick={() => editor.chain().focus().toggleItalic().run()}>
            <Italic className="h-4 w-4" />
          </IconBtn>
          <IconBtn title="Subrayado (Ctrl+U)" active={state.isUnderline} onClick={() => editor.chain().focus().toggleUnderline().run()}>
            <Underline className="h-4 w-4" />
          </IconBtn>

          <ToolDivider />

          <IconBtn title="Lista" active={state.isBulletList} onClick={() => editor.chain().focus().toggleBulletList().run()}>
            <List className="h-4 w-4" />
          </IconBtn>
          <IconBtn title="Lista numerada" active={state.isOrderedList} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
            <ListOrdered className="h-4 w-4" />
          </IconBtn>
          <IconBtn title="Cita destacada" active={state.isBlockquote} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
            <Quote className="h-4 w-4" />
          </IconBtn>

          <ToolDivider />

          <IconBtn
            title="Agregar enlace"
            active={state.isLink}
            onClick={() => {
              editor.chain().focus().extendMarkRange("link").run()
              setLinkOpen(true)
            }}
          >
            <Link2 className="h-4 w-4" />
          </IconBtn>
          <IconBtn title="Quitar enlace" disabled={!state.isLink} onClick={removeLink}>
            <Unlink className="h-4 w-4" />
          </IconBtn>
        </div>

        {/* Link URL row — visible when link is active or user clicked the link button */}
        {linkOpen && editable && (
          <div className="flex items-center gap-2 border-b border-border bg-muted/10 px-3 py-2">
            <Link2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <Input
              className="h-8 flex-1 text-xs"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              placeholder="Pegá el link (ej: www.misitio.com o WhatsApp)"
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); applyLink() }
                if (e.key === "Escape") setLinkOpen(false)
              }}
              autoFocus
            />
            <Button type="button" size="sm" className="h-8 text-xs" onClick={applyLink}>
              Aplicar
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 text-muted-foreground"
              onClick={() => setLinkOpen(false)}
              aria-label="Cerrar"
            >
              ✕
            </Button>
          </div>
        )}

        {/* Contact snippets */}
        {showContactSnippets && editable && (
          <div className="border-b border-border bg-muted/10 px-3 py-2">
            <p className="mb-1.5 text-xs text-muted-foreground">
              Insertar bloque de contacto — <span className="font-medium">recordá actualizar los datos con los tuyos</span>:
            </p>
            <div className="flex flex-wrap gap-1.5">
              {CONTACT_SNIPPETS.map(({ label, html, icon: Icon }) => (
                <Tooltip key={label}>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1 text-xs"
                      onClick={() => editor.chain().focus().insertContent(html).run()}
                    >
                      <Icon className="h-3.5 w-3.5" /> {label}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{CONTACT_SNIPPETS.find(s => s.label === label)?.hint}</TooltipContent>
                </Tooltip>
              ))}
            </div>
          </div>
        )}

        {/* Editor area with placeholder overlay */}
        <div className="relative">
          {state.isEmpty && placeholder && (
            <p
              className="pointer-events-none absolute left-5 top-4 select-none text-sm text-muted-foreground/50"
              aria-hidden
            >
              {placeholder}
            </p>
          )}
          <EditorContent editor={editor} />
        </div>
      </div>

      {/* Floating BubbleMenu — appears above selected text, clamped to viewport */}
      {state.hasSelection && state.bubbleCoords && (
        <div
          style={{
            position: "fixed",
            left: `clamp(5rem, ${state.bubbleCoords.left}px, calc(100vw - 5rem))`,
            top: state.bubbleCoords.top,
            transform: "translate(-50%, calc(-100% - 8px))",
            zIndex: 50,
          }}
          className="flex items-center gap-0.5 rounded-lg border border-border bg-popover px-1 py-1 shadow-lg animate-in fade-in-0 zoom-in-95 duration-100"
          onMouseDown={(e) => e.preventDefault()}
        >
          <IconBtn size="xs" title="Negrita" active={state.isBold} onClick={() => editor.chain().focus().toggleBold().run()}>
            <Bold className="h-3.5 w-3.5" />
          </IconBtn>
          <IconBtn size="xs" title="Itálica" active={state.isItalic} onClick={() => editor.chain().focus().toggleItalic().run()}>
            <Italic className="h-3.5 w-3.5" />
          </IconBtn>
          <IconBtn size="xs" title="Subrayado" active={state.isUnderline} onClick={() => editor.chain().focus().toggleUnderline().run()}>
            <Underline className="h-3.5 w-3.5" />
          </IconBtn>
          <ToolDivider />
          <IconBtn size="xs" title="Título" active={state.isH2} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
            <Heading2 className="h-3.5 w-3.5" />
          </IconBtn>
          <IconBtn size="xs" title="Subtítulo" active={state.isH3} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
            <Heading3 className="h-3.5 w-3.5" />
          </IconBtn>
          <ToolDivider />
          <IconBtn
            size="xs"
            title="Agregar enlace"
            active={state.isLink}
            onClick={() => {
              editor.chain().focus().extendMarkRange("link").run()
              setLinkOpen(true)
            }}
          >
            <Link2 className="h-3.5 w-3.5" />
          </IconBtn>
        </div>
      )}
    </TooltipProvider>
  )
}
