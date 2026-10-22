import type { ReactNode } from "react"

import MarketingFooter from "@/components/marketing/marketing-footer"
import Navbar from "@/components/navbar"

type TocItem = {
  id: string
  label: string
}

type StaticMarketingPageShellProps = {
  title: string
  eyebrow?: string
  description?: string
  backHref?: string
  backLabel?: string
  toc?: TocItem[]
  children: ReactNode
}

export default function StaticMarketingPageShell({
  title,
  eyebrow,
  description,
  backHref = "/",
  backLabel = "Volver a Ticketera",
  toc,
  children,
}: StaticMarketingPageShellProps) {
  return (
    <div className="marketing-shell flex min-h-screen flex-col">
      <Navbar />

      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[520px] opacity-30"
        aria-hidden="true"
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 50% -10%, rgba(56,189,248,0.18) 0%, transparent 70%)",
        }}
      />

      <main
        id="main-content"
        tabIndex={-1}
        className="relative flex-1 px-6 py-14 focus:outline-none lg:px-10 lg:py-20"
      >
        <div className="mx-auto max-w-6xl">
          <a
            href={backHref}
            className="group inline-flex items-center gap-2 text-sm font-medium transition-colors"
            style={{ color: "var(--marketing-muted)" }}
          >
            <span
              className="inline-flex h-6 w-6 items-center justify-center rounded-full border transition-colors group-hover:border-[color:var(--marketing-accent)] group-hover:text-[color:var(--marketing-accent)]"
              style={{ borderColor: "var(--marketing-border-strong)" }}
              aria-hidden="true"
            >
              ←
            </span>
            <span className="transition-colors group-hover:text-[color:var(--marketing-ink)]">
              {backLabel}
            </span>
          </a>

          <div className="mt-12 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-10 md:grid-cols-[minmax(0,1fr)_14rem] md:gap-12 lg:grid-cols-[minmax(0,1fr)_17rem] lg:gap-14">
            <article className="min-w-0">
              <header className="mb-10">
                {eyebrow ? (
                  <p className="marketing-kicker mb-3">{eyebrow}</p>
                ) : null}
                <h1 className="marketing-title marketing-page-title text-balance" style={{ color: "var(--marketing-ink-strong)" }}>
                  {title}
                </h1>
                {description ? (
                  <p
                    className="marketing-section-lead mt-5 max-w-2xl text-pretty"
                    style={{ color: "var(--marketing-ink)", opacity: 0.82 }}
                  >
                    {description}
                  </p>
                ) : null}
                <div
                  className="mt-8 h-px w-16"
                  style={{ background: "var(--marketing-accent)", opacity: 0.6 }}
                  aria-hidden="true"
                />
              </header>

              <div className="space-y-0">{children}</div>
            </article>

            {toc?.length ? (
              <aside className="md:sticky md:top-24 md:self-start">
                <div
                  className="marketing-panel rounded-card overflow-hidden"
                >
                  <div
                    className="px-5 py-4"
                    style={{
                      borderBottom: "1px solid var(--marketing-border)",
                    }}
                  >
                    <p className="marketing-kicker">En esta página</p>
                  </div>
                  <nav aria-label="Índice de página" className="flex flex-col px-3 py-3">
                    {toc.map(({ id, label }) => (
                      <a
                        key={id}
                        href={`#${id}`}
                        className="group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-all duration-150 hover:bg-[color:var(--marketing-accent-soft)]"
                        style={{ color: "var(--marketing-ink)", opacity: 0.78 }}
                      >
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full transition-colors group-hover:bg-[color:var(--marketing-accent)]"
                          style={{ background: "var(--marketing-border-strong)" }}
                          aria-hidden="true"
                        />
                        <span className="transition-colors group-hover:text-[color:var(--marketing-ink-strong)] group-hover:opacity-100">
                          {label}
                        </span>
                      </a>
                    ))}
                  </nav>
                </div>
              </aside>
            ) : null}
          </div>
        </div>
      </main>

      <MarketingFooter />
    </div>
  )
}
