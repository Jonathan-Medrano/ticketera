import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

type StaticPageSectionProps = {
  id?: string
  title: string
  description?: string
  children: ReactNode
  className?: string
  index?: number
}

export default function StaticPageSection({
  id,
  title,
  description,
  children,
  className,
  index,
}: StaticPageSectionProps) {
  return (
    <section
      id={id}
      className={cn(
        "marketing-panel rounded-panel scroll-mt-28 px-7 py-8 sm:px-9 sm:py-9",
        "mb-5 last:mb-0",
        className,
      )}
      aria-labelledby={id ? `${id}-title` : undefined}
    >
      <div className="flex items-start gap-5">
        {index !== undefined ? (
          <span
            className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold"
            style={{
              background: "var(--marketing-accent-soft)",
              color: "var(--marketing-accent)",
              border: "1px solid rgba(56,189,248,0.2)",
            }}
            aria-hidden="true"
          >
            {index}
          </span>
        ) : null}

        <div className="min-w-0 flex-1 space-y-4">
          <div className="space-y-2">
            <h2
              id={id ? `${id}-title` : undefined}
              className="text-xl font-semibold sm:text-2xl"
              style={{ color: "var(--marketing-ink-strong)" }}
            >
              {title}
            </h2>
            {description ? (
              <p
                className="marketing-page-body"
                style={{ color: "var(--marketing-ink)", opacity: 0.78 }}
              >
                {description}
              </p>
            ) : null}
          </div>

          <div
            className="marketing-page-body space-y-4"
            style={{ color: "var(--marketing-ink)", opacity: 0.88 }}
          >
            {children}
          </div>
        </div>
      </div>
    </section>
  )
}
