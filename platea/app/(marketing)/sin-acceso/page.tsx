import Link from "next/link"
import { ArrowLeft, ShieldX } from "lucide-react"

export default function SinAccesoPage() {
  return (
    <div className="marketing-shell relative flex min-h-screen items-center justify-center overflow-hidden px-6 py-12">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-x-0 top-0 h-full bg-gradient-to-br from-[color:var(--marketing-accent)]/6 via-transparent to-[#ffae84]/10" />
        <div className="absolute -right-40 top-0 h-[500px] w-[500px] rounded-full bg-[color:var(--marketing-accent)]/8 blur-3xl" />
      </div>

      <div className="relative w-full max-w-md text-center">
        <span className="inline-grid h-14 w-14 place-items-center rounded-2xl border border-[color:var(--marketing-border-strong)] bg-[color:var(--marketing-bg)]/70 text-[color:var(--marketing-accent)] backdrop-blur-sm">
          <ShieldX className="h-7 w-7" />
        </span>

        <p className="mt-7 text-[11px] font-semibold uppercase tracking-[0.32em] text-[color:var(--marketing-accent)]">
          Sin permisos
        </p>
        <h1 className="mt-3 text-balance text-[1.85rem] font-semibold leading-[1.12] tracking-tight text-[color:var(--marketing-ink-strong)] dark:text-white sm:text-[2.2rem]">
          Esta puerta no es para vos.
        </h1>
        <p className="mt-4 text-[15px] leading-relaxed text-[color:var(--marketing-ink)]/82">
          Tu rol no tiene acceso a esta sección. No es bug — alguien lo configuró así.
          Si pensás que debería poder entrar, hablalo con quien administra tu cuenta.
        </p>

        <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/login"
            className="inline-flex items-center gap-1.5 rounded-full bg-[color:var(--marketing-accent)] px-6 py-2.5 text-sm font-semibold text-white shadow-[0_12px_28px_rgba(0,82,204,0.24)] transition-colors duration-200 hover:bg-[color:var(--marketing-accent-strong)]"
          >
            <ArrowLeft className="h-4 w-4" />
            Volver al login
          </Link>
          <Link
            href="/soporte"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-[color:var(--marketing-accent)] underline-offset-4 hover:underline"
          >
            Hablar con soporte →
          </Link>
        </div>
      </div>
    </div>
  )
}
