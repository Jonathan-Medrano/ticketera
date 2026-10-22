"use client"

import { useRef, useState, useEffect } from "react"
import { useInView } from "framer-motion"
import { Calendar, LayoutDashboard, QrCode, ScanLine, Settings, Ticket, TrendingUp, Users } from "lucide-react"
import { formatInt } from "@/lib/format"

const sidebarItems = [
  { icon: LayoutDashboard, label: "Inicio" },
  { icon: Calendar, label: "Eventos", active: true },
  { icon: Ticket, label: "Entradas" },
  { icon: ScanLine, label: "Accesos" },
  { icon: Users, label: "Equipo" },
  { icon: Settings, label: "Ajustes" },
]

type Metric = {
  label: string
  target: number
  format: (n: number) => string
  delta: string
}

const metrics: Metric[] = [
  {
    label: "Tickets vendidos",
    target: 8420,
    format: (n) => formatInt(Math.round(n)),
    delta: "+18%",
  },
  {
    label: "Ingresos brutos",
    target: 24.6,
    format: (n) => `$${n.toFixed(1)}M`,
    delta: "+12%",
  },
  {
    label: "Escaneos QR",
    target: 6108,
    format: (n) => formatInt(Math.round(n)),
    delta: "73% asistencia",
  },
]

const barData = [
  { day: "Lun", value: 42 },
  { day: "Mar", value: 58 },
  { day: "Mié", value: 71 },
  { day: "Jue", value: 64 },
  { day: "Vie", value: 88 },
  { day: "Sáb", value: 96 },
  { day: "Dom", value: 78 },
]

const channels = [
  { name: "Sitio público", pct: 64, color: "#0052cc" },
  { name: "Revendedores", pct: 22, color: "#38bdf8" },
  { name: "Puerta", pct: 14, color: "#8b5cf6" },
]

function prefersReducedMotion() {
  if (typeof window === "undefined") return false
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

function useCountUp(target: number, durationMs: number, startDelayMs: number, started: boolean) {
  const [value, setValue] = useState(0)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (!started) return
    if (prefersReducedMotion()) {
      // Sin animación: seteamos el valor final una sola vez (rama reduced-motion).
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time mount sync, no animation
      setValue(target)
      return
    }
    let startTime: number | null = null
    const startAt = performance.now() + startDelayMs
    const animate = (now: number) => {
      if (startTime === null) startTime = startAt
      const elapsed = now - startTime
      if (elapsed < 0) {
        rafRef.current = requestAnimationFrame(animate)
        return
      }
      const progress = Math.min(elapsed / durationMs, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      setValue(target * eased)
      if (progress < 1) rafRef.current = requestAnimationFrame(animate)
    }
    rafRef.current = requestAnimationFrame(animate)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [target, durationMs, startDelayMs, started])

  return value
}

function MetricCard({ metric, index, started }: { metric: Metric; index: number; started: boolean }) {
  const value = useCountUp(metric.target, 1400, 200 + index * 120, started)
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-[color:var(--marketing-border)] bg-white px-3 py-2.5 dark:border-white/10 dark:bg-slate-800/60 sm:block">
      <div className="min-w-0">
        <p className="text-[10px] font-medium uppercase tracking-wider text-[color:var(--marketing-muted)] sm:text-[9px]">{metric.label}</p>
        <p className="mt-0.5 text-[17px] font-semibold tabular-nums text-[color:var(--marketing-ink-strong)] dark:text-white sm:mt-1 sm:text-[15px]">
          {metric.format(value)}
        </p>
      </div>
      <p className="inline-flex shrink-0 items-center gap-0.5 text-[10px] font-semibold text-[#0052cc] dark:text-[#68a1ff] sm:mt-0.5 sm:text-[9px]">
        <TrendingUp className="h-3 w-3 sm:h-2.5 sm:w-2.5" />
        {metric.delta}
      </p>
    </div>
  )
}

