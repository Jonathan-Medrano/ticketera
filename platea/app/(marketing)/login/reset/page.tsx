"use client"

import { Suspense, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { ArrowLeft, Building2, Users } from "lucide-react"

import PasswordInput from "@/components/password-input"
import PasswordStrength from "@/components/password-strength"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { validatePasswordPolicy } from "@/lib/password-policy"
import {
  marketingFieldClass as fieldClassName,
  marketingFocusRing as focusRingClass,
  marketingPrimaryButtonClass as primaryButtonClass,
} from "@/lib/marketing/auth-classes"

type ResetActor = "empresa" | "empleado"

type ResetStage = "request" | "set-password" | "done"

function PreviewSkeletonLine({ widthClass }: { widthClass: string }) {
  return <span className={`block h-2.5 rounded-full bg-[color:var(--marketing-border-strong)]/55 ${widthClass}`} />
}

function ResetSplitPreview({
  stage,
  actor,
  email,
}: {
  stage: ResetStage
  actor: ResetActor
  email: string
}) {
  const actorLabel = actor === "empleado" ? "Usuario del equipo" : "Cuenta empresa"
  const hasEmail = email.trim().length > 0

  let label: string
  let icon: React.ReactNode
  let title: string
  let subtitle: string
  let skeletonWidths: string[]

  const iconWrapClass = "grid h-11 w-11 place-items-center rounded-full bg-[color:var(--marketing-accent-soft)] text-[color:var(--marketing-accent)]"

  if (stage === "request") {
    label = "Enviaremos el enlace a"
    title = hasEmail ? email : ""
    subtitle = actorLabel
    skeletonWidths = ["w-3/4", "w-1/2"]
    icon = (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
        <polyline points="22,6 12,13 2,6" />
      </svg>
    )
  } else if (stage === "set-password") {
    label = "Restablecer acceso de"
    title = actorLabel
    subtitle = "Definí una nueva contraseña"
    skeletonWidths = ["w-2/3", "w-1/2", "w-3/5"]
    icon = (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
    )
  } else {
    label = "Listo"
    title = "Contraseña actualizada"
    subtitle = `Acceso reestablecido para ${actorLabel.toLowerCase()}.`
    skeletonWidths = ["w-3/4"]
    icon = (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    )
  }

  return (
    <div className="flex w-full flex-col items-center justify-center gap-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-[color:var(--marketing-muted)]">{label}</p>
      <div className="w-full max-w-sm rounded-card border border-[color:var(--marketing-border)] bg-white p-5 shadow-[0_20px_60px_rgba(2,6,23,0.12)] dark:bg-slate-900">
        <div className="flex items-center gap-3">
          <div className={iconWrapClass}>{icon}</div>
          <div className="min-w-0 flex-1">
            {title ? (
              <p className="truncate text-sm font-semibold text-[color:var(--marketing-ink-strong)] dark:text-white">{title}</p>
            ) : (
              <PreviewSkeletonLine widthClass="w-40" />
            )}
            <p className="mt-1 truncate text-xs text-[color:var(--marketing-muted)]">{subtitle}</p>
          </div>
        </div>
        <div className="mt-5 space-y-2.5 border-t border-[color:var(--marketing-border)] pt-4">
          {skeletonWidths.map((w, i) => (
            <PreviewSkeletonLine key={i} widthClass={w} />
          ))}
        </div>
      </div>
    </div>
  )
}

function LoginResetPageContent() {
  const searchParams = useSearchParams()
  const token = searchParams.get("token")
  const actorParam = searchParams.get("actor") === "empleado" ? "empleado" : "empresa"

  const [email, setEmail] = useState("")
  const [nuevaPassword, setNuevaPassword] = useState("")
  const [confirmarPassword, setConfirmarPassword] = useState("")
  const [actor, setActor] = useState<ResetActor>(actorParam)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [ok, setOk] = useState("")
  const resetCompletado = Boolean(token && ok)

  const actorLabel = actor === "empleado" ? "usuario del equipo" : "cuenta empresa"

  async function handleSolicitar(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError("")
    setOk("")

    const res = await fetch("/api/auth/password/forgot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, actor }),
    })

    const data = await res.json().catch(() => null)
    setLoading(false)

    if (!res.ok) {
      setError(data?.error ?? "No se pudo enviar el mail de recuperación")
      return
    }

    setOk(`Si existe un ${actorLabel} con ese email, enviamos un enlace de recuperación.`)
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault()
    const validationError = validatePasswordPolicy(nuevaPassword)
    if (validationError) {
      setError(validationError)
      return
    }
    if (nuevaPassword !== confirmarPassword) {
      setError("Las contraseñas no coinciden")
      return
    }
    setLoading(true)
    setError("")
    setOk("")

    const res = await fetch("/api/auth/password/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, nuevaPassword, confirmarPassword, actor }),
    })

    const data = await res.json().catch(() => null)
    setLoading(false)

    if (!res.ok) {
      setError(data?.error ?? "No se pudo restablecer la contraseña")
      return
    }

    setOk("Contraseña actualizada correctamente. Ya podés volver a iniciar sesión.")
    setNuevaPassword("")
    setConfirmarPassword("")
  }

  const stage: ResetStage = !token ? "request" : resetCompletado ? "done" : "set-password"

  return (
    <div className="marketing-shell flex min-h-screen flex-col">
      <main className="flex flex-1 flex-col lg:flex-row">
        <section className="relative flex w-full flex-col px-6 py-10 sm:px-10 sm:py-12 lg:w-1/2 lg:px-16 lg:py-16 xl:px-24">
          <Link
            href="/"
            aria-label="Ticketera"
            className="inline-flex items-center gap-2.5 self-start rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--marketing-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--marketing-bg-end)]"
          >
            <Image src="/ticketera_logo_app.svg" alt="" width={40} height={40} priority className="shrink-0" />
            <span className="marketing-brand-wordmark text-[1.8rem] leading-none sm:text-[2rem]">Ticket<span>era</span></span>
          </Link>
          <p className="mt-1.5 text-xs font-semibold uppercase tracking-[0.28em] text-[color:var(--marketing-muted)]">Panel de empresas</p>

          <div className="mx-auto mt-10 w-full max-w-md flex-1 lg:mt-16">
            <div className="mb-6 grid grid-cols-[1fr_auto] items-start gap-3">
              <div className="min-w-0">
                <h1 className="marketing-title marketing-panel-title mb-1 text-[color:var(--marketing-ink-strong)]">
                  {token ? "Restablecer contraseña" : "Recuperar acceso"}
                </h1>
                <p className="marketing-card-body text-[color:var(--marketing-muted)] pr-2">
                  {token
                    ? `Elegí una nueva contraseña para el ${actorLabel}.`
                    : "Elegí si querés recuperar la cuenta empresa o un usuario del equipo."}
                </p>
              </div>
              <Button variant="ghost" size="sm" asChild className={`shrink-0 ${focusRingClass}`}>
                <Link href="/login">
                  <ArrowLeft aria-hidden="true" className="h-4 w-4" />
                  Volver
                </Link>
              </Button>
            </div>

          {error ? <p className="mb-4 text-sm text-destructive">{error}</p> : null}
          {ok ? <p className="mb-4 text-sm text-emerald-600 dark:text-emerald-400">{ok}</p> : null}

          {!token ? (
            <form onSubmit={handleSolicitar} className="space-y-4">
              <div className="space-y-2">
                <Label>¿Qué acceso querés recuperar?</Label>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant={actor === "empresa" ? "default" : "outline"}
                    className={`h-11 justify-start gap-2 hover:cursor-pointer ${focusRingClass}`}
                    onClick={() => setActor("empresa")}
                  >
                    <Building2 aria-hidden="true" className="h-4 w-4" /> Cuenta empresa
                  </Button>
                  <Button
                    type="button"
                    variant={actor === "empleado" ? "default" : "outline"}
                    className={`h-11 justify-start gap-2 hover:cursor-pointer ${focusRingClass}`}
                    onClick={() => setActor("empleado")}
                  >
                    <Users aria-hidden="true" className="h-4 w-4" /> Usuario del equipo
                  </Button>
                </div>
              </div>

              <div className="space-y-1">
                <Label htmlFor="reset-email">Email</Label>
                <Input
                  id="reset-email"
                  name="email"
                  className={fieldClassName}
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder={actor === "empresa" ? "tu@empresa.com" : "tu@equipo.com"}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>

              <p className="text-xs leading-5 text-[color:var(--marketing-muted)]">
                {actor === "empresa"
                  ? "Usá el email administrador de la empresa para recibir el enlace."
                  : "Usá el email del usuario del equipo para recibir el enlace."}
              </p>

              <Button
                type="submit"
                disabled={loading}
                className={primaryButtonClass}
              >
                {loading ? "Enviando..." : "Enviar enlace"}
              </Button>
            </form>
          ) : resetCompletado ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-[color:var(--marketing-border)] bg-[color:var(--marketing-surface)]/50 px-3 py-2 text-xs text-[color:var(--marketing-muted)]">
                Restableciendo acceso para: <span className="font-medium text-[color:var(--marketing-ink-strong)]">{actorLabel}</span>
              </div>

              <Button asChild className={primaryButtonClass}>
                <Link href="/login">Ir al login</Link>
              </Button>
            </div>
          ) : (
            <form onSubmit={handleReset} className="space-y-4">
              <div className="rounded-xl border border-[color:var(--marketing-border)] bg-[color:var(--marketing-surface)]/50 px-3 py-2 text-xs text-[color:var(--marketing-muted)]">
                Restableciendo acceso para: <span className="font-medium text-[color:var(--marketing-ink-strong)]">{actorLabel}</span>
              </div>

              <div className="space-y-1">
                <Label htmlFor="reset-new-password">Nueva contraseña</Label>
                <PasswordInput
                    id="reset-new-password"
                    name="new-password"
                    className={fieldClassName}
                    placeholder="Contraseña segura"
                    autoComplete="new-password"
                    value={nuevaPassword}
                    onChange={(e) => setNuevaPassword(e.target.value)}
                    required
                  />
                  <PasswordStrength password={nuevaPassword} />
                </div>

              <div className="space-y-1">
                <Label htmlFor="reset-confirm-password">Confirmar nueva contraseña</Label>
                <PasswordInput
                  id="reset-confirm-password"
                  name="confirm-password"
                  className={fieldClassName}
                  placeholder="•••••••••••••"
                  autoComplete="new-password"
                  value={confirmarPassword}
                  onChange={(e) => setConfirmarPassword(e.target.value)}
                  required
                />
              </div>

              <Button
                type="submit"
                disabled={loading}
                className={primaryButtonClass}
              >
                {loading ? "Guardando..." : "Restablecer contraseña"}
              </Button>
            </form>
          )}
          </div>
        </section>

        <aside
          aria-hidden="true"
          className="relative hidden overflow-hidden border-l border-[color:var(--marketing-border)] bg-[color:var(--marketing-surface-strong)]/55 lg:flex lg:w-1/2 lg:items-center lg:justify-center lg:px-12"
        >
          <div className="pointer-events-none absolute inset-0 -z-10">
            <div className="absolute -right-24 top-16 h-[420px] w-[420px] rounded-full bg-[color:var(--marketing-accent)]/10 blur-3xl" />
            <div className="absolute -left-20 bottom-10 h-[360px] w-[360px] rounded-full bg-[#ffae84]/15 blur-3xl" />
          </div>
          <ResetSplitPreview stage={stage} actor={actor} email={email} />
        </aside>
      </main>
    </div>
  )
}

export default function LoginResetPage() {
  return (
    <Suspense fallback={null}>
      <LoginResetPageContent />
    </Suspense>
  )
}
