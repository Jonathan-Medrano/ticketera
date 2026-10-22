export const TENANT_INFO_PAGE_KEYS = [
  "contacto",
  "arrepentimiento",
  "terminos",
  "privacidad",
  "defensa_consumidor",
  "eliminar_cuenta",
] as const

export type TenantInfoPageKey = (typeof TENANT_INFO_PAGE_KEYS)[number]

export type TenantInfoPage = {
  key: TenantInfoPageKey
  title: string
  content: string
  enabled: boolean
}

export const TENANT_INFO_PAGE_SLUGS: Record<TenantInfoPageKey, string> = {
  contacto: "contacto",
  arrepentimiento: "arrepentimiento",
  terminos: "terminos",
  privacidad: "privacidad",
  defensa_consumidor: "defensa-consumidor",
  eliminar_cuenta: "eliminar-cuenta",
}

const DEFAULT_TENANT_INFO_PAGE_TITLES: Record<TenantInfoPageKey, string> = {
  contacto: "Contacto",
  arrepentimiento: "Arrepentimiento de compra",
  terminos: "Términos y condiciones",
  privacidad: "Políticas de privacidad",
  defensa_consumidor: "Defensa del consumidor",
  eliminar_cuenta: "Eliminar cuenta",
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

export function createDefaultTenantInfoPages(): TenantInfoPage[] {
  return TENANT_INFO_PAGE_KEYS.map((key) => ({
    key,
    title: DEFAULT_TENANT_INFO_PAGE_TITLES[key],
    content: "",
    enabled: false,
  }))
}

export function normalizeTenantInfoPages(value: unknown): TenantInfoPage[] {
  const raw = typeof value === "string"
    ? (() => {
        try {
          return JSON.parse(value)
        } catch {
          return null
        }
      })()
    : value

  const defaults = createDefaultTenantInfoPages()
  if (!Array.isArray(raw)) return defaults

  const byKey = new Map<TenantInfoPageKey, TenantInfoPage>(defaults.map((page) => [page.key, page]))

  for (const item of raw) {
    if (!isRecord(item)) continue
    const key = normalizeText(item.key) as TenantInfoPageKey
    if (!TENANT_INFO_PAGE_KEYS.includes(key)) continue
    byKey.set(key, {
      key,
      title: normalizeText(item.title) || DEFAULT_TENANT_INFO_PAGE_TITLES[key],
      content: normalizeText(item.content),
      enabled: Boolean(item.enabled),
    })
  }

  return TENANT_INFO_PAGE_KEYS.map((key) => byKey.get(key) ?? defaults.find((page) => page.key === key)!)
}

export function getTenantInfoPageLabel(key: TenantInfoPageKey) {
  return DEFAULT_TENANT_INFO_PAGE_TITLES[key]
}

export function getTenantInfoPageSlug(key: TenantInfoPageKey) {
  return TENANT_INFO_PAGE_SLUGS[key]
}

export function getTenantInfoPageKeyFromSlug(slug: string): TenantInfoPageKey | null {
  const match = Object.entries(TENANT_INFO_PAGE_SLUGS).find(([, value]) => value === slug)
  return (match?.[0] as TenantInfoPageKey | undefined) ?? null
}
