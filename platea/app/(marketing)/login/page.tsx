"use client"

import { Suspense, useId, useRef, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { signIn } from "next-auth/react"
import { useSearchParams } from "next/navigation"
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  Globe,
  LayoutDashboard,
  Loader2,
  ScanLine,
  Store,
  Users,
  UtensilsCrossed,
  XCircle,
} from "lucide-react"
import { AnimatePresence, LayoutGroup, motion } from "framer-motion"

import PasswordInput from "@/components/password-input"
import PasswordStrength from "@/components/password-strength"
import { PASSWORD_POLICY_HELPER_TEXT, validatePasswordPolicy } from "@/lib/password-policy"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { resolveGoogleOnboardingPrefill, resolveLoginErrorMessage } from "@/lib/google-auth"
import {
  marketingFieldClass as fieldClassName,
  marketingGoogleButtonClass as googleButtonClass,
  marketingPrimaryButtonClass as primaryButtonClass,
  marketingSecondaryButtonClass as secondaryButtonClass,
} from "@/lib/marketing/auth-classes"
import { cn } from "@/lib/utils"

const GoogleIcon = () => (
  <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
  </svg>
)

type Paso = "cuenta" | "empresa"

interface DatosCuenta {
  nombre: string
  apellido: string
  email: string
  password: string
  confirmar: string
}

interface DatosEmpresa {
  nombreEmpresa: string
  slug: string
  adminNombre: string
  adminApellido: string
}

type InlineMessageTone = "error" | "warning"

function InlineMessage({
  children,
  tone,
  id,
}: {
  children: React.ReactNode
  tone: InlineMessageTone
  id?: string
}) {
  const toneClassName =
    tone === "warning"
      ? "border-border/60 bg-muted/60 text-foreground/80"
      : "border-destructive/30 bg-destructive/10 text-destructive"

  return (
    <div
      id={id}
      role={tone === "error" ? "alert" : "status"}
      aria-live={tone === "error" ? "assertive" : "polite"}
      className={cn("flex items-start gap-3 rounded-xl border px-4 py-3 text-sm leading-6", toneClassName)}
    >
      <CircleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
      <div>{children}</div>
    </div>
  )
}

function FieldHint({ id, children, error = false }: { id?: string; children: React.ReactNode; error?: boolean }) {
  return (
    <p id={id} className={cn("text-xs leading-5", error ? "text-destructive" : "text-[color:var(--marketing-muted)]")}>
      {children}
    </p>
  )
}

function StepIndicator({ paso }: { paso: Paso }) {
  const onStep2 = paso === "empresa"
  return (
    <div className="mb-5 flex items-center gap-3">
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[color:var(--marketing-accent)] text-white">
        {onStep2 ? (
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
        ) : (
          <span className="text-[11px] font-bold">1</span>
        )}
      </div>
      <div
        className={cn(
          "h-px flex-1 transition-colors duration-300",
          onStep2 ? "bg-[color:var(--marketing-accent)]" : "bg-[color:var(--marketing-border)]"
        )}
      />
      <div
        className={cn(
          "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold transition-colors duration-300",
          onStep2
            ? "bg-[color:var(--marketing-accent)] text-white"
            : "border border-[color:var(--marketing-border)] text-[color:var(--marketing-muted)]"
        )}
      >
        2
      </div>
    </div>
  )
}

function getInitials(nombre: string, apellido: string) {
  const first = nombre.trim().charAt(0).toUpperCase()
  const last = apellido.trim().charAt(0).toUpperCase()
  return `${first}${last}` || "?"
}

const splitFeatures = [
  { icon: Globe, label: "Sitio propio" },
  { icon: ScanLine, label: "QR check-in" },
  { icon: LayoutDashboard, label: "Dashboard" },
  { icon: Users, label: "Equipo + roles" },
  { icon: Store, label: "Revendedores" },
  { icon: UtensilsCrossed, label: "Consumibles" },
] as const

const PANEL_AVATAR_COLORS = ["#0052cc", "#7c3aed", "#059669", "#dc2626"]

function SocialProof() {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/4 px-5 py-4">
      <div className="flex items-center gap-4">
        <div className="flex shrink-0 -space-x-2.5">
          {PANEL_AVATAR_COLORS.map((color, i) => (
            <div
              key={i}
              aria-hidden="true"
              className="h-8 w-8 rounded-full border-2 border-[#030c1a]"
              style={{ background: color }}
            />
          ))}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-tight text-white">+50 productoras activas</p>
          <p className="mt-0.5 text-xs leading-snug text-white/45">
            ya operan sus eventos con Ticketera
          </p>
        </div>
      </div>
    </div>
  )
}

