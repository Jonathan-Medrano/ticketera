declare module "sanitize-html" {
  type Options = {
    allowedTags?: string[]
    allowedAttributes?: Record<string, string[]>
    allowedSchemes?: string[]
    transformTags?: Record<string, unknown>
  }

  type SanitizeHtml = {
    (dirty: string, options?: Options): string
    simpleTransform(tagName: string, attribs?: Record<string, string>): unknown
  }

  const sanitizeHtml: SanitizeHtml
  export default sanitizeHtml
}