function Bar({ value, day, started, delayMs }: { value: number; day: string; started: boolean; delayMs: number }) {
  const [height, setHeight] = useState(0)
  const [showValue, setShowValue] = useState(false)

  useEffect(() => {
    if (!started) return
    if (prefersReducedMotion()) {
      // Sin animación: seteamos el estado final una sola vez (rama reduced-motion).
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time mount sync, no animation
      setHeight(value)
      setShowValue(true)
      return
    }
    const tHeight = window.setTimeout(() => setHeight(value), delayMs)
    const tValue = window.setTimeout(() => setShowValue(true), delayMs + 750)
    return () => {
      window.clearTimeout(tHeight)
      window.clearTimeout(tValue)
    }
  }, [value, started, delayMs])

  return (
    <div className="relative flex h-full flex-1 flex-col items-center gap-1">
      <span
        className={`absolute -top-3 text-[8px] font-semibold tabular-nums text-[color:var(--marketing-ink-strong)] transition-opacity duration-300 dark:text-white ${
          showValue ? "opacity-100" : "opacity-0"
        }`}
      >
        {value}
      </span>
      <div className="flex w-full flex-1 items-end">
        <div
          className="w-full rounded-t-sm bg-gradient-to-t from-[#0052cc] to-[#3479e3] transition-[height] duration-700 ease-out"
          style={{ height: `${height}%`, minHeight: started ? "2px" : "0" }}
        />
      </div>
      <span className="text-[8px] font-medium text-[color:var(--marketing-muted)]">{day}</span>
    </div>
  )
}

function ChartGrid({ started: _started, children }: { started: boolean; children: React.ReactNode }) {
  const gridLines = [0, 25, 50, 75, 100]
  return (
    <div className="relative mt-5">
      {/* Chart area */}
      <div className="relative h-28 flex-1">
        {/* Gridlines horizontales — adaptativo light/dark */}
        {gridLines.map((pct) => (
          <div
            key={pct}
            className="pointer-events-none absolute left-0 right-0 h-px bg-slate-200 dark:bg-white/10"
            style={{ bottom: `${pct}%` }}
          />
        ))}

        {/* Barras encima del grid */}
        <div className="relative z-10 flex h-full items-stretch gap-1.5">{children}</div>
      </div>
    </div>
  )
}

function AnimatedDonut({ started }: { started: boolean }) {
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    if (!started) return
    if (prefersReducedMotion()) {
      // Sin animación: completamos el donut una sola vez (rama reduced-motion).
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time mount sync, no animation
      setProgress(1)
      return
    }
    const t = window.setTimeout(() => setProgress(1), 350)
    return () => window.clearTimeout(t)
  }, [started])

  // Offset acumulado por segmento, precomputado sin mutar durante el render.
  const offsets = channels.reduce<number[]>((acc, c, i) => {
    acc.push(i === 0 ? 0 : acc[i - 1] + channels[i - 1].pct)
    return acc
  }, [])
  return (
    <svg viewBox="0 0 36 36" className="h-full w-full -rotate-90">
      {channels.map((c, i) => {
        const dash = c.pct * progress
        const offset = 100 - offsets[i]
        return (
          <circle
            key={c.name}
            cx="18"
            cy="18"
            r="15.9155"
            fill="transparent"
            stroke={c.color}
            strokeWidth="4.5"
            strokeDasharray={`${dash} ${100 - dash}`}
            strokeDashoffset={offset}
            style={{ transition: "stroke-dasharray 1100ms cubic-bezier(0.22, 1, 0.36, 1)" }}
          />
        )
      })}
    </svg>
  )
}

function ChannelLegend({ started }: { started: boolean }) {
  return (
    <ul className="space-y-1.5 text-[10px]">
      {channels.map((c, i) => (
        <ChannelLegendItem key={c.name} channel={c} index={i} started={started} />
      ))}
    </ul>
  )
}

function ChannelLegendItem({
  channel,
  index,
  started,
}: {
  channel: { name: string; pct: number; color: string }
  index: number
  started: boolean
}) {
  const value = useCountUp(channel.pct, 900, 500 + index * 150, started)
  return (
    <li className="flex items-center gap-1.5">
      <span className="h-2 w-2 rounded-sm" style={{ background: channel.color }} />
      <span className="text-[color:var(--marketing-ink)] dark:text-slate-300">{channel.name}</span>
      <span className="ml-1 font-semibold tabular-nums text-[color:var(--marketing-ink-strong)] dark:text-white">
        {Math.round(value)}%
      </span>
    </li>
  )
}