function PanelIdentityCard({
  iconNode,
  primary,
  secondary,
  primaryPlaceholder,
  secondaryPlaceholder,
}: {
  iconNode: React.ReactNode
  primary: string
  secondary: string
  primaryPlaceholder: string
  secondaryPlaceholder: string
}) {
  const hasPrimary = primary.trim().length > 0
  const hasSecondary = secondary.trim().length > 0
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-white/10 bg-white/5 px-5 py-4 backdrop-blur-sm">
      <div className="shrink-0">{iconNode}</div>
      <div className="min-w-0 flex-1">
        <p className={cn("truncate text-sm font-semibold", hasPrimary ? "text-white" : "text-white/25")}>
          {hasPrimary ? primary : primaryPlaceholder}
        </p>
        <p className="mt-0.5 truncate text-xs text-white/45">
          {hasSecondary ? secondary : secondaryPlaceholder}
        </p>
      </div>
    </div>
  )
}

function UserGlyph() {
  return (
    <span className="grid h-10 w-10 place-items-center rounded-full bg-blue-500/15 text-blue-400">
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    </span>
  )
}

function InitialsGlyph({ initials }: { initials: string }) {
  return (
    <span className="grid h-10 w-10 place-items-center rounded-full bg-blue-500/15 text-xs font-bold text-blue-400">
      {initials}
    </span>
  )
}

function BrandGlyph({ letter }: { letter: string }) {
  return (
    <span className="grid h-10 w-10 place-items-center rounded-2xl bg-blue-900/60 text-sm font-bold text-blue-300">
      {letter}
    </span>
  )
}

function PanelContent({
  tab,
  paso,
  loginData,
  datosCuenta,
  datosEmpresa,
}: {
  tab: string
  paso: Paso
  loginData: { email: string; password: string }
  datosCuenta: DatosCuenta
  datosEmpresa: DatosEmpresa
}) {
  if (tab === "login") {
    return (
      <>
        <div className="space-y-3">
          <p className="text-xs font-bold uppercase tracking-[0.3em] text-blue-400">Iniciá sesión</p>
          <h2 className="text-4xl font-bold leading-[1.06] tracking-tight text-white sm:text-5xl">
            Volvé a tu<br />espacio.
          </h2>
          <p className="text-base leading-relaxed text-white/55">
            Toda tu operación en Ticketera — eventos, accesos, equipo — espera detrás de tu acceso.
          </p>
        </div>
        <PanelIdentityCard
          iconNode={<UserGlyph />}
          primary={loginData.email}
          secondary="Cuenta empresa"
          primaryPlaceholder="tu@email.com"
          secondaryPlaceholder="Cuenta empresa"
        />
      </>
    )
  }

  if (paso === "cuenta") {
    const hasName = datosCuenta.nombre.trim().length > 0
    const displayName = hasName ? `${datosCuenta.nombre} ${datosCuenta.apellido}`.trim() : ""
    return (
      <>
        <div className="space-y-3">
          <p className="text-xs font-bold uppercase tracking-[0.3em] text-blue-400">Empecemos</p>
          <h2 className="text-4xl font-bold leading-[1.06] tracking-tight text-white sm:text-5xl">
            Tu próxima<br />edición empieza acá.
          </h2>
          <p className="text-base leading-relaxed text-white/55">
            Ticketera reúne venta, accesos y control en un solo lugar. Empezá creando tu cuenta.
          </p>
        </div>
        <PanelIdentityCard
          iconNode={hasName ? <InitialsGlyph initials={getInitials(datosCuenta.nombre, datosCuenta.apellido)} /> : <UserGlyph />}
          primary={displayName}
          secondary={datosCuenta.email}
          primaryPlaceholder="Tu nombre"
          secondaryPlaceholder="tu@email.com"
        />
      </>
    )
  }

  const hasEmpresa = datosEmpresa.nombreEmpresa.trim().length > 0
  const hasSlug = datosEmpresa.slug.trim().length > 0
  const letter = hasEmpresa ? datosEmpresa.nombreEmpresa.trim().charAt(0).toUpperCase() : "V"
  return (
    <>
      <div className="space-y-3">
        <p className="text-xs font-bold uppercase tracking-[0.3em] text-blue-400">Tu espacio</p>
        <h2 className="text-4xl font-bold leading-[1.06] tracking-tight text-white sm:text-5xl">
          Tu marca,<br />en su propio dominio.
        </h2>
        <p className="text-base leading-relaxed text-white/55">
          Subdominio dedicado y panel listo para tu primer evento. Personalizable en minutos.
        </p>
      </div>
      <PanelIdentityCard
        iconNode={<BrandGlyph letter={letter} />}
        primary={datosEmpresa.nombreEmpresa}
        secondary={hasSlug ? `${datosEmpresa.slug}.ticketera.com` : ""}
        primaryPlaceholder="Tu empresa"
        secondaryPlaceholder="tu-marca.ticketera.com"
      />
    </>
  )
}

