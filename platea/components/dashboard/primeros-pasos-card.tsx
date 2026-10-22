"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import {
  ArrowRight,
  CheckCircle2,
  Circle,
  CreditCard,
  Globe,
  Ticket,
  X,
  Zap,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { SalesReadinessReason, SalesReadinessStatus } from "@/lib/tenant"

// ─── localStorage keys ────────────────────────────────────────────────────────

const LS_COLLAPSED = "ticketera_primeros_pasos_collapsed"
const LS_DONE = "ticketera_primeros_pasos_done"
const LS_SITIO = "ticketera_sitio_configurado"

// ─── Types ────────────────────────────────────────────────────────────────────

type SalesReadiness = {
  status: SalesReadinessStatus
  reason: SalesReadinessReason | null
  canSell: boolean
}

export interface PrimerosPassosCardProps {
  /** Null/undefined → MP step treated as pending */
  salesReadiness?: SalesReadiness | null
  /** All eventos (any status) — detects whether any event exists */
  eventos: { id: string }[]
  /** Active/upcoming eventos — detects whether any event is published */
  eventosActivos: { id: string }[]
  /**
   * Server-authoritative flag from the onboarding/readiness endpoint.
   * Overrides localStorage so the step shows as complete across sessions/devices.
   * localStorage remains as an optimistic-cache fallback to avoid a loading flash.
   */
  sitioConfigurado?: boolean
}

type StepId = "mp" | "sitio" | "evento" | "publicar"

// ─── Step definitions ─────────────────────────────────────────────────────────

const STEPS: {
  id: StepId
  Icon: React.ElementType
  label: string
  description: string
  href: string
  openInNewTab?: boolean
}[] = [
  {
    id: "mp",
    Icon: CreditCard,
    label: "Conectar Mercado Pago",
    description: "Vinculá tu cuenta para recibir pagos de entradas.",
    href: "/dashboard/cobros",
  },
  {
    id: "sitio",
    Icon: Globe,
    label: "Configurar tu sitio",
    description: "Personalizá logo, colores y URL pública del storefront.",
    href: "/sitio-venta/editor",
    openInNewTab: true,
  },
  {
    id: "evento",
    Icon: Ticket,
    label: "Crear tu primer evento",
    description: "Cargá datos, fechas y categorías de entradas.",
    href: "/dashboard/eventos/nuevo",
  },
  {
    id: "publicar",
    Icon: Zap,
    label: "Publicar el evento",
    description: "Activá el evento para que los compradores puedan verlo.",
    href: "/dashboard/eventos?status=borrador",
  },
]

// ─── Component ────────────────────────────────────────────────────────────────

