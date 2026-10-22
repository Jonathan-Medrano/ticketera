import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { getContrastTextColor } from "@/lib/color-contrast"

type AnimationMode = "static" | "marquee_infinite" | "marquee_finite"
type AnimationSpeed = "slow" | "normal" | "fast"

type AnnouncementBarProps = {
  contentHtml: string
  ctaLabel?: string | null
  ctaHref?: string | null
  animationMode?: AnimationMode
  animationSpeed?: AnimationSpeed
  backgroundColor?: string | null
}

const SPEED_DURATION: Record<AnimationSpeed, string> = {
  slow: "60s",
  normal: "32s",
  fast: "16s",
}

function CtaLink({ ctaLabel, ctaHref, inheritColor }: { ctaLabel: string; ctaHref: string; inheritColor: boolean }) {
  const isExternal = /^https?:\/\//.test(ctaHref)
  const className = inheritColor
    ? "inline-flex shrink-0 items-center gap-0.5 font-semibold underline opacity-95 hover:opacity-100"
    : "inline-flex shrink-0 items-center gap-0.5 font-semibold text-[color:var(--marketing-accent)] hover:text-[color:var(--marketing-accent-strong)]"
  if (isExternal) {
    return (
      <a href={ctaHref} target="_blank" rel="noreferrer" className={className}>
        {ctaLabel}
        <ArrowRight aria-hidden="true" className="h-3 w-3" />
      </a>
    )
  }
  return (
    <Link href={ctaHref} className={className}>
      {ctaLabel}
      <ArrowRight aria-hidden="true" className="h-3 w-3" />
    </Link>
  )
}

function richTextClass(inheritColor: boolean, extra = "") {
  const base = inheritColor
    ? "[&_a]:underline [&_strong]:font-semibold"
    : "[&_a]:underline [&_a]:text-[color:var(--marketing-accent)] [&_strong]:font-semibold [&_strong]:text-[color:var(--marketing-ink-strong)]"
  return extra ? `${extra} ${base}` : base
}

function dotClass(inheritColor: boolean, hiddenOnMobile = false) {
  const visibility = hiddenOnMobile
    ? "hidden sm:inline-block"
    : "inline-block"
  const color = inheritColor
    ? "bg-current opacity-70"
    : "bg-[color:var(--marketing-accent)]"
  return `${visibility} h-1.5 w-1.5 shrink-0 rounded-full ${color}`
}

function InlineContent({
  contentHtml,
  ctaLabel,
  ctaHref,
  inheritColor,
}: {
  contentHtml: string
  ctaLabel?: string | null
  ctaHref?: string | null
  inheritColor: boolean
}) {
  const hasCta = Boolean(ctaLabel && ctaHref)
  return (
    <span className="inline-flex items-center gap-2">
      <span className={dotClass(inheritColor)} />
      <span
        className={richTextClass(inheritColor)}
        dangerouslySetInnerHTML={{ __html: contentHtml }}
      />
      {hasCta ? <CtaLink ctaLabel={ctaLabel!} ctaHref={ctaHref!} inheritColor={inheritColor} /> : null}
    </span>
  )
}

const MARQUEE_INFINITE_REPS = 4

function MarqueeGroup({
  contentHtml,
  ctaLabel,
  ctaHref,
  inheritColor,
  ariaHidden = false,
}: {
  contentHtml: string
  ctaLabel?: string | null
  ctaHref?: string | null
  inheritColor: boolean
  ariaHidden?: boolean
}) {
  return (
    <span
      aria-hidden={ariaHidden ? "true" : undefined}
      className="inline-flex min-w-[100vw] shrink-0 items-center justify-around gap-12"
    >
      {Array.from({ length: MARQUEE_INFINITE_REPS }).map((_, i) => (
        <InlineContent
          key={i}
          contentHtml={contentHtml}
          ctaLabel={ctaLabel}
          ctaHref={ctaHref}
          inheritColor={inheritColor}
        />
      ))}
    </span>
  )
}

export default function AnnouncementBar({
  contentHtml,
  ctaLabel,
  ctaHref,
  animationMode = "static",
  animationSpeed = "normal",
  backgroundColor,
}: AnnouncementBarProps) {
  if (!contentHtml.trim()) return null

  const customBg = backgroundColor && /^#[0-9a-fA-F]{6}$/.test(backgroundColor) ? backgroundColor : null
  const customText = customBg ? getContrastTextColor(customBg) : null

  const containerStyle: React.CSSProperties = {}
  if (customBg) containerStyle.background = customBg
  if (customText) containerStyle.color = customText

  const duration = SPEED_DURATION[animationSpeed] ?? SPEED_DURATION.normal

  const baseContainer =
    "relative z-40 overflow-hidden border-b border-[color:var(--marketing-border)]" +
    (customBg ? "" : " bg-[color:var(--marketing-bg)]")
  const baseTextColor = customText ? "" : " text-[color:var(--marketing-ink)]"
  const baseInnerStatic = `w-full px-6 py-2 text-[11px] sm:text-xs lg:px-10${baseTextColor}`
  const baseInnerMarquee = `w-full py-2 text-[11px] sm:text-xs${baseTextColor}`

  const inheritColor = Boolean(customText)

  if (animationMode === "static") {
    const hasCta = Boolean(ctaLabel && ctaHref)
    return (
      <div className={baseContainer} style={containerStyle}>
        <div className={`${baseInnerStatic} flex items-center justify-center gap-2 text-center`}>
          <span className={dotClass(inheritColor, true)} />
          <span
            className={richTextClass(inheritColor, "truncate")}
            dangerouslySetInnerHTML={{ __html: contentHtml }}
          />
          {hasCta ? <CtaLink ctaLabel={ctaLabel!} ctaHref={ctaHref!} inheritColor={inheritColor} /> : null}
        </div>
      </div>
    )
  }

  if (animationMode === "marquee_infinite") {
    return (
      <div className={baseContainer} style={containerStyle}>
        <div className={`${baseInnerMarquee} announcement-marquee-viewport`}>
          <div
            className="announcement-marquee-track announcement-marquee-track-infinite"
            style={{ animationDuration: duration }}
          >
            <MarqueeGroup
              contentHtml={contentHtml}
              ctaLabel={ctaLabel}
              ctaHref={ctaHref}
              inheritColor={inheritColor}
            />
            <MarqueeGroup
              contentHtml={contentHtml}
              ctaLabel={ctaLabel}
              ctaHref={ctaHref}
              inheritColor={inheritColor}
              ariaHidden
            />
          </div>
        </div>
      </div>
    )
  }

  // marquee_finite: una sola copia que cruza de derecha a izquierda y vuelve a empezar.
  return (
    <div className={baseContainer} style={containerStyle}>
      <div className={`${baseInnerMarquee} announcement-marquee-viewport`}>
        <div
          className="announcement-marquee-track announcement-marquee-track-finite"
          style={{ animationDuration: duration }}
        >
          <span className="inline-flex shrink-0 items-center">
            <InlineContent contentHtml={contentHtml} ctaLabel={ctaLabel} ctaHref={ctaHref} inheritColor={inheritColor} />
          </span>
        </div>
      </div>
    </div>
  )
}