function AuthContent() {
  const searchParams = useSearchParams()
  const googleOnboardingPrefill = resolveGoogleOnboardingPrefill(searchParams)
  const authSearchError = resolveLoginErrorMessage(searchParams.get("error"))
  const tabInicial = searchParams.get("tab") === "registro" || googleOnboardingPrefill.isGoogleOnboarding ? "registro" : "login"
  const sessionReason = searchParams.get("reason")
  const emailVerified = searchParams.get("verified") === "1"
  const verifiedEmail = (searchParams.get("email") ?? "").trim().toLowerCase()
  const formId = useId()

  const [tab, setTab] = useState(tabInicial)
  const [paso, setPaso] = useState<Paso>("cuenta")
  const [loadingCredentials, setLoadingCredentials] = useState(false)
  const [loadingGoogle, setLoadingGoogle] = useState(false)
  const [error, setError] = useState("")

  const [loginData, setLoginData] = useState({
    email: emailVerified ? verifiedEmail : "",
    password: "",
  })

  const [datosCuenta, setDatosCuenta] = useState<DatosCuenta>({
    nombre: googleOnboardingPrefill.firstName,
    apellido: googleOnboardingPrefill.lastName,
    email: googleOnboardingPrefill.email,
    password: "",
    confirmar: "",
  })

  const [datosEmpresa, setDatosEmpresa] = useState<DatosEmpresa>({
    nombreEmpresa: "",
    slug: "",
    adminNombre: googleOnboardingPrefill.firstName,
    adminApellido: googleOnboardingPrefill.lastName,
  })

  const [slugStatus, setSlugStatus] = useState<"idle" | "checking" | "available" | "taken" | "invalid">("idle")
  const slugDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const slugAbortRef = useRef<AbortController | null>(null)

  function handleSlugChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "")
    setDatosEmpresa((prev) => ({ ...prev, slug: raw }))

    if (slugDebounceRef.current) clearTimeout(slugDebounceRef.current)
    if (slugAbortRef.current) slugAbortRef.current.abort()

    if (raw.length < 3 || !/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(raw)) {
      setSlugStatus("idle")
      return
    }

    setSlugStatus("checking")

    slugDebounceRef.current = setTimeout(async () => {
      const controller = new AbortController()
      slugAbortRef.current = controller
      try {
        const res = await fetch(`/api/auth/check-slug?slug=${encodeURIComponent(raw)}`, {
          signal: controller.signal,
        })
        if (!res.ok) { setSlugStatus("idle"); return }
        const data = await res.json()
        setSlugStatus(data.available ? "available" : "taken")
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return
        setSlugStatus("idle")
      }
    }, 400)
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setLoadingCredentials(true)

    const timeoutId = setTimeout(() => {
      setLoadingCredentials(false)
      setError("El login está tardando demasiado. Probá de nuevo en un momento.")
    }, 15000)

    function isRateLimited(res: { status?: number; error?: string | null } | null | undefined) {
      return res?.status === 429
    }

    function rateLimitMessage(res: { error?: string | null } | null | undefined) {
      return res?.error || "Demasiados intentos de login. Esperá unos minutos antes de reintentar."
    }

    try {
      const resEmpresa = await signIn("credentials-empresa", {
        email: loginData.email,
        password: loginData.password,
        redirect: false,
        callbackUrl: "/dashboard",
      })

      if (resEmpresa?.ok && !resEmpresa.error) {
        clearTimeout(timeoutId)
        window.location.assign(resEmpresa.url ?? "/dashboard")
        return
      }

      if (isRateLimited(resEmpresa)) {
        setError(rateLimitMessage(resEmpresa))
        return
      }

      const resEmpleado = await signIn("credentials-empleado", {
        email: loginData.email,
        password: loginData.password,
        redirect: false,
        callbackUrl: "/login",
      })

      if (resEmpleado?.ok && !resEmpleado.error) {
        clearTimeout(timeoutId)
        window.location.assign(resEmpleado.url ?? "/login")
        return
      }

      if (isRateLimited(resEmpleado)) {
        setError(rateLimitMessage(resEmpleado))
        return
      }

      setError("Email o contraseña incorrectos")
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error inesperado al iniciar sesión"
      setError(message)
    } finally {
      clearTimeout(timeoutId)
      setLoadingCredentials(false)
    }
  }

  function handlePaso1(e: React.FormEvent) {
    e.preventDefault()
    setError("")

    if (datosCuenta.password !== datosCuenta.confirmar) {
      setError("Las contraseñas no coinciden")
      return
    }

    const passwordValidationError = validatePasswordPolicy(datosCuenta.password)
    if (passwordValidationError) {
      setError(passwordValidationError)
      return
    }

    setDatosEmpresa((prev) => ({
      ...prev,
      adminNombre: datosCuenta.nombre,
      adminApellido: datosCuenta.apellido,
    }))

    setPaso("empresa")
  }

  async function handleRegistroFinal(e: React.FormEvent) {
    e.preventDefault()
    setError("")

    if (!/^[a-z0-9-]+$/.test(datosEmpresa.slug)) {
      setError("El subdominio solo puede tener letras minúsculas, números y guiones")
      return
    }

    if (datosEmpresa.slug.includes("ticketera")) {
      setError("Ese subdominio no está disponible")
      return
    }

    setLoadingCredentials(true)

    const res = await fetch("/api/auth/registro", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nombre: datosEmpresa.nombreEmpresa,
        slug: datosEmpresa.slug,
        email: datosCuenta.email,
        password: datosCuenta.password,
        admin_nombre: datosEmpresa.adminNombre,
        admin_apellido: datosEmpresa.adminApellido || null,
      }),
    })

    const data = await res.json()
    setLoadingCredentials(false)

    if (!res.ok) {
      setError(data.error)
      return
    }

    window.location.assign(`/verificar-email?email=${encodeURIComponent(datosCuenta.email)}`)
  }

  async function handleGoogle() {
    setError("")
    setLoadingGoogle(true)
    await signIn("google", { callbackUrl: "/dashboard" })
  }

  const loginErrorId = `${formId}-login-error`
  const loginPasswordHintId = `${formId}-login-password-hint`
  const confirmPasswordErrorId = `${formId}-confirm-password-error`
  const slugErrorId = `${formId}-slug-error`
  const registerErrorId = `${formId}-register-error`
  const registerPasswordHintId = `${formId}-register-password-hint`
  const registerTermsHintId = `${formId}-register-terms-hint`
  const slugHintId = `${formId}-slug-hint`
  const slugStatusId = `${formId}-slug-status`

  const passwordTooShort = error === PASSWORD_POLICY_HELPER_TEXT
  const passwordMismatch = error === "Las contraseñas no coinciden"
  const slugInvalid = error === "El subdominio solo puede tener letras minúsculas, números y guiones"

  const loginError = tab === "login" ? error : ""
  const registerError = tab === "registro" && !passwordTooShort && !passwordMismatch && !slugInvalid ? error : ""
  const registerInfo = googleOnboardingPrefill.isGoogleOnboarding
    ? "Ya validamos tu cuenta Google. Definí una contraseña y completá los datos de tu empresa para terminar el alta."
    : ""

  const divider = <div className="my-5 h-px w-full bg-[color:var(--marketing-border)]" aria-hidden="true" />

  function switchTab(next: string) {
    setTab(next)
    setError("")
    setPaso("cuenta")
  }

  return (
    <div className="marketing-shell flex min-h-screen flex-col">
      <main
        id="main-content"
        tabIndex={-1}
        className="relative flex flex-1 flex-col focus:outline-none lg:flex-row"
      >
        {/* ── Left: form panel ─────────────────────────────────────── */}
        <motion.section
          layout="position"
          transition={{ type: "spring", stiffness: 220, damping: 26 }}
          className={cn(
            "relative flex w-full flex-col px-6 py-10 sm:px-10 sm:py-12 lg:w-1/2 lg:px-16 lg:py-16 xl:px-24",
            tab === "registro" ? "lg:order-2" : "lg:order-1"
          )}
        >
          {/* Subtle bg blobs — light mode only */}
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
            <div className="absolute right-0 top-0 h-72 w-72 rounded-full bg-[color:var(--marketing-accent)]/6 blur-3xl" />
            <div className="absolute bottom-0 left-0 h-56 w-56 rounded-full bg-[#ffae84]/10 blur-3xl" />
          </div>

          {/* Logo */}
          <Link
            href="/"
            aria-label="Ticketera"
            className="inline-flex items-center gap-2.5 self-start rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--marketing-accent)] focus-visible:ring-offset-2"
          >
            <Image src="/ticketera_logo_app.svg" alt="" width={36} height={36} priority className="shrink-0" />
            <span className="marketing-brand-wordmark text-[1.7rem] leading-none sm:text-[1.9rem]">
              Ticket<span>era</span>
            </span>
          </Link>

          {/* Form area */}
          <div className="mx-auto mt-8 w-full max-w-md flex-1 sm:mt-10 lg:mt-0 lg:flex lg:flex-col lg:justify-center lg:pt-4">
            {/* Tab switcher — pill style */}
            <LayoutGroup>
              <div
                role="tablist"
                className="mb-8 flex gap-1 rounded-xl bg-black/[0.04] p-1 dark:bg-white/[0.06]"
              >
                {(["login", "registro"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="tab"
                    aria-selected={tab === t}
                    onClick={() => switchTab(t)}
                    className={cn(
                      "relative flex-1 rounded-lg py-2.5 text-sm font-semibold transition-colors duration-150",
                      tab === t
                        ? "text-[color:var(--marketing-ink-strong)]"
                        : "text-[color:var(--marketing-muted)] hover:text-[color:var(--marketing-ink)]"
                    )}
                  >
                    {tab === t && (
                      <motion.div
                        layoutId="auth-tab-pill"
                        className="absolute inset-0 rounded-lg bg-[color:var(--marketing-surface)] shadow-[0_1px_3px_rgba(0,0,0,0.08),0_0_0_1px_rgba(0,0,0,0.05)] dark:bg-white/[0.10] dark:shadow-[0_0_0_1px_rgba(255,255,255,0.10)]"
                        transition={{ type: "spring", stiffness: 380, damping: 32 }}
                      />
                    )}
                    <span className="relative z-10">
                      {t === "login" ? "Iniciar sesión" : "Crear cuenta"}
                    </span>
                  </button>
                ))}
              </div>
            </LayoutGroup>

            {/* ── Tab panels (animated) ── */}
            <AnimatePresence mode="wait" initial={false}>
            {tab === "login" && (
            <motion.div
              key="tab-login"
              role="tabpanel"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.22, ease: [0.25, 0, 0.25, 1] }}
            >
              <div className="space-y-2 mb-8">
                <h1 className="text-2xl font-bold tracking-tight text-[color:var(--marketing-ink-strong)] sm:text-3xl">
                  Bienvenido de vuelta
                </h1>
                <p className="text-sm text-[color:var(--marketing-muted)]">
                  Ingresá con tu cuenta para seguir operando tu espacio.
                </p>
              </div>

              {emailVerified && (
                <div className="mb-5">
                  <div
                    role="status"
                    aria-live="polite"
                    className="flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm leading-6 text-primary"
                  >
                    <CheckCircle2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
                    <div>Email verificado, ya podés iniciar sesión.</div>
                  </div>
                </div>
              )}

              {sessionReason === "session" && (
                <div className="mb-5">
                  <InlineMessage tone="warning">
                    Tu sesión ya no es válida o tu acceso fue desactivado. Iniciá sesión nuevamente para continuar.
                  </InlineMessage>
                </div>
              )}

              {authSearchError && (
                <div className="mb-5">
                  <InlineMessage tone="error">{authSearchError}</InlineMessage>
                </div>
              )}

              <form onSubmit={handleLogin} className="space-y-4" noValidate>
                <div className="space-y-1.5">
                  <Label htmlFor="login-email">Email o usuario</Label>
                  <Input
                    id="login-email"
                    name="email"
                    className={fieldClassName}
                    type="text"
                    inputMode="email"
                    autoComplete="username"
                    placeholder="tu@email.com"
                    value={loginData.email}
                    onChange={(e) => setLoginData({ ...loginData, email: e.target.value })}
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="login-password">Contraseña</Label>
                    <Link
                      href="/login/reset"
                      className="rounded-md px-1 text-xs font-semibold text-primary underline-offset-4 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--marketing-accent)] focus-visible:ring-offset-2"
                    >
                      Olvidé mi contraseña
                    </Link>
                  </div>
                  <PasswordInput
                    id="login-password"
                    name="current-password"
                    className={fieldClassName}
                    placeholder="•••••••••••••"
                    autoComplete="current-password"
                    value={loginData.password}
                    onChange={(e) => setLoginData({ ...loginData, password: e.target.value })}
                    aria-invalid={Boolean(loginError)}
                    aria-describedby={loginError ? `${loginPasswordHintId} ${loginErrorId}` : loginPasswordHintId}
                    required
                  />
                  <FieldHint id={loginPasswordHintId}>
                    Recuperá la contraseña de la cuenta empresa o de un usuario del equipo.
                  </FieldHint>
                </div>

                {loginError ? (
                  <InlineMessage id={loginErrorId} tone="error">
                    {loginError}
                  </InlineMessage>
                ) : null}

                <Button type="submit" className={primaryButtonClass} disabled={loadingCredentials}>
                  {loadingCredentials ? "Ingresando..." : "Iniciar sesión"}
                </Button>
              </form>

              {divider}

              <Button variant="outline" className={googleButtonClass} onClick={handleGoogle} disabled={loadingGoogle}>
                <GoogleIcon />
                {loadingGoogle ? "Redirigiendo..." : "Continuar con Google"}
              </Button>
            </motion.div>
            )}
            {tab === "registro" && (
            <motion.div
              key="tab-registro"
              role="tabpanel"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.22, ease: [0.25, 0, 0.25, 1] }}
            >
              <AnimatePresence mode="wait" initial={false}>
              {paso === "cuenta" && (
              <motion.div
                key="paso-cuenta"
                initial={{ opacity: 0, x: 14 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.18, ease: [0.25, 0, 0.25, 1] }}
              >
                <StepIndicator paso="cuenta" />
                <div className="space-y-2 mb-8">
                  <h1 className="text-2xl font-bold tracking-tight text-[color:var(--marketing-ink-strong)] sm:text-3xl">
                    Creá tu cuenta
                  </h1>
                  <p className="text-sm text-[color:var(--marketing-muted)]">
                    Tus datos personales de acceso para empezar a configurar el espacio.
                  </p>
                </div>

                {registerInfo ? (
                  <div className="mb-5">
                    <InlineMessage tone="warning">{registerInfo}</InlineMessage>
                  </div>
                ) : null}

                {authSearchError ? (
                  <div className="mb-5">
                    <InlineMessage tone="error">{authSearchError}</InlineMessage>
                  </div>
                ) : null}

                <form onSubmit={handlePaso1} className="space-y-4" noValidate>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="register-nombre">Nombre</Label>
                      <Input
                        id="register-nombre"
                        name="given-name"
                        className={fieldClassName}
                        type="text"
                        autoComplete="given-name"
                        placeholder="Juan"
                        value={datosCuenta.nombre}
                        onChange={(e) => setDatosCuenta({ ...datosCuenta, nombre: e.target.value })}
                        required
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="register-apellido">
                        Apellido{" "}
                        <span className="font-normal text-[color:var(--marketing-muted)]">(opcional)</span>
                      </Label>
                      <Input
                        id="register-apellido"
                        name="family-name"
                        className={fieldClassName}
                        type="text"
                        autoComplete="family-name"
                        placeholder="García"
                        value={datosCuenta.apellido}
                        onChange={(e) => setDatosCuenta({ ...datosCuenta, apellido: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="register-email">Email</Label>
                    <Input
                      id="register-email"
                      name="email"
                      className={fieldClassName}
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      placeholder="tu@empresa.com"
                      value={datosCuenta.email}
                      onChange={(e) => setDatosCuenta({ ...datosCuenta, email: e.target.value })}
                      disabled={googleOnboardingPrefill.isGoogleOnboarding}
                      required
                    />
                    {googleOnboardingPrefill.isGoogleOnboarding ? (
                      <FieldHint>Vamos a crear la cuenta con el email que ya validaste en Google.</FieldHint>
                    ) : null}
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="register-password">Contraseña</Label>
                    <PasswordInput
                      id="register-password"
                      name="new-password"
                      className={fieldClassName}
                      placeholder="Contraseña segura"
                      autoComplete="new-password"
                      value={datosCuenta.password}
                      onChange={(e) => setDatosCuenta({ ...datosCuenta, password: e.target.value })}
                      aria-invalid={passwordTooShort || passwordMismatch}
                      aria-describedby={
                        passwordMismatch
                          ? `${registerPasswordHintId} ${confirmPasswordErrorId}`
                          : registerPasswordHintId
                      }
                      required
                    />
                    <PasswordStrength password={datosCuenta.password} id={registerPasswordHintId} />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="register-confirm">Confirmar contraseña</Label>
                    <PasswordInput
                      id="register-confirm"
                      name="confirm-password"
                      className={fieldClassName}
                      placeholder="•••••••••••••"
                      autoComplete="new-password"
                      value={datosCuenta.confirmar}
                      onChange={(e) => setDatosCuenta({ ...datosCuenta, confirmar: e.target.value })}
                      aria-invalid={passwordMismatch}
                      aria-describedby={passwordMismatch ? confirmPasswordErrorId : undefined}
                      required
                    />
                    {passwordMismatch ? (
                      <FieldHint id={confirmPasswordErrorId} error>
                        Las contraseñas no coinciden.
                      </FieldHint>
                    ) : null}
                  </div>

                  {registerError ? (
                    <InlineMessage id={registerErrorId} tone="error">
                      {registerError}
                    </InlineMessage>
                  ) : null}

                  <Button type="submit" className={primaryButtonClass}>
                    Continuar <ArrowRight aria-hidden="true" className="h-4 w-4" />
                  </Button>
                </form>

                {divider}

                <Button
                  variant="outline"
                  className={googleButtonClass}
                  onClick={handleGoogle}
                  disabled={loadingGoogle}
                >
                  <GoogleIcon />
                  {loadingGoogle ? "Redirigiendo..." : "Registrarse con Google"}
                </Button>

                <p
                  id={registerTermsHintId}
                  className="mt-4 text-center text-xs leading-6 text-[color:var(--marketing-muted)]"
                >
                  Al registrarte aceptás los{" "}
                  <Link
                    href="/terminos"
                    className="rounded-md px-1 font-medium underline decoration-[color:var(--marketing-muted)]/50 underline-offset-4 transition-colors hover:text-[color:var(--marketing-ink-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--marketing-accent)] focus-visible:ring-offset-2"
                  >
                    términos de uso
                  </Link>{" "}
                  y la comisión del 4% por venta de entradas.
                </p>
              </motion.div>
              )}
              {paso === "empresa" && (
              <motion.div
                key="paso-empresa"
                initial={{ opacity: 0, x: 14 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.18, ease: [0.25, 0, 0.25, 1] }}
              >
                <StepIndicator paso="empresa" />
                <div className="space-y-2 mb-8">
                  <h1 className="text-2xl font-bold tracking-tight text-[color:var(--marketing-ink-strong)] sm:text-3xl">
                    Tu empresa
                  </h1>
                  <p className="text-sm text-[color:var(--marketing-muted)]">
                    Configurá tu espacio en Ticketera sin salir de este flujo.
                  </p>
                </div>

                <form onSubmit={handleRegistroFinal} className="space-y-5" noValidate>
                  <div className="space-y-1.5">
                    <Label htmlFor="empresa-nombre">Nombre de la empresa</Label>
                    <Input
                      id="empresa-nombre"
                      name="organization"
                      className={fieldClassName}
                      type="text"
                      autoComplete="organization"
                      placeholder="Teatro Sur"
                      value={datosEmpresa.nombreEmpresa}
                      onChange={(e) =>
                        setDatosEmpresa({ ...datosEmpresa, nombreEmpresa: e.target.value })
                      }
                      required
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="empresa-slug">Subdominio</Label>
                    <div className="flex flex-row items-stretch gap-0">
                      <Input
                        id="empresa-slug"
                        name="subdominio"
                        type="text"
                        autoComplete="off"
                        placeholder="teatrosur"
                        className={cn(
                          fieldClassName,
                          "flex-1 min-w-0 rounded-r-none border-r-0"
                        )}
                        value={datosEmpresa.slug}
                        onChange={handleSlugChange}
                        aria-invalid={slugInvalid || slugStatus === "taken"}
                        aria-describedby={
                          slugInvalid
                            ? slugErrorId
                            : slugStatus !== "idle"
                            ? slugStatusId
                            : slugHintId
                        }
                        required
                      />
                      <span className="inline-flex h-11 shrink-0 items-center rounded-l-none rounded-r-xl border border-l-0 border-[color:var(--marketing-border)] bg-[color:var(--marketing-surface)]/60 px-3 text-sm text-[color:var(--marketing-muted)] whitespace-nowrap">
                        .ticketera.com
                      </span>
                    </div>
                    {slugInvalid ? (
                      <FieldHint id={slugErrorId} error>
                        El subdominio solo puede tener letras minúsculas, números y guiones.
                      </FieldHint>
                    ) : slugStatus === "checking" ? (
                      <p
                        id={slugStatusId}
                        role="status"
                        aria-live="polite"
                        className="flex items-center gap-1.5 text-xs leading-5 text-[color:var(--marketing-muted)]"
                      >
                        <Loader2 aria-hidden="true" className="h-3 w-3 animate-spin" />
                        Verificando...
                      </p>
                    ) : slugStatus === "available" ? (
                      <p
                        id={slugStatusId}
                        role="status"
                        aria-live="polite"
                        className="flex items-center gap-1.5 text-xs leading-5 text-primary"
                      >
                        <CheckCircle2 aria-hidden="true" className="h-3 w-3" />
                        Disponible
                      </p>
                    ) : slugStatus === "taken" ? (
                      <p
                        id={slugStatusId}
                        role="alert"
                        aria-live="assertive"
                        className="flex items-center gap-1.5 text-xs leading-5 text-destructive"
                      >
                        <XCircle aria-hidden="true" className="h-3 w-3" />
                        Ya está en uso, elegí otro
                      </p>
                    ) : (
                      <FieldHint id={slugHintId}>Solo letras minúsculas, números y guiones.</FieldHint>
                    )}
                  </div>

                  {registerError ? (
                    <InlineMessage id={registerErrorId} tone="error">
                      {registerError}
                    </InlineMessage>
                  ) : null}

                  <div className="flex flex-col gap-3 pt-1 sm:flex-row">
                    <Button
                      type="button"
                      variant="outline"
                      className={cn(secondaryButtonClass, "sm:w-auto")}
                      onClick={() => {
                        setPaso("cuenta")
                        setError("")
                        setSlugStatus("idle")
                      }}
                    >
                      <ArrowLeft aria-hidden="true" className="h-4 w-4" /> Volver
                    </Button>
                    <Button
                      type="submit"
                      className={cn(primaryButtonClass, "sm:flex-1")}
                      disabled={
                        loadingCredentials ||
                        slugStatus === "checking" ||
                        slugStatus === "taken"
                      }
                    >
                      {loadingCredentials ? (
                        "Creando cuenta..."
                      ) : (
                        <>
                          Crear cuenta gratis{" "}
                          <ArrowRight aria-hidden="true" className="h-4 w-4" />
                        </>
                      )}
                    </Button>
                  </div>
                  <p className="text-center text-xs leading-5 text-[color:var(--marketing-muted)]">
                    Revisamos tu cuenta manualmente. Te avisamos por email en menos de 24 hs.
                  </p>
                </form>
              </motion.div>
              )}
              </AnimatePresence>
            </motion.div>
            )}
            </AnimatePresence>
          </div>
        </motion.section>

        {/* ── Right: dark brand panel ───────────────────────────────── */}
        <motion.aside
          layout="position"
          transition={{ type: "spring", stiffness: 220, damping: 26 }}
          aria-hidden="true"
          className={cn(
            "relative hidden overflow-hidden lg:flex lg:w-1/2 lg:items-center lg:justify-center lg:px-14 xl:px-20",
            tab === "login" ? "lg:order-2" : "lg:order-1"
          )}
          style={{ background: "linear-gradient(145deg, #030c1a 0%, #061230 100%)" }}
        >
          {/* Background atmosphere */}
          <div className="pointer-events-none absolute inset-0" aria-hidden="true">
            <div className="absolute right-0 top-0 h-[600px] w-[600px] rounded-full bg-blue-600/10 blur-[100px]" />
            <div className="absolute bottom-0 left-0 h-[400px] w-[400px] rounded-full bg-blue-800/8 blur-[80px]" />
            <div
              className="absolute inset-0 opacity-30"
              style={{
                backgroundImage:
                  "radial-gradient(circle, rgba(255,255,255,0.04) 1px, transparent 1px)",
                backgroundSize: "28px 28px",
              }}
            />
          </div>

          {/* Panel content */}
          <div className="relative flex w-full max-w-md flex-col gap-10">
            {/* Dynamic headline + identity card — animated on tab/paso change */}
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={`${tab}-${paso}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.24, ease: [0.25, 0, 0.25, 1] }}
              >
                <PanelContent
                  tab={tab}
                  paso={paso}
                  loginData={loginData}
                  datosCuenta={datosCuenta}
                  datosEmpresa={datosEmpresa}
                />
              </motion.div>
            </AnimatePresence>

            {/* Feature chips — stagger entrance */}
            <div className="flex flex-wrap gap-2">
              {splitFeatures.map(({ icon: Icon, label }, i) => (
                <motion.span
                  key={label}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.04 * i, duration: 0.32, ease: [0.25, 0, 0.25, 1] }}
                  className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/65"
                >
                  <Icon className="h-3 w-3 shrink-0 text-blue-400" aria-hidden="true" />
                  {label}
                </motion.span>
              ))}
            </div>

          </div>
        </motion.aside>
      </main>
    </div>
  )
}

export default function AuthPage() {
  return (
    <Suspense>
      <AuthContent />
    </Suspense>
  )
}