export function PrimerosPassosCard({
  salesReadiness,
  eventos,
  eventosActivos,
  sitioConfigurado: serverSitioConfigurado,
}: PrimerosPassosCardProps) {
  // SSR-safe: initialize conservatively, hydrate from localStorage in effect
  const [mounted, setMounted] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  // Optimistic-cache from localStorage — used as fallback only; server value is authoritative
  const [localSitioOk, setLocalSitioOk] = useState(false)
  const [permanentlyDone, setPermanentlyDone] = useState(false)

  useEffect(() => {
    try {
      setPermanentlyDone(localStorage.getItem(LS_DONE) === "true")
      setCollapsed(localStorage.getItem(LS_COLLAPSED) === "true")
      setLocalSitioOk(localStorage.getItem(LS_SITIO) === "true")
    } catch {
      // localStorage unavailable (private browsing, sandboxed, etc.)
    }
    setMounted(true)
  }, [])

  // ─── Derive completions ───────────────────────────────────────────────────

  const completions: Record<StepId, boolean> = {
    mp: salesReadiness?.canSell === true,
    // Server value is authoritative; localStorage serves as optimistic cache for the first render
    sitio: (serverSitioConfigurado ?? false) || localSitioOk,
    evento: eventos.length > 0,
    publicar: eventosActivos.length > 0,
  }

  const completedCount = STEPS.filter((s) => completions[s.id]).length
  const allCompleted = completedCount === STEPS.length

  // Auto-persist done flag when all steps are detected as complete
  useEffect(() => {
    if (!mounted || !allCompleted) return
    try {
      localStorage.setItem(LS_DONE, "true")
    } catch {
      // ignore
    }
    setPermanentlyDone(true)
  }, [mounted, allCompleted])

  // ─── Toggle collapsed ─────────────────────────────────────────────────────

  function handleToggle() {
    const next = !collapsed
    setCollapsed(next)
    try {
      localStorage.setItem(LS_COLLAPSED, String(next))
    } catch {
      // ignore
    }
  }

  // ─── Guards ───────────────────────────────────────────────────────────────

  // Render nothing until localStorage is hydrated (avoids hydration mismatch)
  if (!mounted) return null
  // Already completed before — never show again
  if (permanentlyDone) return null
  // Edge case: all steps complete right now before the effect fires
  if (allCompleted) return null

  const progressPct = Math.round((completedCount / STEPS.length) * 100)

  // ─── Collapsed state ──────────────────────────────────────────────────────

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={handleToggle}
        aria-expanded={false}
        aria-label="Expandir guía de primeros pasos"
        className={cn(
          "flex w-full items-center gap-3 rounded-2xl border border-border bg-card px-5 py-3.5 text-left",
          "transition-colors hover:bg-muted/30",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
        )}
      >
        <div
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10"
          aria-hidden
        >
          <Zap className="h-3.5 w-3.5 text-primary" />
        </div>

        <p className="flex-1 text-sm font-medium text-foreground">
          Primeros pasos
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {completedCount}/{STEPS.length} completados
          </span>
        </p>

        <span className="text-xs text-muted-foreground" aria-hidden>
          Ver →
        </span>
      </button>
    )
  }

  // ─── Expanded state ───────────────────────────────────────────────────────

  return (
    <div
      className="relative rounded-2xl border border-border bg-card p-5"
      role="region"
      aria-label="Guía de primeros pasos"
    >
      {/* Collapse (X) button — absolute top-right per spec */}
      <button
        type="button"
        onClick={handleToggle}
        aria-label="Minimizar guía de primeros pasos"
        aria-expanded={true}
        className={cn(
          "absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center",
          "rounded-lg text-muted-foreground",
          "transition-colors hover:bg-muted hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        <X className="h-4 w-4" aria-hidden />
      </button>

      {/* Header */}
      <div className="flex items-start gap-3 pr-10">
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10"
          aria-hidden
        >
          <Zap className="h-4 w-4 text-primary" />
        </div>
        <div>
          <p className="text-base font-semibold tracking-tight text-foreground">
            Primeros pasos
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {completedCount} de {STEPS.length} completados
          </p>
        </div>
      </div>

      {/* Progress bar */}
      <div
        aria-hidden
        className="mt-4 h-0.5 w-full overflow-hidden rounded-full bg-border"
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {/* Screen-reader progress announcement */}
      <p className="sr-only">
        {completedCount} de {STEPS.length} pasos de configuración completados
      </p>

      {/* Step list */}
      <ul className="mt-3 space-y-0.5" role="list">
        {STEPS.map((step) => {
          const done = completions[step.id]
          return (
            <li key={step.id}>
              <div
                className={cn(
                  "flex items-start gap-3 rounded-xl px-2.5 py-2.5",
                  "transition-colors duration-150",
                  !done && "hover:bg-muted/50",
                )}
              >
                {/* Check or empty circle */}
                <div className="mt-px shrink-0">
                  {done ? (
                    <CheckCircle2
                      className="h-[18px] w-[18px] text-primary"
                      aria-label="Completado"
                    />
                  ) : (
                    <Circle
                      className="h-[18px] w-[18px] text-border"
                      aria-label="Pendiente"
                    />
                  )}
                </div>

                {/* Text content */}
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "text-sm font-medium leading-snug",
                      done
                        ? "text-muted-foreground line-through decoration-muted-foreground/40"
                        : "text-foreground",
                    )}
                  >
                    {step.label}
                  </p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                    {step.description}
                  </p>
                </div>

                {/* CTA link — only for pending steps */}
                {!done && (
                  <Link
                    href={step.href}
                    {...(step.openInNewTab ? { target: "_blank", rel: "noreferrer" } : {})}
                    aria-label={`Ir a: ${step.label}`}
                    className={cn(
                      "shrink-0 self-center",
                      "inline-flex items-center gap-1",
                      "rounded-lg border border-border bg-background px-2.5 py-1",
                      "text-[11px] font-medium text-foreground",
                      "transition-colors hover:bg-muted",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    )}
                  >
                    Ir
                    <ArrowRight className="h-3 w-3" aria-hidden />
                  </Link>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
