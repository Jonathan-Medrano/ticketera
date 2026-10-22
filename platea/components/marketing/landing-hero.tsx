"use client"

import { motion, useReducedMotion } from "framer-motion"

import MarketingActions from "@/components/marketing-actions"
import HeroDashboardMockup from "@/components/marketing/hero-dashboard-mockup"

const ease = [0.22, 1, 0.36, 1] as const

const indexItems = [
  ["Venta", "Eventos · tandas · precios"],
  ["Accesos", "QR · equipo · permisos"],
  ["Control", "Consumos · revendedores"],
] as const

function enterFrom(y: number, delay: number) {
  return {
    initial: { opacity: 0, y },
    animate: { opacity: 1, y: 0 },
    transition: { delay, duration: 0.65, ease },
  }
}

export default function LandingHero() {
  const reduce = useReducedMotion()

  return (
    <section
      aria-labelledby="landing-hero-title"
      className="relative overflow-hidden px-6 pb-16 pt-10 lg:px-10 lg:pb-24 lg:pt-16"
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-x-0 top-0 h-[720px] bg-gradient-to-br from-[#eaf0fc]/70 via-[#f5f1f8]/30 to-transparent dark:from-[#1a2347]/45 dark:via-[#1f1d3a]/22 dark:to-transparent" />
        {reduce ? (
          <div className="absolute -right-40 -top-10 h-[560px] w-[560px] rounded-full bg-[color:var(--marketing-accent)]/[0.09] blur-3xl dark:bg-[color:var(--marketing-accent)]/15" />
        ) : (
          <motion.div
            className="absolute -right-40 -top-10 h-[560px] w-[560px] rounded-full bg-[color:var(--marketing-accent)]/[0.09] blur-3xl dark:bg-[color:var(--marketing-accent)]/15"
            animate={{ y: [0, -18, 0], x: [0, 10, 0] }}
            transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }}
          />
        )}
      </div>

      <div className="relative mx-auto w-full max-w-[1600px]">
        <motion.div
          className="flex items-center gap-3"
          {...(reduce ? {} : enterFrom(14, 0))}
        >
          <span aria-hidden="true" className="h-px w-12 bg-[color:var(--marketing-accent)]" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--marketing-muted)] sm:tracking-[0.22em] lg:tracking-[0.32em]">
            La ticketera para eventos en Argentina
          </span>
        </motion.div>

        <div className="mt-10 grid items-end gap-14 lg:mt-14 lg:grid-cols-[1.08fr_0.92fr] lg:gap-20">
          <div className="max-w-3xl">
            <motion.h1
              id="landing-hero-title"
              className="marketing-title marketing-hero-title text-balance"
              {...(reduce ? {} : enterFrom(20, 0.1))}
            >
              Vendé con <span className="marketing-title-accent">tu marca</span>.
              <br />
              Operá todo desde un solo lugar.
            </motion.h1>

            <motion.p
              className="marketing-lead mt-8 max-w-xl text-[color:var(--marketing-ink)]/88"
              {...(reduce ? {} : enterFrom(18, 0.25))}
            >
              La ticketera para productores, boliches y festivales. Venta de
              entradas, barra, accesos QR y revendedores en una sola plataforma.
            </motion.p>

            <motion.p
              className="mt-5 max-w-xl text-base font-medium text-[color:var(--marketing-ink)] sm:text-lg"
              {...(reduce ? {} : enterFrom(16, 0.35))}
            >
              Y la plata de cada venta va a{" "}
              <span className="font-semibold text-[color:var(--marketing-accent)]">tu propio Mercado Pago</span>.
              Vos manejás tu dinero, nosotros no lo tocamos.
            </motion.p>

            <motion.div className="mt-10" {...(reduce ? {} : enterFrom(14, 0.45))}>
              <MarketingActions className="flex flex-col gap-3 sm:flex-row" />
            </motion.div>

            <motion.div
              className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1.5"
              {...(reduce ? {} : enterFrom(10, 0.55))}
            >
              <span className="text-[11px] font-medium text-[color:var(--marketing-muted)]">Sin costo fijo</span>
              <span aria-hidden="true" className="text-[11px] text-[color:var(--marketing-border-strong)]">·</span>
              <span className="text-[11px] font-medium text-[color:var(--marketing-muted)]">4% por ticket</span>
              <span aria-hidden="true" className="text-[11px] text-[color:var(--marketing-border-strong)]">·</span>
              <span className="text-[11px] font-semibold text-[color:var(--marketing-accent)]">Hecho en Argentina</span>
            </motion.div>
          </div>

          <div className="relative hidden lg:block [perspective:1800px]">
            <motion.div
              className="transform-gpu drop-shadow-[0_40px_80px_rgba(15,33,77,0.22)] transition-transform duration-700 ease-out [transform:rotateY(-7deg)_rotateX(3deg)_translateZ(0)] hover:[transform:rotateY(-3deg)_rotateX(1deg)_translateZ(0)] dark:drop-shadow-[0_40px_90px_rgba(0,0,0,0.6)]"
              {...(reduce ? {} : { initial: { opacity: 0, x: 32 }, animate: { opacity: 1, x: 0 }, transition: { delay: 0.3, duration: 0.85, ease } })}
            >
              <HeroDashboardMockup />
            </motion.div>
          </div>
        </div>

        <motion.div
          className="relative mt-12 drop-shadow-[0_24px_50px_rgba(15,33,77,0.18)] lg:hidden"
          {...(reduce ? {} : { initial: { opacity: 0, y: 24 }, animate: { opacity: 1, y: 0 }, transition: { delay: 0.4, duration: 0.7, ease } })}
        >
          <HeroDashboardMockup />
        </motion.div>

        <motion.div
          className="mt-14 grid gap-px overflow-hidden rounded-card border border-[color:var(--marketing-border)] bg-[color:var(--marketing-border)] sm:grid-cols-3 lg:mt-20"
          {...(reduce ? {} : { initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0 }, transition: { delay: 0.6, duration: 0.6, ease } })}
        >
          {indexItems.map(([label, value]) => (
            <div key={label} className="bg-[color:var(--marketing-bg)] px-6 py-5">
              <p className="marketing-kicker">{label}</p>
              <p className="mt-2 text-base font-semibold text-[color:var(--marketing-ink)]">
                {value}
              </p>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  )
}
