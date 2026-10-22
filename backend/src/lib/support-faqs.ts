import { prisma } from './prisma'
import { sanitizeTenantRichText } from './tenant-rich-text'

export type SupportFaqRecord = {
  id: string
  question: string
  answer: string
  hidden: boolean
}

type EmpresaFaqRow = {
  id: string
  faqs: string | null
}

export const DEFAULT_SUPPORT_FAQS: ReadonlyArray<SupportFaqRecord> = [
  {
    id: 'faq-default-my-tickets',
    question: '¿Dónde veo mis tickets?',
    answer: 'Podés encontrarlos en Mis tickets con el mismo email que usaste para comprar.',
    hidden: false,
  },
  {
    id: 'faq-default-download-ticket',
    question: '¿Cómo descargo o presento mi entrada?',
    answer: 'Abrí tu compra desde el email de confirmación o desde Mis tickets y mostrá el código al ingresar.',
    hidden: false,
  },
  {
    id: 'faq-default-refunds',
    question: '¿Puedo pedir un reembolso?',
    answer: 'Los reembolsos dependen de la política del evento. Si necesitás ayuda con tu caso, contactanos por este canal.',
    hidden: false,
  },
  {
    id: 'faq-default-confirmation-email',
    question: '¿Qué hago si no encuentro el mail de confirmación?',
    answer: 'Revisá spam o promociones. Si no aparece, buscá tu compra en Mis tickets o escribinos con el email usado en la compra.',
    hidden: false,
  },
] as const

export function getDefaultSupportFaqs(): SupportFaqRecord[] {
  return DEFAULT_SUPPORT_FAQS.map((faq) => ({ ...faq }))
}

function normalizeSupportFaqItem(item: unknown, index: number): SupportFaqRecord | null {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null

  const record = item as Record<string, unknown>
  const id = typeof record.id === 'string' && record.id.trim() ? record.id.trim() : `faq-${index + 1}`
  const question = typeof record.question === 'string'
    ? record.question.trim()
    : typeof record.pregunta === 'string'
      ? record.pregunta.trim()
      : ''
  const answer = typeof record.answer === 'string'
    ? record.answer.trim()
    : typeof record.respuesta === 'string'
      ? record.respuesta.trim()
      : ''

  if (!question || !answer) return null

  return { id, question, answer: sanitizeTenantRichText(answer), hidden: Boolean(record.hidden) }
}

export function normalizeSupportFaqCollection(value: unknown): SupportFaqRecord[] {
  if (Array.isArray(value)) {
    return value.map((item, index) => normalizeSupportFaqItem(item, index)).filter((item): item is SupportFaqRecord => item !== null)
  }

  if (typeof value === 'string') {
    try {
      return normalizeSupportFaqCollection(JSON.parse(value))
    } catch {
      return []
    }
  }

  return []
}

export function resolvePublicSupportFaqCollection(value: unknown): SupportFaqRecord[] {
  return normalizeSupportFaqCollection(value).filter((item) => !item.hidden)
}

export function isEmptySupportFaqValue(value: unknown): boolean {
  if (value === null || value === undefined) return true

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return true

    try {
      const parsed = JSON.parse(trimmed)
      return Array.isArray(parsed) && parsed.length === 0
    } catch {
      return false
    }
  }

  return Array.isArray(value) && value.length === 0
}

export async function backfillEmptyEmpresaSupportFaqs() {
  const rows = await prisma.empresa.findMany({
    select: { id: true, faqs: true },
  })
  const defaultFaqsJson = JSON.stringify(getDefaultSupportFaqs())

  let updated = 0
  for (const row of rows) {
    if (!isEmptySupportFaqValue(row.faqs)) continue

    await prisma.empresa.update({
      where: { id: row.id },
      data: { faqs: defaultFaqsJson },
    })

    updated += 1
  }

  return { updated }
}
