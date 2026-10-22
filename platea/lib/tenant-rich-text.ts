import sanitizeHtml from "sanitize-html"

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function renderInline(text: string) {
  const escaped = escapeHtml(text)
  return escaped
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^)\s]+)\)/g, '<a href="$2">$1</a>')
}

export function convertLegacyInfoContentToHtml(content: string) {
  const trimmed = content.trim()
  if (!trimmed) return "<p></p>"

  return trimmed
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      if (block.startsWith("### ")) return `<h3>${renderInline(block.slice(4))}</h3>`
      if (block.startsWith("## ")) return `<h2>${renderInline(block.slice(3))}</h2>`

      const lines = block.split("\n")
      const isList = lines.every((line) => line.trim().startsWith("- "))
      if (isList) {
        return `<ul>${lines.map((line) => `<li>${renderInline(line.trim().slice(2))}</li>`).join("")}</ul>`
      }

      return `<p>${lines.map((line) => renderInline(line)).join("<br />")}</p>`
    })
    .join("")
}

export function looksLikeHtml(content: string) {
  return /<\/?[a-z][\s\S]*>/i.test(content)
}

export function normalizeInfoContentToHtml(content: string) {
  return looksLikeHtml(content) ? content : convertLegacyInfoContentToHtml(content)
}

export function sanitizeTenantRichText(content: string) {
  return sanitizeHtml(content, {
    allowedTags: ["p", "br", "strong", "em", "u", "ul", "ol", "li", "a", "h2", "h3", "blockquote"],
    allowedAttributes: {
      a: ["href", "target", "rel"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { target: "_blank", rel: "noreferrer" }),
    },
  })
}

// Versión restringida para el announcement bar de la landing.
// Solo inline: strong/em/a (y br por si hay saltos). NO permite p, h*, listas, blockquote
// porque la barra es una línea fina y bloques de párrafo rompen el layout.
export function sanitizeAnnouncementHtml(content: string) {
  return sanitizeHtml(content, {
    allowedTags: ["strong", "em", "a", "br"],
    allowedAttributes: {
      a: ["href", "target", "rel"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { target: "_blank", rel: "noreferrer" }),
    },
  })
}

export function hasMeaningfulRichText(content: string) {
  const plain = sanitizeHtml(content, { allowedTags: [], allowedAttributes: {} })
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim()

  return plain.length > 0
}
