export type SuperAdminTheme = "dark" | "light"

export const SUPER_ADMIN_THEME_STORAGE_KEY = "platea:super-admin-theme"
export const SUPER_ADMIN_THEME_COOKIE_KEY = "platea-superadmin-theme"

export function isSuperAdminTheme(value: unknown): value is SuperAdminTheme {
  return value === "dark" || value === "light"
}

export function normalizeSuperAdminTheme(value: string | null | undefined, fallback: SuperAdminTheme = "dark"): SuperAdminTheme {
  return isSuperAdminTheme(value) ? value : fallback
}

export function getEffectiveTheme(theme?: string | null, resolvedTheme?: string | null): SuperAdminTheme {
  if (isSuperAdminTheme(resolvedTheme)) return resolvedTheme
  if (isSuperAdminTheme(theme)) return theme
  return "dark"
}
