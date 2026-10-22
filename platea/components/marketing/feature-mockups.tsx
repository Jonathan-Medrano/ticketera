"use client"

import { useRef } from "react"
import { useInView } from "framer-motion"
import QRCode from "react-qr-code"
import { Check, ChevronRight, Download, Mail, Minus, Plus, QrCode, Users, X } from "lucide-react"

function BrowserChrome({ url }: { url: string }) {
  return (
    <div className="flex items-center gap-2 border-b border-[color:var(--marketing-border)] bg-[#f6f8fc] px-4 py-3 dark:border-white/10 dark:bg-slate-800">
      <div className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
      </div>
      <div className="ml-3 flex-1 truncate rounded-md bg-white px-3 py-1 text-[10px] font-medium text-[color:var(--marketing-muted)] shadow-inner dark:bg-slate-700 dark:text-slate-300">
        {url}
      </div>
    </div>
  )
}

export function MockupSitio() {
  return (
    <div
      aria-hidden="true"
      className="relative overflow-hidden rounded-[1.4rem] border border-[color:var(--marketing-border-strong)] bg-white shadow-[0_1px_2px_rgba(15,33,77,0.04),0_8px_24px_rgba(15,33,77,0.08),0_30px_60px_rgba(15,33,77,0.14)] before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:z-20 before:h-px before:bg-gradient-to-r before:from-transparent before:via-white/70 before:to-transparent before:content-[''] dark:bg-slate-900 dark:shadow-[0_24px_60px_rgba(0,0,0,0.5)] dark:before:via-white/15"
    >
      <BrowserChrome url="festivalcumbre.ticketera.com" />

      <div className="bg-white dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-[color:var(--marketing-border)] px-5 py-3 dark:border-white/10">
          <div className="flex items-center gap-2">
            <div className="grid h-7 w-7 place-items-center rounded-lg bg-[#0b1a37] text-[10px] font-bold text-white">FC</div>
            <span className="text-xs font-semibold tracking-wide text-[color:var(--marketing-ink-strong)] dark:text-white">FESTIVAL CUMBRE</span>
          </div>
          <div className="hidden gap-4 text-[10px] font-medium text-[color:var(--marketing-muted)] sm:flex">
            <span>Inicio</span>
            <span>Eventos</span>
            <span>Contacto</span>
          </div>
        </div>

        <div className="relative flex h-28 flex-col items-start justify-end overflow-hidden px-5 pb-4">
          <div className="pointer-events-none absolute inset-0 bg-[#050d1e]" />
          <div className="pointer-events-none absolute left-[15%] top-[-20%] h-28 w-28 rounded-full bg-[#0052cc]/60 blur-3xl" />
          <div className="pointer-events-none absolute right-[20%] top-[10%] h-20 w-20 rounded-full bg-violet-600/40 blur-2xl" />
          <div className="pointer-events-none absolute bottom-[-10%] left-[45%] h-16 w-16 rounded-full bg-cyan-500/25 blur-xl" />
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:24px_24px]" />
          <div className="relative">
            <span className="inline-block rounded-full bg-[#0052cc]/80 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.16em] text-white/90">Festival · 3 noches</span>
            <p className="mt-1.5 text-[15px] font-bold leading-tight text-white">Festival Cumbre 2026</p>
            <p className="text-[10px] text-white/55">La Plata · Sáb 18 jul</p>
          </div>
        </div>

        <div className="px-5 pb-5 pt-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--marketing-accent)]">Edición 2026</p>
          <h4 className="mt-1 text-base font-semibold text-[color:var(--marketing-ink-strong)] dark:text-white">Festival Cumbre — 3 noches</h4>
          <p className="mt-0.5 text-[11px] text-[color:var(--marketing-muted)]">Sáb 18 jul · La Plata · 12.000 cupos</p>

          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between rounded-lg border border-[color:var(--marketing-border)] bg-white px-3 py-2.5 dark:border-white/10 dark:bg-slate-800/60">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--marketing-muted)]">Tanda 1 · Early bird</p>
                <p className="mt-0.5 text-xs font-semibold text-[color:var(--marketing-ink-strong)] dark:text-white">$12.000</p>
              </div>
              <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400">240 disponibles</span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-[color:var(--marketing-border)] bg-white px-3 py-2.5 dark:border-white/10 dark:bg-slate-800/60">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--marketing-muted)]">Tanda 2 · Regular</p>
                <p className="mt-0.5 text-xs font-semibold text-[color:var(--marketing-ink-strong)] dark:text-white">$18.000</p>
              </div>
              <span className="text-[10px] font-medium text-[color:var(--marketing-muted)]">580 disponibles</span>
            </div>
          </div>

          <button
            type="button"
            className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-[color:var(--marketing-accent)] px-4 py-2.5 text-xs font-semibold text-white"
          >
            Comprar entradas <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}

