// NEXT_PUBLIC_ROOT_DOMAIN es crítica en producción: se usa para construir URLs de tenant
// en todos los emails de confirmación. Si falta, todas las URLs quedan como 'Ticketera.local'.
if (process.env.NODE_ENV === 'production' && !process.env.NEXT_PUBLIC_ROOT_DOMAIN) {
  throw new Error('[host-domains] NEXT_PUBLIC_ROOT_DOMAIN es requerida en producción')
}

function normalizeHostname(value: string) {
  return value.trim().toLowerCase()
}

function tryReadHostname(input?: string | null) {
  if (!input?.trim()) return null

  const raw = input.trim()

  try {
    return normalizeHostname(new URL(raw).hostname)
  } catch {
    return normalizeHostname(raw.split(":")[0] || raw)
  }
}

export function getConfiguredRootHostname() {
  return tryReadHostname(process.env.NEXT_PUBLIC_ROOT_DOMAIN) || "Ticketera.local"
}

export function getConfiguredAppHostname() {
  return tryReadHostname(process.env.NEXT_PUBLIC_APP_URL)
}

export function getMainDomainCandidates() {
  const candidates: (string | null)[] = [
    getConfiguredRootHostname(),
    getConfiguredAppHostname(),
  ]

  if (process.env.NODE_ENV !== 'production') {
    candidates.push('Ticketera.local', 'localhost')
  }

  return Array.from(new Set(candidates.filter((value): value is string => Boolean(value))))
}