export default function HeroDashboardMockup() {
  const containerRef = useRef<HTMLDivElement>(null)
  const started = useInView(containerRef, { once: true, amount: 0.3 })

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className="relative overflow-hidden rounded-[1.6rem] border border-[color:var(--marketing-border-strong)] bg-white shadow-[0_8px_24px_rgba(15,23,42,0.06),0_2px_4px_rgba(15,23,42,0.04)] dark:bg-slate-900 dark:shadow-[0_8px_24px_rgba(0,0,0,0.4),0_2px_4px_rgba(0,0,0,0.3)]"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 z-30 h-px bg-gradient-to-r from-transparent via-white/70 to-transparent dark:via-white/15"
      />
      <div className="flex items-center gap-2 border-b border-[color:var(--marketing-border)] bg-[#f6f8fc] px-4 py-3 dark:border-white/10 dark:bg-slate-800">
        <div className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
        </div>
        <div className="ml-3 flex-1 truncate rounded-md bg-white px-3 py-1 text-[10px] font-medium text-[color:var(--marketing-muted)] shadow-inner dark:bg-slate-700 dark:text-slate-300">
          app.ticketera.com / dashboard / festival-cumbre-2026
        </div>
      </div>

      {/* xs: horizontal icon strip so the mockup reads as "app with navigation" */}
      <div className="flex items-center gap-2 bg-[#061a3d] px-3 py-2 sm:hidden">
        <div className="grid h-5 w-5 shrink-0 place-items-center rounded-sm bg-white text-[8px] font-bold text-[#061a3d]">V</div>
        <div className="ml-1 flex items-center gap-1.5">
          {sidebarItems.map(({ icon: Icon, label, active }) => (
            <div
              key={label}
              className={`flex h-5 w-5 items-center justify-center rounded ${active ? "bg-white/15 text-white" : "text-white/50"}`}
            >
              <Icon className="h-3 w-3 shrink-0" />
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 min-h-[380px] sm:min-h-[420px] sm:grid-cols-[140px_1fr]">
        <aside className="hidden bg-[#061a3d] px-3 py-4 text-white/85 dark:bg-[#061a3d] sm:block">
          <div className="mb-5 flex items-center gap-2 px-2">
            <div className="grid h-6 w-6 place-items-center rounded-md bg-white text-[10px] font-bold text-[#061a3d]">V</div>
            <span className="text-xs font-semibold tracking-tight">Ticketera</span>
          </div>
          <nav className="space-y-1">
            {sidebarItems.map(({ icon: Icon, label, active }) => (
              <div
                key={label}
                className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px] font-medium ${
                  active ? "bg-white/12 text-white" : "text-white/65"
                }`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span>{label}</span>
              </div>
            ))}
          </nav>
          <div className="mt-4 rounded-lg bg-white/5 px-2.5 py-2 ring-1 ring-white/8">
            <p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-white/35">Activo</p>
            <p className="mt-0.5 text-[10px] font-semibold leading-tight text-white/80">Festival Cumbre 2026</p>
            <p className="mt-0.5 text-[9px] text-white/40">3 días · 12k cupos</p>
          </div>
        </aside>

        <main className="bg-white px-4 py-4 dark:bg-slate-900 sm:px-5 sm:py-5">
          <div className="flex items-start justify-between gap-3 border-b border-[color:var(--marketing-border)] pb-4 dark:border-white/10">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[color:var(--marketing-muted)]">Eventos / Activos</p>
              <h3 className="mt-1 text-base font-semibold text-[color:var(--marketing-ink-strong)] dark:text-white">Festival Cumbre 2026</h3>
              <p className="mt-0.5 text-[11px] text-[color:var(--marketing-muted)]">3 días · 12.000 cupos · Sáb 18 jul</p>
            </div>
            <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-semibold text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">En venta</span>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-2.5">
            {metrics.map((metric, i) => (
              <MetricCard key={metric.label} metric={metric} index={i} started={started} />
            ))}
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-[1.4fr_1fr]">
            <div className="rounded-lg border border-[color:var(--marketing-border)] bg-white p-3 dark:border-white/10 dark:bg-slate-800/60">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-semibold text-[color:var(--marketing-ink)] dark:text-white">Ventas por día</p>
                <p className="text-[9px] text-[color:var(--marketing-muted)]">Últimos 7 días</p>
              </div>
              <ChartGrid started={started}>
                {barData.map((bar, i) => (
                  <Bar key={bar.day} value={bar.value} day={bar.day} started={started} delayMs={300 + i * 90} />
                ))}
              </ChartGrid>
            </div>

            <div className="rounded-lg border border-[color:var(--marketing-border)] bg-white p-3 dark:border-white/10 dark:bg-slate-800/60">
              <p className="text-[10px] font-semibold text-[color:var(--marketing-ink)] dark:text-white">Canal de venta</p>
              <div className="mt-3 flex items-center gap-3">
                <div className="relative h-20 w-20 shrink-0">
                  <AnimatedDonut started={started} />
                  <div className="absolute inset-0 grid place-items-center">
                    <QrCode className="h-4 w-4 text-[#061a3d] dark:text-white" />
                  </div>
                </div>
                <ChannelLegend started={started} />
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