export function MockupScanner() {
  return (
    <div className="flex items-center justify-center">
      <div
        aria-hidden="true"
        className="relative w-[260px] max-w-full overflow-hidden rounded-[2.2rem] border-[6px] border-[#0b1a37] bg-[#0b1a37] shadow-[0_30px_70px_rgba(11,26,55,0.35)]"
      >
        <div className="flex items-center justify-between px-5 pt-3 pb-1 text-[9px] font-semibold text-white/85">
          <span>22:14</span>
          <span>●●●●● 84%</span>
        </div>

        <div className="bg-[#0b1a37] px-4 pb-4">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-medium text-white/70">← Festival Cumbre</p>
            <p className="text-[10px] font-semibold text-white">Puerta A</p>
          </div>
          <p className="mt-2 text-[18px] font-semibold leading-tight text-white">Escáner</p>
          <p className="text-[10px] text-white/55">Apuntá al QR del comprador</p>

          <div className="mt-4 grid aspect-square place-items-center rounded-2xl bg-white/5 ring-1 ring-white/10">
            <div className="relative overflow-hidden rounded-xl bg-white p-3 shadow-inner">
              <QRCode
                value="TICKET-04829-TICKETERA"
                size={128}
                fgColor="#0b1a37"
                bgColor="#ffffff"
                style={{ display: "block", width: 128, height: 128 }}
              />
              <div
                aria-hidden="true"
                className="scanner-line pointer-events-none absolute inset-x-3 h-0.5 rounded-full bg-[color:var(--marketing-accent)]/80 blur-[1px]"
              />
            </div>
          </div>

          <div className="mt-4 flex items-center gap-2 rounded-xl bg-emerald-500/15 px-3 py-2.5 ring-1 ring-emerald-500/35">
            <span className="grid h-6 w-6 place-items-center rounded-full bg-emerald-500 text-white">
              <Check className="h-3.5 w-3.5" strokeWidth={3} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold text-emerald-300">Acceso registrado</p>
              <p className="text-[9px] text-white/65">Ticket #04829 · Tanda 2</p>
            </div>
          </div>

          <div className="mt-4">
            <div className="flex items-center justify-between text-[9px] font-medium text-white/65">
              <span>73% ingresaron</span>
              <span>6.108 / 8.420</span>
            </div>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/10">
              <div className="h-full w-[73%] rounded-full bg-[color:var(--marketing-accent)]" />
            </div>
          </div>

          <div className="mt-4 space-y-1.5">
            <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-white/35">Recientes</p>
            {[
              { id: "04828", tier: "Tanda 2", ok: true },
              { id: "04827", tier: "Tanda 1", ok: true },
              { id: "04821", tier: "VIP", ok: false },
            ].map((s) => (
              <div key={s.id} className="flex items-center gap-2 rounded-lg bg-white/5 px-2.5 py-1.5">
                <span className={`grid h-4 w-4 shrink-0 place-items-center rounded-full ${s.ok ? "bg-emerald-500/25 text-emerald-400" : "bg-red-500/25 text-red-400"}`}>
                  {s.ok ? <Check className="h-2.5 w-2.5" strokeWidth={3} /> : <X className="h-2.5 w-2.5" strokeWidth={3} />}
                </span>
                <span className="text-[10px] text-white/70">#{s.id}</span>
                <span className="ml-auto text-[9px] text-white/40">{s.tier}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export function MockupBarra() {
  return (
    <div
      aria-hidden="true"
      className="relative overflow-hidden rounded-[1.4rem] border border-[color:var(--marketing-border-strong)] bg-white shadow-[0_1px_2px_rgba(15,33,77,0.04),0_8px_24px_rgba(15,33,77,0.08),0_30px_60px_rgba(15,33,77,0.14)] before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:z-20 before:h-px before:bg-gradient-to-r before:from-transparent before:via-white/70 before:to-transparent before:content-[''] dark:bg-slate-900 dark:shadow-[0_24px_60px_rgba(0,0,0,0.5)] dark:before:via-white/15"
    >
      <BrowserChrome url="barra.ticketera.com/sector-norte" />
      <div className="flex items-center justify-between border-b border-[color:var(--marketing-border)] px-5 py-3 dark:border-white/10">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-[color:var(--marketing-accent-soft)] text-[color:var(--marketing-accent)]">
            <QrCode className="h-3.5 w-3.5" />
          </span>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--marketing-muted)]">Barra · Sector Norte</p>
            <p className="text-xs font-semibold text-[color:var(--marketing-ink-strong)] dark:text-white">Mesa abierta</p>
          </div>
        </div>
        <span className="rounded-full bg-emerald-500/15 px-2 py-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">En vivo</span>
      </div>

      <div className="flex gap-1 border-b border-[color:var(--marketing-border)] px-4 py-2 dark:border-white/10">
        {["Bebidas", "Comidas", "Varios"].map((cat, i) => (
          <button key={cat} type="button" className={`rounded-md px-2.5 py-1 text-[10px] font-semibold transition-colors ${i === 0 ? "bg-[color:var(--marketing-accent)] text-white" : "text-[color:var(--marketing-muted)]"}`}>
            {cat}
          </button>
        ))}
      </div>

      <div className="space-y-2 px-5 py-4">
        {[
          { name: "Cerveza artesanal IPA", price: "$1.500", qty: 2, stock: "stock 240" },
          { name: "Coca-Cola 500ml", price: "$800", qty: 1, stock: "stock 80" },
          { name: "Hamburguesa cheddar", price: "$4.000", qty: 1, stock: "stock 32" },
        ].map((p) => (
          <div key={p.name} className="flex items-center gap-3 rounded-lg border border-[color:var(--marketing-border)] bg-white px-3 py-2 dark:border-white/10 dark:bg-slate-800/60">
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-[color:var(--marketing-ink-strong)] dark:text-white">{p.name}</p>
              <p className="mt-0.5 text-[10px] text-[color:var(--marketing-muted)]">{p.price} · {p.stock}</p>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="grid h-6 w-6 place-items-center rounded-md border border-[color:var(--marketing-border)] text-[color:var(--marketing-muted)]">
                <Minus className="h-3 w-3" />
              </span>
              <span className="w-5 text-center text-xs font-semibold tabular-nums text-[color:var(--marketing-ink-strong)] dark:text-white">{p.qty}</span>
              <span className="grid h-6 w-6 place-items-center rounded-md border border-[color:var(--marketing-border)] text-[color:var(--marketing-muted)]">
                <Plus className="h-3 w-3" />
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-[color:var(--marketing-border)] bg-[color:var(--marketing-surface)] px-5 py-4 dark:border-white/10 dark:bg-slate-800/40">
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium text-[color:var(--marketing-muted)]">Total · 4 ítems</span>
          <span className="text-base font-semibold text-[color:var(--marketing-ink-strong)] dark:text-white">$7.300</span>
        </div>
        <button
          type="button"
          className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#0b1a37] px-4 py-2.5 text-xs font-semibold text-white"
        >
          <QrCode className="h-3.5 w-3.5" />
          Cobrar con QR del comprador
        </button>
        <p className="mt-2 text-[10px] text-[color:var(--marketing-muted)]">Última venta · hace 12 seg · $5.200</p>
      </div>
    </div>
  )
}

export function MockupMarketing() {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.3 })

  const segments = [
    { name: "VIP", desc: "Top 10% por gasto", count: "84", share: 14, hot: true },
    { name: "Recurrentes", desc: "2+ compras · 90 días", count: "312", share: 40 },
    { name: "Nuevos", desc: "1ª compra · 30 días", count: "540", share: 64 },
    { name: "Inactivos", desc: "Sin compras · +120 días", count: "1.180", share: 88 },
  ]
  return (
    <div
      ref={ref}
      aria-hidden="true"
      className="relative overflow-hidden rounded-[1.4rem] border border-[color:var(--marketing-border-strong)] bg-white shadow-[0_1px_2px_rgba(15,33,77,0.04),0_8px_24px_rgba(15,33,77,0.08),0_30px_60px_rgba(15,33,77,0.14)] before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:z-20 before:h-px before:bg-gradient-to-r before:from-transparent before:via-white/70 before:to-transparent before:content-[''] dark:bg-slate-900 dark:shadow-[0_24px_60px_rgba(0,0,0,0.5)] dark:before:via-white/15"
    >
      <div className="flex items-center justify-between border-b border-[color:var(--marketing-border)] px-5 py-3 dark:border-white/10">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-[color:var(--marketing-accent-soft)] text-[color:var(--marketing-accent)]">
            <Users className="h-3.5 w-3.5" />
          </span>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--marketing-muted)]">Marketing · Audiencia</p>
            <p className="text-xs font-semibold text-[color:var(--marketing-ink-strong)] dark:text-white">Tu base, segmentada sola</p>
          </div>
        </div>
        <span className="rounded-full bg-[color:var(--marketing-accent-soft)] px-2 py-1 text-[10px] font-semibold text-[color:var(--marketing-accent)]">6 segmentos</span>
      </div>

      <div className="divide-y divide-[color:var(--marketing-border)] dark:divide-white/10">
        {segments.map((s) => (
          <div
            key={s.name}
            className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-2 px-4 py-2.5 sm:grid-cols-[1fr_auto_120px] sm:gap-x-4 sm:px-5 lg:grid-cols-[1fr_auto_140px]"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold text-[color:var(--marketing-ink-strong)] dark:text-white">{s.name}</span>
                {s.hot ? (
                  <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-600 dark:text-emerald-400">
                    activo
                  </span>
                ) : null}
              </div>
              <p className="mt-0.5 text-[10px] text-[color:var(--marketing-muted)]">{s.desc}</p>
            </div>
            <span className="text-[11px] font-semibold tabular-nums text-[color:var(--marketing-ink)] dark:text-slate-200">{s.count}</span>
            <div className="col-span-2 h-1.5 overflow-hidden rounded-full bg-[color:var(--marketing-border)]/60 dark:bg-white/10 sm:col-span-1">
              <div
                className="h-full rounded-full bg-[color:var(--marketing-accent)]"
                style={{
                  width: inView ? `${s.share}%` : "0%",
                  transition: "width 800ms cubic-bezier(0.22, 1, 0.36, 1)",
                }}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-[color:var(--marketing-border)] bg-[color:var(--marketing-surface)] px-5 py-3.5 dark:border-white/10 dark:bg-slate-800/40">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <Mail className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-[color:var(--marketing-ink-strong)] dark:text-white">Carrito abandonado</p>
            <p className="text-[10px] text-[color:var(--marketing-muted)]">96 recuperados · $1.28M rescatados</p>
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-emerald-500/15 px-2.5 py-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
          +$1.28M
        </span>
      </div>
    </div>
  )
}

export function MockupCierre() {
  return (
    <div
      aria-hidden="true"
      className="relative overflow-hidden rounded-[1.4rem] border border-[color:var(--marketing-border-strong)] bg-white shadow-[0_1px_2px_rgba(15,33,77,0.04),0_8px_24px_rgba(15,33,77,0.08),0_30px_60px_rgba(15,33,77,0.14)] before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:z-20 before:h-px before:bg-gradient-to-r before:from-transparent before:via-white/70 before:to-transparent before:content-[''] dark:bg-slate-900 dark:shadow-[0_24px_60px_rgba(0,0,0,0.5)] dark:before:via-white/15"
    >
      <div className="border-b border-[color:var(--marketing-border)] px-5 py-4 dark:border-white/10">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[color:var(--marketing-muted)]">Cierre · Festival Cumbre 2026</p>
        <div className="mt-1 flex items-center justify-between">
          <h4 className="text-base font-semibold text-[color:var(--marketing-ink-strong)] dark:text-white">Resumen final</h4>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-500 dark:bg-white/10 dark:text-slate-300">
            ✓ Cerrado
          </span>
        </div>
        <p className="mt-1 text-[11px] text-[color:var(--marketing-muted)]">Sáb 18 jul · 3 días · 8.420 / 12.000 entradas</p>
      </div>

      <div className="border-b border-[color:var(--marketing-border)] bg-gradient-to-br from-[color:var(--marketing-accent)]/8 via-transparent to-transparent px-5 py-4 dark:border-white/10">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--marketing-muted)]">Recaudación total</p>
        <p className="mt-1 text-[1.45rem] font-semibold leading-none tracking-tight text-[color:var(--marketing-ink-strong)] dark:text-white sm:text-[1.75rem]">$24.612.500</p>
        <p className="mt-1.5 text-[11px] text-[color:var(--marketing-muted)]">8.420 tickets · 4.122 consumibles</p>
      </div>

      <div className="space-y-2 px-5 py-4">
        {[
          { label: "Entradas vendidas", value: "$22.180.000" },
          { label: "Consumibles", value: "$2.432.500" },
          { label: "Comisión Mercado Pago", value: "−$978.500", muted: true },
          { label: "Comisión Ticketera (4%)", value: "−$984.500", muted: true },
        ].map((row) => (
          <div key={row.label} className="flex items-center justify-between text-xs">
            <span className="text-[color:var(--marketing-ink)]/85">{row.label}</span>
            <span className={`tabular-nums font-medium ${row.muted ? "text-[color:var(--marketing-muted)]" : "text-[color:var(--marketing-ink-strong)] dark:text-white"}`}>
              {row.value}
            </span>
          </div>
        ))}
        <div className="!mt-3 overflow-hidden rounded-xl bg-emerald-500/8 px-3 py-2.5 ring-1 ring-emerald-500/20 dark:bg-emerald-500/10 dark:ring-emerald-500/25">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[color:var(--marketing-ink-strong)] dark:text-white">Neto a liquidar</span>
            <span className="text-[1rem] font-bold tabular-nums text-emerald-600 dark:text-emerald-400">$21.669.500</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 border-t border-[color:var(--marketing-border)] bg-[color:var(--marketing-surface)] px-5 py-3 dark:border-white/10 dark:bg-slate-800/40">
        <button type="button" className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[color:var(--marketing-accent)] px-3 py-2 text-[11px] font-semibold text-white">
          <Download className="h-3.5 w-3.5" /> Liquidación
        </button>
        <button type="button" className="inline-flex items-center gap-1.5 rounded-lg border border-[color:var(--marketing-border)] px-3 py-2 text-[11px] font-semibold text-[color:var(--marketing-ink)] dark:text-white">
          Reembolsos
        </button>
      </div>
    </div>
  )
}
