"use client"

import { useLayoutEffect, useRef } from "react"
import { cn } from "@/lib/utils"

/** Closed set of plain-text tags this component supports — intentionally not
 * `keyof JSX.IntrinsicElements` (which also covers SVG/void elements whose ref/props
 * shapes don't line up with a simple text node). Extend when a new field needs a tag
 * that isn't here yet. */
type EditableTextTag = "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "p" | "span" | "div"

/**
 * Inline-editable text node for the "sitio de venta" live-preview spike
 * (`sitio-venta-editor-inline.md`, fase 3). Only used inside the editor's preview
 * iframe (`editable` is only ever true there — see useTenantPreviewEdit()); on real
 * storefront traffic it renders as a plain, non-interactive tag.
 *
 * Why uncontrolled-while-focused: the editor resends the entire form snapshot on
 * every change (rAF-debounced, see sitio-venta-editor-preview.tsx), which re-renders
 * this component with a new `value` prop constantly while the visitor is typing. If
 * we set `el.textContent` unconditionally on every value change, an incoming snapshot
 * that arrives mid-keystroke would overwrite the DOM the browser just placed the
 * caret in, kicking the cursor to the end (or losing focus entirely). Skipping the
 * DOM write while the node has focus makes it behave like an uncontrolled input: React
 * only pushes `value` in when the user isn't actively editing it.
 */
export function EditableText({
  value,
  editable,
  onCommit,
  as: Tag = "span",
  className,
  style,
  placeholder,
}: {
  value: string
  editable: boolean
  onCommit: (next: string) => void
  as?: EditableTextTag
  className?: string
  style?: React.CSSProperties
  placeholder?: string
}) {
  const ref = useRef<HTMLHeadingElement & HTMLParagraphElement & HTMLSpanElement & HTMLDivElement>(null)

  // useLayoutEffect (not useEffect): writes textContent synchronously before paint, so
  // switching from the plain-tag branch (editable=false, text as children) to the
  // contentEditable branch (editable=true, no children — see below) on mount doesn't
  // flash an empty node for a frame while waiting for a passive effect to catch up.
  //
  // `editable` MUST be in the dependency array too, not just `value`: React reuses the
  // same host DOM node across the two branches (same Tag, same position), it doesn't
  // remount. When `editable` flips false -> true, the JSX goes from `{value}` children
  // to no children at all — React clears the node's text — but if `value` itself didn't
  // change since the previous render (the common case: the first preview snapshot
  // usually matches what SSR already rendered), an effect keyed only on `[value]` never
  // reruns to repopulate it, leaving the field permanently blank until the user types
  // something that actually changes `value`. Bug found via live E2E verification, not
  // static analysis — see sitio-venta-inline-edit.spec.ts.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    // Critical: never touch textContent while focused, or the user's caret jumps /
    // gets lost on every incoming snapshot (see module doc above).
    if (document.activeElement === el) return
    if (el.textContent !== value) el.textContent = value
  }, [value, editable])

  if (!editable) {
    return (
      <Tag className={className} style={style}>
        {value || placeholder}
      </Tag>
    )
  }

  return (
    <Tag
      ref={ref}
      className={cn(
        className,
        "cursor-text rounded-sm outline-none transition-[outline-color] hover:outline hover:outline-dashed hover:outline-1 hover:outline-offset-2 hover:outline-current focus:outline focus:outline-dashed focus:outline-2 focus:outline-offset-2 focus:outline-primary",
      )}
      style={style}
      contentEditable
      suppressContentEditableWarning
      tabIndex={0}
      role="textbox"
      aria-multiline={false}
      data-ticketera-editable="true"
      onBlur={(e: React.FocusEvent<HTMLElement>) => onCommit(e.currentTarget.textContent ?? "")}
      onKeyDown={(e: React.KeyboardEvent<HTMLElement>) => {
        // Plain text field: Enter commits + blurs instead of inserting a line break.
        if (e.key === "Enter") {
          e.preventDefault()
          e.currentTarget.blur()
        }
      }}
    />
  )
}
