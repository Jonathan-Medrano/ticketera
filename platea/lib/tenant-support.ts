export type TenantSupportFaqItem = {
  id: string
  question: string
  answer: string
  hidden: boolean
}

function normalizeFaqItem(value: unknown, index: number): TenantSupportFaqItem | null {
  if (!value || typeof value !== "object") return null

  const candidate = value as Record<string, unknown>
  const id = typeof candidate.id === "string" && candidate.id.trim() ? candidate.id.trim() : `faq-${index + 1}`
  const question = typeof candidate.question === "string"
    ? candidate.question.trim()
    : typeof candidate.pregunta === "string"
      ? candidate.pregunta.trim()
      : ""
  const answer = typeof candidate.answer === "string"
    ? candidate.answer.trim()
    : typeof candidate.respuesta === "string"
      ? candidate.respuesta.trim()
      : ""

  if (!question || !answer) return null

  return { id, question, answer, hidden: Boolean(candidate.hidden) }
}

export function resolveTenantSupportFaqCollection(value: unknown): TenantSupportFaqItem[] {
  if (Array.isArray(value)) {
    return value.map((item, index) => normalizeFaqItem(item, index)).filter((item): item is TenantSupportFaqItem => item !== null)
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value)
      return resolveTenantSupportFaqCollection(parsed)
    } catch {
      return []
    }
  }

  return []
}

export function resolvePublicTenantSupportFaqCollection(value: unknown): TenantSupportFaqItem[] {
  return resolveTenantSupportFaqCollection(value).filter((item) => !item.hidden)
}

export function buildTenantSupportResponseMap(value: unknown): Record<string, string> {
  return Object.fromEntries(resolvePublicTenantSupportFaqCollection(value).map((item) => [item.question, item.answer]))
}
