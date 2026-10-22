"use client"

import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react"
import {
  SUPER_ADMIN_THEME_COOKIE_KEY,
  normalizeSuperAdminTheme,
  SUPER_ADMIN_THEME_STORAGE_KEY,
  getEffectiveTheme,
  type SuperAdminTheme,
} from "@/components/super-admin/theme"

type AppTheme = "light" | "dark" | "system"

type AppThemeContextValue = {
  theme: AppTheme
  resolvedTheme: SuperAdminTheme
  mounted: boolean
  setTheme: (theme: AppTheme) => void
}

type SuperAdminThemeContextValue = {
  theme: SuperAdminTheme
  setTheme: (theme: SuperAdminTheme) => void
  mounted: boolean
}

const APP_THEME_STORAGE_KEY = "platea:theme"
const AppThemeContext = createContext<AppThemeContextValue | null>(null)
const SuperAdminThemeContext = createContext<SuperAdminThemeContextValue | null>(null)

function isAppTheme(value: string | null): value is AppTheme {
  return value === "light" || value === "dark" || value === "system"
}

function getSystemTheme(): SuperAdminTheme {
  if (typeof window === "undefined") return "light"
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

export default function AppThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<AppTheme>(() => {
    if (typeof window === "undefined") return "system"
    const stored = window.localStorage.getItem(APP_THEME_STORAGE_KEY)
    return isAppTheme(stored) ? stored : "system"
  })
  const [resolvedTheme, setResolvedTheme] = useState<SuperAdminTheme>(() => getEffectiveTheme(undefined, getSystemTheme()))
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  )

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)")

    const applyTheme = () => {
      const effectiveTheme = theme === "system" ? getSystemTheme() : theme
      setResolvedTheme(effectiveTheme)
      document.documentElement.classList.remove("light", "dark")
      document.documentElement.classList.add(effectiveTheme)
    }

    applyTheme()
    media.addEventListener("change", applyTheme)

    return () => {
      media.removeEventListener("change", applyTheme)
    }
  }, [theme])

  const value = useMemo<AppThemeContextValue>(
    () => ({
      theme,
      resolvedTheme,
      mounted,
      setTheme: (nextTheme) => {
        setTheme(nextTheme)
        if (typeof window !== "undefined") {
          window.localStorage.setItem(APP_THEME_STORAGE_KEY, nextTheme)
        }
      },
    }),
    [mounted, resolvedTheme, theme]
  )

  return (
    <AppThemeContext.Provider value={value}>{children}</AppThemeContext.Provider>
  )
}

export function SuperAdminThemeProvider({ children, initialTheme = "dark" }: { children: React.ReactNode; initialTheme?: SuperAdminTheme }) {
  const [theme, setTheme] = useState<SuperAdminTheme>(() => {
    if (typeof window === "undefined") return initialTheme
    return normalizeSuperAdminTheme(window.localStorage.getItem(SUPER_ADMIN_THEME_STORAGE_KEY), initialTheme)
  })
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  )

  const value = useMemo<SuperAdminThemeContextValue>(
    () => ({
      theme,
      mounted,
      setTheme: (nextTheme) => {
        setTheme(nextTheme)
        if (typeof window !== "undefined") {
          window.localStorage.setItem(SUPER_ADMIN_THEME_STORAGE_KEY, nextTheme)
          document.cookie = `${SUPER_ADMIN_THEME_COOKIE_KEY}=${nextTheme}; path=/; max-age=31536000; samesite=lax`
        }
      },
    }),
    [initialTheme, mounted, theme]
  )

  return (
    <SuperAdminThemeContext.Provider value={value}>
      <div className="contents" data-superadmin-theme={mounted ? theme : initialTheme} suppressHydrationWarning>
        {children}
      </div>
    </SuperAdminThemeContext.Provider>
  )
}

export function useOptionalSuperAdminTheme() {
  return useContext(SuperAdminThemeContext)
}

export function useAppTheme() {
  const context = useContext(AppThemeContext)

  if (!context) {
    throw new Error("useAppTheme must be used within AppThemeProvider")
  }

  return context
}
