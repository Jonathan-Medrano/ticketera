"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { signOut } from "next-auth/react"
import { CheckCircle2, CircleAlert, Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  marketingFieldClass as fieldClassName,
  marketingPrimaryButtonClass as primaryButtonClass,
  marketingSecondaryButtonClass as secondaryButtonClass,
} from "@/lib/marketing/auth-classes"
import { cn } from "@/lib/utils"

const RESEND_COOLDOWN_SECONDS = 30
const CODE_LENGTH = 6
// Cuánto mostramos la pantalla de éxito antes de redirigir al login.
const SUCCESS_REDIRECT_MS = 1800

type Feedback = { tone: "error" | "success"; text: string } | null
// "confirming" = autoconfirmando el magic-link al entrar; "success" = pantalla
// final compartida (link o código); "form" = ingreso de código a mano.
type Phase = "form" | "confirming" | "success"

export function VerificarEmailForm({
  initialEmail,
  initialToken = "",
  loggedIn = false,
}: {
  initialEmail: string
  initialToken?: string
  loggedIn?: boolean
}) {
  const router = useRouter()
  const hasEmail = initialEmail.trim().length > 0
  const hasToken = initialToken.trim().length > 0

  const [code, setCode] = useState("")
  const [verifying, setVerifying] = useState(false)
  const [resending, setResending] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [feedback, setFeedback] = useState<Feedback>(null)
  // Si llegamos con token, arrancamos autoconfirmando; si no, en el form.
  const [phase, setPhase] = useState<Phase>(hasToken ? "confirming" : "form")
  const cooldownTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const didAutoConfirm = useRef(false)

  useEffect(() => {
    return () => {
      if (cooldownTimer.current) clearInterval(cooldownTimer.current)
    }
  }, [])

  // Redirige al login tras una verificación exitosa (por código o por link).
  // Si la empresa estaba logueada con un JWT que aún dice email_verificado=false,
  // cerramos sesión sin redirect de next-auth y forzamos navegación dura para
  // arrancar con un token limpio y evitar el loop del middleware.
  async function goToLoginVerified() {
    const params = new URLSearchParams({ verified: "1" })
    if (hasEmail) params.set("email", initialEmail)
    const loginUrl = `/login?${params.toString()}`

    if (loggedIn) {
      await signOut({ redirect: false })
      window.location.href = loginUrl
      return
    }

    router.push(loginUrl)
  }

  // Muestra la pantalla final de éxito y, tras un breve respiro, redirige al login.
  function showSuccessAndRedirect() {
    setPhase("success")
    window.setTimeout(() => {
      void goToLoginVerified()
    }, SUCCESS_REDIRECT_MS)
  }

  // Autoconfirmación del magic-link: corre una sola vez al montar si hay token.
  // El POST sólo se dispara desde JS (un escáner de mails que baja el HTML no lo
  // ejecuta) y el endpoint es idempotente, así que es seguro autoconfirmar acá.
  useEffect(() => {
    if (!hasToken || didAutoConfirm.current) return
    didAutoConfirm.current = true

    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch("/api/auth/verify-email/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: initialToken }),
        })
        const data = await res.json().catch(() => ({}))
        if (cancelled) return

        if (!res.ok || !data?.ok) {
          // Token vencido/inválido → caemos al form para que use el código.
          setFeedback({
            tone: "error",
            text:
              data?.error ||
              "El enlace no es válido o expiró. Ingresá el código de 6 dígitos o reenviá uno nuevo.",
          })
          setPhase("form")
          return
        }

        showSuccessAndRedirect()
      } catch {
        if (cancelled) return
        setFeedback({
          tone: "error",
          text: "No pudimos confirmar tu cuenta con el enlace. Ingresá el código de 6 dígitos.",
        })
        setPhase("form")
      }
    })()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function startCooldown() {
    setCooldown(RESEND_COOLDOWN_SECONDS)
    if (cooldownTimer.current) clearInterval(cooldownTimer.current)
    cooldownTimer.current = setInterval(() => {
      setCooldown((prev) => {
        if (prev <= 1) {
          if (cooldownTimer.current) clearInterval(cooldownTimer.current)
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault()
    setFeedback(null)

    if (code.length !== CODE_LENGTH) {
      setFeedback({ tone: "error", text: `Ingresá el código de ${CODE_LENGTH} dígitos.` })
      return
    }

    setVerifying(true)
    try {
      const res = await fetch("/api/auth/verify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: initialEmail, code }),
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok || !data?.ok) {
        setFeedback({
          tone: "error",
          text: data?.error || "El código es inválido o expiró. Reenviá uno nuevo e intentá de vuelta.",
        })
        return
      }

      // Éxito: misma pantalla final que el magic-link, después al login.
      showSuccessAndRedirect()
    } catch {
      setFeedback({ tone: "error", text: "No pudimos verificar el código. Probá de nuevo en un momento." })
    } finally {
      setVerifying(false)
    }
  }

  async function handleResend() {
    if (cooldown > 0 || resending) return
    setFeedback(null)
    setResending(true)
    try {
      const res = await fetch("/api/auth/verify-email/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: initialEmail }),
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok || !data?.ok) {
        setFeedback({ tone: "error", text: data?.error || "No pudimos reenviar el código. Probá en unos segundos." })
        return
      }

      startCooldown()
      setFeedback({ tone: "success", text: "Te enviamos un código nuevo. Revisá tu casilla." })
    } catch {
      setFeedback({ tone: "error", text: "No pudimos reenviar el código. Probá en unos segundos." })
    } finally {
      setResending(false)
    }
  }

  async function handleSignOut() {
    if (signingOut) return
    setSigningOut(true)
    await signOut({ redirect: false })
    window.location.href = "/login"
  }

  // Pantalla final compartida: la ve tanto quien clickea el magic-link como quien
  // ingresa el código a mano.
  if (phase === "success") {
    return (
      <div className="mt-8 flex flex-col items-center gap-4 text-center" role="status" aria-live="polite">
        <CheckCircle2 aria-hidden="true" className="h-14 w-14 text-emerald-500" />
        <div>
          <p className="text-[1.15rem] font-semibold text-[color:var(--marketing-ink-strong)] dark:text-white">
            ¡Cuenta confirmada!
          </p>
          <p className="mt-1 text-sm text-[color:var(--marketing-muted)]">Te estamos llevando al login…</p>
        </div>
      </div>
    )
  }

  // Autoconfirmando el magic-link al entrar.
  if (phase === "confirming") {
    return (
      <div className="mt-8 flex flex-col items-center gap-4 text-center" role="status" aria-live="polite">
        <Loader2 aria-hidden="true" className="h-10 w-10 animate-spin text-[color:var(--marketing-accent)]" />
        <p className="text-sm text-[color:var(--marketing-muted)]">Confirmando tu cuenta…</p>
      </div>
    )
  }

  return (
    <>
      {loggedIn ? (
        <p className="mt-4 text-[15px] leading-relaxed text-[color:var(--marketing-ink)]/82">
          Tu cuenta quedó <span className="font-semibold text-[color:var(--marketing-ink-strong)] dark:text-white">pendiente de verificación</span>.
          {hasEmail ? (
            <>
              {" "}Te enviamos un código de 6 dígitos a{" "}
              <span className="font-semibold text-[color:var(--marketing-ink-strong)] dark:text-white">{initialEmail}</span>.
            </>
          ) : (
            <> Te enviamos un código de 6 dígitos a tu email.</>
          )}{" "}
          Ingresalo para continuar y acceder a tu panel.
        </p>
      ) : (
        <p className="mt-4 text-[15px] leading-relaxed text-[color:var(--marketing-ink)]/82">
          {hasEmail ? (
            <>
              Te enviamos un código de 6 dígitos a{" "}
              <span className="font-semibold text-[color:var(--marketing-ink-strong)] dark:text-white">{initialEmail}</span>.
              Ingresalo para confirmar tu cuenta.
            </>
          ) : (
            <>Te enviamos un código de 6 dígitos a tu email. Ingresalo para confirmar tu cuenta.</>
          )}
        </p>
      )}

      <form onSubmit={handleVerify} className="mt-6 space-y-4" noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="verify-code">Código de verificación</Label>
          <Input
            id="verify-code"
            name="one-time-code"
            type="text"
            className={cn(fieldClassName, "text-center text-[1.5rem] font-mono tabular-nums tracking-[0.5em]")}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            placeholder="000000"
            maxLength={CODE_LENGTH}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, CODE_LENGTH))}
            aria-invalid={feedback?.tone === "error"}
            autoFocus
            required
          />
        </div>

        {feedback ? (
          <div
            role={feedback.tone === "error" ? "alert" : "status"}
            aria-live={feedback.tone === "error" ? "assertive" : "polite"}
            className={cn(
              "flex items-start gap-3 rounded-xl border px-4 py-3 text-sm leading-6",
              feedback.tone === "error"
                ? "border-destructive/30 bg-destructive/10 text-destructive"
                : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
            )}
          >
            {feedback.tone === "error" ? (
              <CircleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            ) : (
              <CheckCircle2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            )}
            <div>{feedback.text}</div>
          </div>
        ) : null}

        <Button type="submit" className={primaryButtonClass} disabled={verifying}>
          {verifying ? "Verificando..." : "Verificar"}
        </Button>
      </form>

      <Button
        type="button"
        variant="outline"
        className={cn(secondaryButtonClass, "mt-3")}
        onClick={handleResend}
        disabled={resending || cooldown > 0}
      >
        {resending
          ? "Reenviando..."
          : cooldown > 0
            ? `Reenviar código (${cooldown}s)`
            : "Reenviar código"}
      </Button>

      {loggedIn ? (
        <Button
          type="button"
          variant="ghost"
          className="mt-3 w-full text-sm font-medium text-[color:var(--marketing-muted)] hover:text-[color:var(--marketing-ink-strong)]"
          onClick={handleSignOut}
          disabled={signingOut}
        >
          {signingOut ? "Cerrando sesión..." : "Cerrar sesión"}
        </Button>
      ) : null}

      <p className="mt-4 text-center text-xs leading-6 text-[color:var(--marketing-muted)]">
        También podés{" "}
        <a
          href="/login"
          className="font-semibold text-[color:var(--marketing-accent)] underline-offset-4 hover:underline"
        >
          entrar con Google
        </a>{" "}
        y confirmamos tu email automáticamente.
      </p>
    </>
  )
}
