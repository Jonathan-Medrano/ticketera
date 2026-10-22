import Google from "next-auth/providers/google"

type SearchParamsLike = {
  get(name: string): string | null
}

export const GOOGLE_AUTH_ERROR_CODES = {
  emailUnavailable: "google_email_unavailable",
  inactiveAccount: "google_account_inactive",
  emailUnverified: "google_email_unverified",
} as const

type GoogleAuthErrorCode = (typeof GOOGLE_AUTH_ERROR_CODES)[keyof typeof GOOGLE_AUTH_ERROR_CODES]

function normalizeValue(value?: string | null) {
  return value?.trim() || ""
}

function normalizeEmail(value?: string | null) {
  return normalizeValue(value).toLowerCase()
}

function splitDisplayName(name?: string | null) {
  const normalized = normalizeValue(name)
  if (!normalized) return { firstName: "", lastName: "" }

  const [firstName, ...rest] = normalized.split(/\s+/)
  return {
    firstName: firstName || "",
    lastName: rest.join(" "),
  }
}

export function createGoogleAuthProvider() {
  return Google({
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  })
}

export function resolveGoogleProfileNames(profile: Record<string, unknown> | undefined, fallbackName?: string | null) {
  const firstName = normalizeValue(typeof profile?.given_name === "string" ? profile.given_name : null)
  const lastName = normalizeValue(typeof profile?.family_name === "string" ? profile.family_name : null)

  if (firstName || lastName) {
    return { firstName, lastName }
  }

  return splitDisplayName(fallbackName)
}

export function buildGoogleOnboardingRedirect({
  email,
  firstName,
  lastName,
}: {
  email: string
  firstName?: string | null
  lastName?: string | null
}) {
  const params = new URLSearchParams({
    tab: "registro",
    completar: "true",
    oauth: "google",
    email: normalizeEmail(email),
  })

  const normalizedFirstName = normalizeValue(firstName)
  const normalizedLastName = normalizeValue(lastName)

  if (normalizedFirstName) params.set("nombre", normalizedFirstName)
  if (normalizedLastName) params.set("apellido", normalizedLastName)

  return `/login?${params.toString()}`
}

export function buildGoogleAuthErrorRedirect(code: GoogleAuthErrorCode) {
  return `/login?error=${encodeURIComponent(code)}`
}

export function resolveGoogleOnboardingPrefill(searchParams: SearchParamsLike) {
  const isGoogleOnboarding =
    searchParams.get("oauth") === "google" || searchParams.get("completar") === "true"

  return {
    isGoogleOnboarding,
    email: normalizeEmail(searchParams.get("email")),
    firstName: normalizeValue(searchParams.get("nombre")),
    lastName: normalizeValue(searchParams.get("apellido")),
  }
}

export function resolveLoginErrorMessage(error?: string | null) {
  switch (error) {
    case GOOGLE_AUTH_ERROR_CODES.emailUnavailable:
      return "Google no devolvió un email válido para continuar. Probá con otra cuenta o usá email y contraseña."
    case GOOGLE_AUTH_ERROR_CODES.inactiveAccount:
      return "Encontramos tu empresa, pero está inactiva. Contactanos para reactivar el acceso."
    case GOOGLE_AUTH_ERROR_CODES.emailUnverified:
      return "Google no confirmó que ese email esté verificado. Verificá tu casilla en Google o ingresá con email y contraseña."
    case "OAuthAccountNotLinked":
      return "Ese email ya existe con otro método de acceso. Ingresá con email y contraseña para continuar."
    case "AccessDenied":
      return "No pudimos autorizar el acceso con Google. Revisá la cuenta elegida y reintentá."
    case "CallbackRouteError":
    case "OAuthCallbackError":
    case "OAuthSignin":
      return "Falló el inicio de sesión con Google. Reintentá en unos segundos."
    case "Configuration":
      return "El login con Google no está configurado correctamente en este entorno."
    default:
      return ""
  }
}
