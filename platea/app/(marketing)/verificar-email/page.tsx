import { Suspense } from "react"
import Link from "next/link"
import Image from "next/image"
import { auth } from "@/auth"
import { VerificarEmailForm } from "./verificar-email-form"

type VerificarEmailPageProps = {
  searchParams: Promise<{ email?: string | string[]; token?: string | string[] }>
}

function normalizeEmailParam(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value
  return (raw ?? "").trim().toLowerCase()
}

function firstParam(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value
  return (raw ?? "").trim()
}

export default async function VerificarEmailPage({ searchParams }: VerificarEmailPageProps) {
  const [params, session] = await Promise.all([searchParams, auth()])
  const loggedIn = !!session?.user
  // Prioridad: email del query param (flujo de registro). Si no viene, caemos al
  // email de la sesión logueada (caso jaula: empresa aprobada pero NO verificada).
  const queryEmail = normalizeEmailParam(params.email)
  const sessionEmail = normalizeEmailParam(session?.user?.email ?? undefined)
  const email = queryEmail || sessionEmail
  // Magic-link: si viene ?token=, el form ofrece confirmar de un click.
  const token = firstParam(params.token)

  return (
    <div className="marketing-shell relative flex min-h-screen items-center justify-center overflow-hidden px-6 py-12">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-x-0 top-0 h-full bg-gradient-to-br from-[color:var(--marketing-accent)]/6 via-transparent to-[#ffae84]/10" />
        <div className="absolute -right-40 top-0 h-[500px] w-[500px] rounded-full bg-[color:var(--marketing-accent)]/8 blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        <Link
          href="/"
          aria-label="Ticketera"
          className="mx-auto inline-flex items-center gap-2.5 self-start rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--marketing-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--marketing-bg-end)]"
        >
          <Image src="/ticketera_logo_app.svg" alt="" width={36} height={36} priority className="shrink-0" />
          <span className="marketing-brand-wordmark text-[1.6rem] leading-none">Ticket<span>era</span></span>
        </Link>

        <div className="marketing-panel mt-8 rounded-card border-[color:var(--marketing-border)] p-6 shadow-[0_24px_70px_rgba(2,6,23,0.12)] sm:p-8">
          <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-[color:var(--marketing-accent)]">
            Verificá tu cuenta
          </p>
          <h1 className="mt-3 text-balance text-[1.7rem] font-semibold leading-[1.12] tracking-tight text-[color:var(--marketing-ink-strong)] dark:text-white sm:text-[2rem]">
            Confirmá tu email
          </h1>

          <Suspense
            fallback={
              <p className="mt-4 text-[15px] leading-relaxed text-[color:var(--marketing-ink)]/82">Cargando…</p>
            }
          >
            <VerificarEmailForm initialEmail={email} initialToken={token} loggedIn={loggedIn} />
          </Suspense>
        </div>

        <p className="mt-6 text-center text-xs leading-6 text-[color:var(--marketing-muted)]">
          ¿Ya verificaste tu cuenta?{" "}
          <Link
            href="/login"
            className="rounded-md px-1 font-semibold text-primary underline-offset-4 transition-colors duration-200 ease-out hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--marketing-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--marketing-bg-end)]"
          >
            Iniciá sesión
          </Link>
        </p>
      </div>
    </div>
  )
}
