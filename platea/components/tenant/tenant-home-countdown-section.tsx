"use client"

import { useEffect, useMemo, useState } from "react"
import { useTenant } from "./tenant-provider"
import type { TenantEventoResumen } from "@/lib/tenant"
import type { TenantHomeCountdownSection as TenantHomeCountdownSectionData } from "@/lib/tenant-home-sections"

// Argentina nunca observa horario de verano -> offset fijo -03:00 todo el año.
// El input `datetime-local` del editor guarda la hora de pared en AR (excepción
// de tz explícita en CLAUDE.md); acá la convertimos al instante UTC real para
// poder restarle Date.now() sin importar en qué huso esté el navegador visitante.
// Es la inversa de `utcToArDatetimeLocal` en `evento-form-content.tsx`.
export function arDatetimeLocalToUtcMs(local: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local.trim())
  if (!match) return null
  const [, y, mo, d, h, mi] = match
  const ms = Date.parse(`${y}-${mo}-${d}T${h}:${mi}:00-03:00`)
  return Number.isNaN(ms) ? null : ms
}

// "Próximo evento activo" = con checkout abierto y fecha futura. Los eventos
// listados-pero-no-en-venta (publication_status "listed"/"hidden") no cuentan
// como target automático — evita mostrar una cuenta regresiva hacia algo que
// el comprador todavía no puede comprar.
export function pickProximoEventoTargetMs(eventos: TenantEventoResumen[], now: number): number | null {
  let best: number | null = null
  for (const evento of eventos) {
    if (!evento.is_checkout_open || !evento.proxima_fecha) continue
    const ms = new Date(evento.proxima_fecha).getTime()
    if (Number.isNaN(ms) || ms <= now) continue
    if (best === null || ms < best) best = ms
  }
  return best
}

type TimeLeft = { days: number; hours: number; minutes: number; seconds: number; total: number }

export function computeTimeLeft(targetMs: number, now: number): TimeLeft {
  const total = Math.max(0, targetMs - now)
  return {
    days: Math.floor(total / 86_400_000),
    hours: Math.floor((total % 86_400_000) / 3_600_000),
    minutes: Math.floor((total % 3_600_000) / 60_000),
    seconds: Math.floor((total % 60_000) / 1000),
    total,
  }
}

function pad2(value: number) {
  return String(value).padStart(2, "0")
}

const UNIT_LABELS: Array<{ key: keyof Omit<TimeLeft, "total">; label: string }> = [
  { key: "days", label: "Días" },
  { key: "hours", label: "Horas" },
  { key: "minutes", label: "Min" },
  { key: "seconds", label: "Seg" },
]

export function TenantHomeCountdownSection({
  section,
  eventos,
}: {
  section: TenantHomeCountdownSectionData
  eventos: TenantEventoResumen[]
}) {
  const tenant = useTenant()

  // `now` arranca en null y solo se resuelve en el cliente (useEffect). Evita
  // que SSR y la primera pintada del cliente computen dígitos distintos —
  // sin esto, un reloj real siempre difiere entre server y cliente y React
  // tira warning de hidratación (o, peor, un bloque que aparece/desaparece
  // porque el evento "próximo" cambia de resultado entre ambos renders).
  const [now, setNow] = useState<number | null>(null)

  useEffect(() => {
    // `tick` es el callback de la suscripción al timer externo (setInterval).
    // Lo llamamos una vez al montar para primear `now` sin esperar el primer
    // tick de 1s, y de nuevo en cada intervalo — misma cadencia/timing que
    // antes, pero sin un setState "suelto" en el cuerpo del efecto.
    const tick = () => setNow(Date.now())
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  const targetMs = useMemo(() => {
    if (now === null) return null
    if (section.modo === "fecha_manual") return arDatetimeLocalToUtcMs(section.fecha_manual)
    return pickProximoEventoTargetMs(eventos, now)
  }, [now, section.modo, section.fecha_manual, eventos])

  // Loading: todavía no montamos en cliente. Mismo alto que el estado final
  // para no generar salto de layout cuando aparezcan los dígitos reales.
  if (now === null) {
    return (
      <div className="w-full px-4 py-12 md:py-16" aria-hidden="true">
        <div
          className="mx-auto max-w-3xl animate-pulse border p-6 text-center md:p-10"
          style={{ borderColor: `${tenant.color_texto}12`, background: `${tenant.color_texto}05`, borderRadius: "var(--tenant-radius, 24px)" }}
        >
          <div className="mx-auto mb-6 h-4 w-40 rounded-full" style={{ background: `${tenant.color_texto}12` }} />
          <div className="flex items-center justify-center gap-2 sm:gap-4">
            {UNIT_LABELS.map((unit) => (
              <div key={unit.key} className="h-[76px] w-[64px] rounded-2xl sm:h-[92px] sm:w-[84px]" style={{ background: `${tenant.color_primario}10`, borderRadius: "var(--tenant-radius, 16px)" }} />
            ))}
          </div>
        </div>
      </div>
    )
  }

  // Empty: modo automático sin ningún evento activo futuro -> no mostramos un
  // bloque roto/vacío en el sitio público. El editor ya avisa de este caso.
  if (targetMs === null) return null

  const timeLeft = computeTimeLeft(targetMs, now)
  const finished = timeLeft.total <= 0
  const titulo = section.titulo.trim() || "La cuenta regresiva ya arrancó"
  const textoFinalizado = section.texto_finalizado.trim() || "¡Ya estamos en marcha!"

  return (
    <div className="w-full px-4 py-12 md:py-16">
      <div
        className="mx-auto max-w-3xl border p-6 text-center md:p-10"
        style={{
          borderColor: `${tenant.color_texto}12`,
          background: `var(--tenant-superficie, ${tenant.color_texto}05)`,
          borderRadius: "var(--tenant-radius, 24px)",
        }}
      >
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-widest" style={{ color: `${tenant.color_texto}50` }}>
          Cuenta regresiva
        </p>
        <h2 className="mb-6 text-xl font-bold md:text-2xl" style={{ color: tenant.color_texto }}>
          {titulo}
        </h2>

        {finished ? (
          <p className="text-base font-semibold md:text-lg" style={{ color: tenant.color_primario }}>
            {textoFinalizado}
          </p>
        ) : (
          <div className="flex items-center justify-center gap-2 sm:gap-4" role="timer" aria-live="off">
            {UNIT_LABELS.map(({ key, label }) => (
              <div
                key={key}
                className="flex min-w-[64px] flex-col items-center px-3 py-3 sm:min-w-[84px] sm:px-4 sm:py-4"
                style={{ background: `${tenant.color_primario}14`, borderRadius: "var(--tenant-radius, 16px)" }}
              >
                <span className="font-mono text-2xl font-black tabular-nums sm:text-4xl" style={{ color: tenant.color_primario }}>
                  {pad2(timeLeft[key])}
                </span>
                <span className="mt-1 text-[10px] font-semibold uppercase tracking-wide sm:text-xs" style={{ color: `${tenant.color_texto}60` }}>
                  {label}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
