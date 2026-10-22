import sanitizeHtml from 'sanitize-html'

// Mirrors platea/lib/tenant-rich-text.ts sanitizeTenantRichText — same allowlist,
// kept in sync manually since backend/platea are separate sub-repos.
export function sanitizeTenantRichText(content: string) {
  return sanitizeHtml(content, {
    allowedTags: ['p', 'br', 'strong', 'em', 'u', 'ul', 'ol', 'li', 'a', 'h2', 'h3', 'blockquote'],
    allowedAttributes: {
      a: ['href', 'target', 'rel'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { target: '_blank', rel: 'noreferrer' }),
    },
  })
}
